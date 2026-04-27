import path from "node:path";
import { getObjectStream } from "@/lib/storage/r2";
import { logger } from "@/lib/logger";

// Public R2 proxy. Required because some Indonesian ISPs (Indihome) MITM-block
// `*.r2.dev` public URLs with a fake cert. We fetch via the R2 admin endpoint
// (`*.r2.cloudflarestorage.com`) which is reachable, then stream back to the
// client. `sessions/` is included so the kiosk can render thumbnails during
// capture and the share page can display photos — keys embed a random session
// UUID + photo index, so they're effectively unguessable.
const PUBLIC_PREFIXES = [
  "frames/",
  "backgrounds/",
  "logos/",
  "previews/",
  "sessions/",
];

const EXT_CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

type Ctx = { params: Promise<{ key: string[] }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { key: parts } = await params;
  if (!parts || parts.length === 0) {
    return new Response("Missing key", { status: 400 });
  }
  const key = parts.join("/");
  // Path traversal guard
  if (key.includes("..") || key.includes("\\")) {
    return new Response("Invalid key", { status: 400 });
  }
  if (!PUBLIC_PREFIXES.some((p) => key.startsWith(p))) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const buffer = await getObjectStream(key);
    const ext = path.extname(key).toLowerCase();
    const contentType = EXT_CONTENT_TYPES[ext] ?? "application/octet-stream";
    return new Response(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "content-type": contentType,
        "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
      },
    });
  } catch (err) {
    logger.error("r2_proxy_error", {
      key,
      err: err instanceof Error ? err.message : String(err),
    });
    return new Response("Not found", { status: 404 });
  }
}
