import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { uploadObject } from "@/lib/storage/r2";
import { logger } from "@/lib/logger";
import { MAX_UPLOAD_BYTES } from "@capture/shared";

type Ctx = { params: Promise<{ id: string }> };

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
  if (!session) return NextResponse.json({ error: "Session tidak ditemukan" }, { status: 404 });
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
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "File tidak ditemukan" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Ukuran file melebihi 5MB" }, { status: 400 });
  }

  const ext = file.type === "image/png" ? "png" : "jpg";
  const key = `sessions/${session.boothId}/${session.id}/composite.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await uploadObject({
    key,
    body: buffer,
    contentType: file.type || "image/jpeg",
  });

  await db.insert(schema.photos).values({
    id: randomUUID(),
    sessionId: session.id,
    url: result.url,
    isFinal: true,
    sortOrder: 99,
  });
  await db
    .update(schema.sessions)
    .set({ status: "done", printCompletedAt: new Date() })
    .where(eq(schema.sessions.id, session.id));

  logger.info("composite_uploaded", { sessionId: session.id, key, mock: result.mockMode });
  return NextResponse.json({ data: { url: result.url, key } });
}
