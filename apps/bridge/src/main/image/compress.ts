// Resize + recompress a JPEG so it fits under the cloud upload limit.
// Cloud /api/session/[id]/photos rejects bodies > 5 MB; we aim for 4.5 MB
// to leave headroom for multipart overhead.
//
// Strategy:
//   - Source <= MAX_UPLOAD_SIZE: return as-is (no work, no temp file).
//   - Source > MAX_UPLOAD_SIZE: resize long edge to TARGET_LONG_EDGE, then
//     start at quality 85 and step down by 10 until either the result fits
//     or we hit the floor (60). 2400px @ q60 is well under 4.5MB for any
//     real-world DSLR JPG, so the floor is theoretical.
//
// We deliberately keep the original file untouched so the composite/print
// pipeline (which is local-only) can use full-quality pixels.
import path from "node:path";
import fsp from "node:fs/promises";
import sharp from "sharp";
import { logger } from "../logger";

const MAX_UPLOAD_SIZE = 4.5 * 1024 * 1024; // 4.5 MB safe margin under cloud's 5 MB cap
const TARGET_LONG_EDGE = 2400;             // px, plenty for 4R @ 300dpi (1800x1200)
const QUALITY_INITIAL = 85;
const QUALITY_FLOOR = 60;
const QUALITY_STEP = 10;

export type CompressResult = {
  // Path to feed to the uploader. May equal `original` when no compression was needed.
  uploadPath: string;
  // True when a separate compressed file was produced (caller should unlink after upload).
  compressed: boolean;
  bytes: number;
  quality?: number;
};

export async function ensureWithinSizeLimit(originalPath: string): Promise<CompressResult> {
  const stats = await fsp.stat(originalPath);
  if (stats.size <= MAX_UPLOAD_SIZE) {
    return { uploadPath: originalPath, compressed: false, bytes: stats.size };
  }

  logger.info("compress_start", {
    originalPath,
    originalBytes: stats.size,
    maxBytes: MAX_UPLOAD_SIZE,
  });

  const ext = path.extname(originalPath) || ".jpg";
  const compressedPath = originalPath.slice(0, -ext.length) + "-compressed.jpg";

  let lastBytes = 0;
  for (let quality = QUALITY_INITIAL; quality >= QUALITY_FLOOR; quality -= QUALITY_STEP) {
    await sharp(originalPath)
      .rotate() // auto-rotate per EXIF orientation
      .resize({
        width: TARGET_LONG_EDGE,
        height: TARGET_LONG_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality, mozjpeg: true, progressive: true })
      .toFile(compressedPath);

    const out = await fsp.stat(compressedPath);
    lastBytes = out.size;
    if (out.size <= MAX_UPLOAD_SIZE) {
      logger.info("compress_ok", {
        compressedPath,
        compressedBytes: out.size,
        quality,
        savedRatio: +(1 - out.size / stats.size).toFixed(3),
      });
      return { uploadPath: compressedPath, compressed: true, bytes: out.size, quality };
    }
  }

  // Best-effort failure: clean up the (still oversized) compressed file
  // so we don't leak temp data, then surface a clear error.
  await fsp.unlink(compressedPath).catch(() => undefined);
  throw new Error(
    `Tidak bisa kompres foto di bawah ${(MAX_UPLOAD_SIZE / 1024 / 1024).toFixed(1)} MB ` +
      `(hasil ${(lastBytes / 1024 / 1024).toFixed(2)} MB pada quality ${QUALITY_FLOOR}). ` +
      "Foto terlalu besar/kompleks - coba turunkan resolusi kamera.",
  );
}
