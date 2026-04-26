import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { uploadObject } from "@/lib/storage/r2";
import { logger } from "@/lib/logger";
import { ALLOWED_IMAGE_MIME, MAX_UPLOAD_BYTES } from "@capture/shared";

type Ctx = { params: Promise<{ id: string }> };

// PUBLIC (auth via bridge token verified against booth.bridge_token).
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) {
    return NextResponse.json({ error: "Bridge token diperlukan" }, { status: 401 });
  }

  const [session] = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, id))
    .limit(1);
  if (!session) {
    return NextResponse.json({ error: "Session tidak ditemukan" }, { status: 404 });
  }
  const [booth] = await db
    .select()
    .from(schema.booths)
    .where(eq(schema.booths.id, session.boothId))
    .limit(1);
  if (!booth || booth.bridgeToken !== token) {
    return NextResponse.json({ error: "Token bridge tidak valid" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Body tidak valid" }, { status: 400 });
  }
  const file = form.get("file");
  const sortOrderRaw = form.get("sortOrder");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "File tidak ditemukan" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Ukuran file melebihi 5MB" }, { status: 400 });
  }
  const isImage = file.type.startsWith("image/") || ALLOWED_IMAGE_MIME.includes(file.type);
  if (!isImage) {
    return NextResponse.json({ error: "Tipe file tidak didukung" }, { status: 400 });
  }
  const sortOrder = Number(sortOrderRaw ?? 0) || 0;

  const ext = file.type === "image/png" ? "png" : "jpg";
  const photoId = randomUUID();
  const key = `sessions/${session.boothId}/${session.id}/photo-${sortOrder || photoId.slice(0, 4)}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const result = await uploadObject({ key, body: buffer, contentType: file.type || "image/jpeg" });

  await db.insert(schema.photos).values({
    id: photoId,
    sessionId: session.id,
    url: result.url,
    isFinal: false,
    sortOrder,
  });
  await db
    .update(schema.sessions)
    .set({ photoCount: (session.photoCount ?? 0) + 1, status: "capturing" })
    .where(eq(schema.sessions.id, session.id));

  logger.info("photo_uploaded", { sessionId: session.id, key, mock: result.mockMode });
  return NextResponse.json({ data: { id: photoId, url: result.url, key } });
}
