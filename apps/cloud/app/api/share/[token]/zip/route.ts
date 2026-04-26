import archiver from "archiver";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getObjectStream, urlToKey } from "@/lib/storage/r2";
import { logger } from "@/lib/logger";

type Ctx = { params: Promise<{ token: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { token } = await params;
  const [session] = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.downloadToken, token))
    .limit(1);
  if (!session) return new Response("Link tidak valid", { status: 404 });
  if (session.downloadExpiresAt && session.downloadExpiresAt.getTime() < Date.now()) {
    return new Response("Link sudah expired", { status: 410 });
  }
  if (session.status !== "done") {
    return new Response("Foto belum siap", { status: 425 });
  }

  const photos = await db
    .select()
    .from(schema.photos)
    .where(eq(schema.photos.sessionId, session.id))
    .orderBy(schema.photos.sortOrder);

  if (photos.length === 0) return new Response("Tidak ada foto", { status: 404 });

  const archive = archiver("zip", { zlib: { level: 6 } });
  const stream = new ReadableStream({
    async start(controller) {
      archive.on("data", (chunk) => controller.enqueue(chunk));
      archive.on("end", () => controller.close());
      archive.on("error", (err) => {
        logger.error("zip_error", { sessionId: session.id, err: err.message });
        controller.error(err);
      });

      try {
        for (const photo of photos) {
          const key = urlToKey(photo.url);
          const buffer = await getObjectStream(key);
          const filename = photo.isFinal
            ? `composite-${session.id}.${guessExt(photo.url)}`
            : `photo-${photo.sortOrder || photo.id.slice(0, 4)}.${guessExt(photo.url)}`;
          archive.append(buffer, { name: filename });
        }
        await archive.finalize();
      } catch (err) {
        archive.abort();
        controller.error(err);
      }
    },
  });

  return new Response(stream as unknown as BodyInit, {
    status: 200,
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="capture-${session.id}.zip"`,
      "cache-control": "no-store",
    },
  });
}

function guessExt(urlOrKey: string): string {
  const m = urlOrKey.match(/\.(png|jpe?g|webp)(?:\?|$)/i);
  return (m?.[1] ?? "jpg").toLowerCase();
}
