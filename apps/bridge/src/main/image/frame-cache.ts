// Caches frame PNGs locally so we don't re-download per session. Key by
// frameId; URL change triggers re-download.
import fs from "node:fs";
import path from "node:path";
import { FRAMES_CACHE_DIR, ensureDirs } from "../paths";
import { logger } from "../logger";
import type { CloudClient } from "../cloud-api";

type CacheRecord = { url: string; cachedAt: number };

function indexPath(): string {
  return path.join(FRAMES_CACHE_DIR, "index.json");
}

function readIndex(): Record<string, CacheRecord> {
  if (!fs.existsSync(indexPath())) return {};
  try {
    return JSON.parse(fs.readFileSync(indexPath(), "utf8"));
  } catch {
    return {};
  }
}

function writeIndex(idx: Record<string, CacheRecord>): void {
  fs.writeFileSync(indexPath(), JSON.stringify(idx, null, 2), "utf8");
}

export async function getCachedFrame(
  cloud: CloudClient,
  opts: { frameId: string; url: string | null | undefined },
): Promise<string | null> {
  if (!opts.url) return null;
  ensureDirs();
  const idx = readIndex();
  const cached = idx[opts.frameId];
  const filePath = path.join(FRAMES_CACHE_DIR, `${opts.frameId}.png`);
  if (cached && cached.url === opts.url && fs.existsSync(filePath)) {
    return filePath;
  }
  await cloud.downloadFile(opts.url, filePath);
  idx[opts.frameId] = { url: opts.url, cachedAt: Date.now() };
  writeIndex(idx);
  logger.info("frame_cache_download", { frameId: opts.frameId, url: opts.url });
  return filePath;
}
