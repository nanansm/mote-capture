// Ported from apps/cloud/app/api/upload/route.ts.
//
// Differences from the old route:
//   - No `Buffer.from(await file.arrayBuffer())` — R2's `bucket.put()` (via
//     `uploadObject`) accepts a `Blob` directly and `File` (from
//     `FormData`) already *is* a `Blob`, so the uploaded file is passed
//     straight through without buffering it into memory first.
//   - The old route returned `{ url, key, mockMode }` where `url` came from
//     a possibly-mock R2 client (apps/cloud/lib/storage/r2.ts). This Worker
//     has no mock mode — the response is `{ key, url }` where `url` is
//     built with `getPublicUrl(env.PUBLIC_CDN_URL, key)`.
import { Hono } from "hono";
import type { Bindings } from "@/lib/env";
import { getEnv } from "@/lib/env";
import type { AdminVariables } from "@/middleware/admin";
import { requireAdmin } from "@/middleware/admin";
import { frameAssetKey, getPublicUrl, uploadObject, validateUpload } from "@/lib/storage";
import type { FrameAssetPrefix } from "@/lib/storage";
import { generateUploadName } from "@/lib/id";
import { logger } from "@/lib/logger";

const upload = new Hono<{ Bindings: Bindings; Variables: AdminVariables }>();

upload.use("*", requireAdmin);

const ALLOWED_TYPES = new Set<FrameAssetPrefix>(["backgrounds", "logos", "previews"]);

upload.post("/", async (c) => {
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ error: "Body tidak valid" }, 400);
  }

  // @cloudflare/workers-types types `FormData.get()` as `string | null` only
  // (it doesn't model the file-upload overload), even though a real
  // multipart request can hand back a `File`. Cast through `unknown` so the
  // `instanceof File` runtime check below — which is what actually matters
  // on Workers — still type-checks.
  const file = form.get("file") as unknown as File | string | null;
  const typeRaw = form.get("type");
  if (!(file instanceof File)) {
    return c.json({ error: "File tidak ditemukan" }, 400);
  }
  const type = typeof typeRaw === "string" ? typeRaw : "backgrounds";
  if (!ALLOWED_TYPES.has(type as FrameAssetPrefix)) {
    return c.json({ error: "Tipe upload tidak valid" }, 400);
  }

  const validationError = validateUpload({ type: file.type, size: file.size });
  if (validationError === "invalid_mime") {
    return c.json({ error: "Hanya file PNG yang diperbolehkan" }, 400);
  }
  if (validationError === "too_large") {
    return c.json({ error: "Ukuran file melebihi 5MB" }, 400);
  }

  const filename = generateUploadName("png");
  // Frame assets live under {type}/{uuid}.png in R2. We use a folder per
  // type for browseability rather than per frame ID, since the form
  // uploads happen *before* the frame row exists.
  const key = frameAssetKey(type as FrameAssetPrefix, filename);
  const env = getEnv(c.env);

  await uploadObject(c.env.BUCKET, {
    key,
    body: file,
    contentType: "image/png",
  });

  const url = getPublicUrl(env.PUBLIC_CDN_URL, key);
  logger.info("upload_saved", { key, size: file.size });
  return c.json({ key, url });
});

export default upload;
