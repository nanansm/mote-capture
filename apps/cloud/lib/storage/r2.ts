import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env, r2Configured } from "@/lib/env";
import { logger } from "@/lib/logger";

let client: S3Client | null = null;

export function createR2Client(): S3Client | null {
  if (!r2Configured) return null;
  if (client) return client;
  client = new S3Client({
    region: "auto",
    endpoint: env.R2_ENDPOINT,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID!,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    },
    forcePathStyle: true,
  });
  return client;
}

const LOCAL_ROOT = path.join(process.cwd(), "public", "uploads");
const PUBLIC_PREFIX = "/uploads";

function localPathFor(key: string): string {
  // Mirror R2 key structure on disk
  return path.join(LOCAL_ROOT, key);
}

export type UploadParams = {
  key: string;
  body: Buffer | Uint8Array;
  contentType: string;
};

export type UploadResult = {
  key: string;
  url: string;
  mockMode: boolean;
};

export async function uploadObject(params: UploadParams): Promise<UploadResult> {
  const { key, body, contentType } = params;
  const c = createR2Client();
  if (!c || !env.R2_BUCKET_NAME) {
    // Mock: write to local public/uploads/ so URLs still work in dev
    const dest = localPathFor(key);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, body);
    const url = `${PUBLIC_PREFIX}/${key}`;
    logger.info("storage_upload_mock", { key, size: body.byteLength });
    return { key, url, mockMode: true };
  }

  await c.send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
  logger.info("storage_upload", { key, size: body.byteLength });
  return { key, url: getPublicUrl(key), mockMode: false };
}

export async function deleteObject(key: string): Promise<void> {
  const c = createR2Client();
  if (!c || !env.R2_BUCKET_NAME) {
    const local = localPathFor(key);
    if (existsSync(local)) {
      await unlink(local).catch(() => undefined);
    }
    return;
  }
  await c.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key }));
}

export async function listObjects(prefix: string): Promise<string[]> {
  const c = createR2Client();
  if (!c || !env.R2_BUCKET_NAME) {
    // Mock: scan local dir
    const baseDir = localPathFor(prefix);
    if (!existsSync(baseDir)) return [];
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(baseDir, { withFileTypes: true }).catch(() => []);
    return entries
      .filter((e) => e.isFile())
      .map((e) => path.posix.join(prefix.replace(/\\/g, "/"), e.name));
  }
  const out = await c.send(
    new ListObjectsV2Command({ Bucket: env.R2_BUCKET_NAME, Prefix: prefix }),
  );
  return (out.Contents ?? []).map((o) => o.Key!).filter(Boolean);
}

export async function getSignedDownloadUrl(params: {
  key: string;
  expiresInSeconds?: number;
}): Promise<string> {
  const { key, expiresInSeconds } = params;
  const c = createR2Client();
  const ttl = expiresInSeconds ?? env.DOWNLOAD_LINK_EXPIRY_DAYS * 86400;
  if (!c || !env.R2_BUCKET_NAME) {
    // In mock mode, files are public under /uploads/
    return `${PUBLIC_PREFIX}/${key}`;
  }
  const cmd = new GetObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key });
  return getSignedUrl(c, cmd, { expiresIn: Math.min(ttl, 7 * 86400) });
}

export function getPublicUrl(key: string): string {
  if (env.R2_PUBLIC_URL) {
    return `${env.R2_PUBLIC_URL.replace(/\/$/, "")}/${key}`;
  }
  if (!r2Configured) return `${PUBLIC_PREFIX}/${key}`;
  // No public URL: caller should use getSignedDownloadUrl instead
  return `${PUBLIC_PREFIX}/${key}`;
}

export async function getObjectStream(key: string): Promise<Buffer> {
  const c = createR2Client();
  if (!c || !env.R2_BUCKET_NAME) {
    return readFile(localPathFor(key));
  }
  const out = await c.send(
    new GetObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key }),
  );
  if (!out.Body) throw new Error("Empty body from R2");
  return Buffer.from(await out.Body.transformToByteArray());
}

// Convert a stored URL/key back to an R2 key. Accepts:
//  - `/uploads/...` (legacy local path / mock mode)
//  - `/api/r2/...` (internal proxy URL)
//  - `https://<public>/<key>` (R2 public URL — any host, since ISP-blocked
//    public URLs may have been swapped for a custom domain mid-life)
//  - bare key (already)
export function urlToKey(urlOrKey: string): string {
  if (!urlOrKey) return urlOrKey;
  if (urlOrKey.startsWith("/uploads/")) return urlOrKey.slice("/uploads/".length);
  if (urlOrKey.startsWith("/api/r2/")) return urlOrKey.slice("/api/r2/".length);
  if (env.R2_PUBLIC_URL && urlOrKey.startsWith(env.R2_PUBLIC_URL)) {
    return urlOrKey.slice(env.R2_PUBLIC_URL.replace(/\/$/, "").length + 1);
  }
  // Generic absolute URL — strip protocol+host, return path
  const m = urlOrKey.match(/^https?:\/\/[^/]+\/(.+)$/);
  if (m) return m[1]!;
  return urlOrKey;
}

// Same-origin proxy URL. Used in <Image src=...> to bypass ISP-level MITM
// blocking of *.r2.dev. Server-side route streams via the admin endpoint
// (*.r2.cloudflarestorage.com) which Indonesian ISPs typically don't block.
export function displayUrl(urlOrKey: string | null | undefined): string {
  if (!urlOrKey) return "";
  // Mock-mode files served from /public/uploads — render directly
  if (urlOrKey.startsWith("/uploads/")) return urlOrKey;
  // Already a proxy URL
  if (urlOrKey.startsWith("/api/r2/")) return urlOrKey;
  const key = urlToKey(urlOrKey);
  if (!key) return urlOrKey;
  return `/api/r2/${key}`;
}
