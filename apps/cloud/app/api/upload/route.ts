import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { generateUploadName } from "@/lib/id";
import { uploadObject } from "@/lib/storage/r2";
import { ALLOWED_IMAGE_MIME, MAX_UPLOAD_BYTES } from "@capture/shared";
import { logger } from "@/lib/logger";

const ALLOWED_TYPES = new Set(["backgrounds", "logos", "previews"]);

export async function POST(req: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Body tidak valid" }, { status: 400 });
  }

  const file = form.get("file");
  const typeRaw = form.get("type");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "File tidak ditemukan" }, { status: 400 });
  }
  const type = typeof typeRaw === "string" ? typeRaw : "backgrounds";
  if (!ALLOWED_TYPES.has(type)) {
    return NextResponse.json({ error: "Tipe upload tidak valid" }, { status: 400 });
  }
  if (!ALLOWED_IMAGE_MIME.includes(file.type)) {
    return NextResponse.json(
      { error: "Hanya file PNG yang diperbolehkan" },
      { status: 400 },
    );
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Ukuran file melebihi 5MB" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const filename = generateUploadName("png");
  // Frame assets live under frames/{uuid}.png in R2 (and locally in mock mode).
  // We use a folder per type for browseability rather than per frame ID, since
  // the form uploads happen *before* the frame row exists.
  const key = `${type}/${filename}`;

  const result = await uploadObject({
    key,
    body: buffer,
    contentType: "image/png",
  });

  logger.info("upload_saved", { key, size: file.size, mock: result.mockMode });
  return NextResponse.json({ url: result.url, key, mockMode: result.mockMode });
}
