// R2 storage layer for the Worker — binding-based, no AWS S3 SDK, no
// pre-signed URLs, no filesystem fallback (Workers have no filesystem).
//
// Every function takes the `R2Bucket` binding as its first argument instead
// of caching one at module scope. Workers isolates can be reused across
// requests, but a module-level singleton bound to one request's `env` is a
// correctness footgun (and pointless — `env.BUCKET` is already cheap to
// pass around). Callers get the binding from `c.env.BUCKET` (Hono context)
// or `getEnv(bindings)`'s caller and pass it straight through.
//
// The old apps/cloud implementation (apps/cloud/lib/storage/r2.ts) used an
// S3-compatible client with pre-signed GET URLs and a local `public/uploads`
// fallback (Node's `fs` module + a working-directory lookup) when R2 wasn't
// configured, plus a pair of helpers that parsed a stored URL back into a
// bucket key and back again for display. None of that carries over here:
//  - The DB now stores the R2 *key*, not a URL — nothing to parse back.
//  - Images are served straight from the public CDN domain (PUBLIC_CDN_URL,
//    e.g. Cloudflare-proxied custom domain on the bucket), never proxied
//    through the Worker — a proxy route would burn CPU time + request quota
//    on Workers Free for every kiosk render.
//  - There is no "mock mode" fallback to local disk; Workers don't have one.

import { ALLOWED_IMAGE_MIME, MAX_UPLOAD_BYTES } from "@capture/shared";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Key prefixes
//
// Verified against the old apps/cloud routes so keys written by this layer
// land in the same "folders" the rest of the system (and any existing
// objects in the bucket) already expect:
//  - frame asset uploads:  apps/cloud/app/api/upload/route.ts
//      `${type}/${filename}` where type ∈ {backgrounds, logos, previews}
//      (frames/ itself is used for the composed frame PNG referenced by a
//      frame row — see the comment in that route: "Frame assets live under
//      frames/{uuid}.png in R2")
//  - session photos/composite: apps/cloud/app/api/session/[id]/photos/route.ts
//      and .../composite/route.ts
//      `sessions/${boothId}/${sessionId}/...`
//  - installer download: apps/cloud/app/api/download/bridge/route.ts
//      `downloads/Mote-Capture-Bridge-Setup.exe`
//  - the CDN allowlist in apps/cloud/app/api/r2/[...key]/route.ts confirms
//    the full prefix set: frames/, backgrounds/, logos/, previews/, sessions/
// ---------------------------------------------------------------------------

export const STORAGE_PREFIX = {
  FRAMES: "frames",
  LOGOS: "logos",
  PREVIEWS: "previews",
  BACKGROUNDS: "backgrounds",
  SESSIONS: "sessions",
  DOWNLOADS: "downloads",
} as const;

export type FrameAssetPrefix =
  | typeof STORAGE_PREFIX.FRAMES
  | typeof STORAGE_PREFIX.LOGOS
  | typeof STORAGE_PREFIX.PREVIEWS
  | typeof STORAGE_PREFIX.BACKGROUNDS;

/** `frames/{filename}`, `logos/{filename}`, `previews/{filename}` or `backgrounds/{filename}`. */
export function frameAssetKey(prefix: FrameAssetPrefix, filename: string): string {
  return `${prefix}/${filename}`;
}

/** `sessions/{boothId}/{sessionId}/{filename}` — matches the old composite/photos routes. */
export function sessionAssetKey(boothId: string, sessionId: string, filename: string): string {
  return `sessions/${boothId}/${sessionId}/${filename}`;
}

/** `downloads/{filename}` — bridge/installer artifacts. */
export function downloadKey(filename: string): string {
  return `downloads/${filename}`;
}

/**
 * Recommended Cache-Control for a given top-level prefix. Frame assets,
 * logos, previews, backgrounds and installer downloads are effectively
 * immutable (uploads use fresh UUID/versioned filenames rather than being
 * overwritten in place), so they get a long, cacheable header. Session
 * photos are also written once and never mutated, but get a shorter TTL
 * since a kiosk may want to expire/replace a session's assets.
 */
export function cacheControlFor(prefix: string): string {
  switch (prefix) {
    case STORAGE_PREFIX.FRAMES:
    case STORAGE_PREFIX.LOGOS:
    case STORAGE_PREFIX.PREVIEWS:
    case STORAGE_PREFIX.BACKGROUNDS:
    case STORAGE_PREFIX.DOWNLOADS:
      return "public, max-age=31536000, immutable";
    case STORAGE_PREFIX.SESSIONS:
      return "public, max-age=86400";
    default:
      return "public, max-age=3600";
  }
}

// ---------------------------------------------------------------------------
// Core R2 operations
// ---------------------------------------------------------------------------

export type UploadObjectBody = ArrayBuffer | ReadableStream | Uint8Array | Blob;

export type UploadObjectParams = {
  key: string;
  body: UploadObjectBody;
  contentType: string;
  /** Defaults to `cacheControlFor(key.split("/")[0])` when omitted. */
  cacheControl?: string;
};

export type UploadObjectResult = { key: string };

export async function uploadObject(
  bucket: R2Bucket,
  { key, body, contentType, cacheControl }: UploadObjectParams,
): Promise<UploadObjectResult> {
  const topLevelPrefix = key.split("/")[0] ?? "";
  await bucket.put(key, body, {
    httpMetadata: {
      contentType,
      cacheControl: cacheControl ?? cacheControlFor(topLevelPrefix),
    },
  });
  logger.info("storage_upload", { key, contentType });
  return { key };
}

export async function getObject(bucket: R2Bucket, key: string): Promise<R2ObjectBody | null> {
  return bucket.get(key);
}

export async function deleteObject(bucket: R2Bucket, key: string): Promise<void> {
  await bucket.delete(key);
  logger.info("storage_delete", { key });
}

/**
 * Lists object keys under a prefix. Single page only (matches the old
 * ListObjectsV2Command call, which also didn't paginate) — callers needing
 * every object under a very large prefix should extend this to follow
 * `cursor`/`truncated` from `bucket.list()`.
 */
export async function listObjects(bucket: R2Bucket, prefix: string): Promise<string[]> {
  const result = await bucket.list({ prefix });
  return result.objects.map((obj) => obj.key);
}

// ---------------------------------------------------------------------------
// Public URL (pure function — no bucket needed)
// ---------------------------------------------------------------------------

/**
 * Builds the public CDN URL for a key. `cdnBase` is `env.PUBLIC_CDN_URL`.
 * Pure and trailing-slash tolerant on both sides: a base with or without a
 * trailing slash, and a key with or without a leading slash, always produce
 * the same single-slash-joined URL.
 */
export function getPublicUrl(cdnBase: string, key: string): string {
  return `${cdnBase.replace(/\/$/, "")}/${key.replace(/^\/+/, "")}`;
}

// ---------------------------------------------------------------------------
// Upload validation (MIME + size, from @capture/shared)
// ---------------------------------------------------------------------------

export type UploadValidationError = "invalid_mime" | "too_large";

export function validateUpload(file: { type: string; size: number }): UploadValidationError | null {
  if (!ALLOWED_IMAGE_MIME.includes(file.type)) return "invalid_mime";
  if (file.size > MAX_UPLOAD_BYTES) return "too_large";
  return null;
}
