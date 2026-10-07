// Cache frame lokal: layout v2 + artwork PNG dari /api/kiosk/boot. Booth
// tetap bisa compose saat wifi putus selama frame pernah diunduh.
import fs from "node:fs/promises";
import path from "node:path";
import { validateLayoutV2, DEFAULT_LAYOUT_V2, type FrameLayoutV2 } from "@capture/shared";
import type { Cloud } from "./cloud.js";
import type { Logger } from "./log.js";

export type CachedFrame = { id: string; layout: FrameLayoutV2; artworkPath: string | null };

export class FrameCache {
  private frames = new Map<string, CachedFrame>();
  private dir: string;

  constructor(
    dataDir: string,
    private cloud: Cloud,
    private cdnBase: string,
    private log: Logger,
  ) {
    this.dir = path.join(dataDir, "frames");
  }

  async init(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    // Muat indeks lama: compose tetap jalan walau boot cloud gagal.
    try {
      const raw = await fs.readFile(path.join(this.dir, "index.json"), "utf8");
      for (const f of JSON.parse(raw) as CachedFrame[]) this.frames.set(f.id, f);
    } catch {
      /* belum ada cache */
    }
  }

  /** Tarik daftar frame terbaru. Gagal = pakai cache lama, tidak throw. */
  async refresh(): Promise<boolean> {
    const r = await this.cloud.boot();
    if (r.status !== 200 || !r.body?.data) {
      this.log.warn("frames_refresh_failed", { status: r.status, error: r.error });
      return false;
    }
    for (const f of r.body.data.frames) {
      const layout = f.layoutJson;
      if (validateLayoutV2(layout).length) {
        this.log.warn("frame_layout_invalid", { frameId: f.id });
        continue;
      }
      let artworkPath: string | null = null;
      if (layout.artworkKey) {
        // Nama file ikut kunci artwork: artwork diganti admin = file baru.
        const safe = layout.artworkKey.replace(/[^A-Za-z0-9._-]/g, "_");
        artworkPath = path.join(this.dir, `${f.id}-${safe}`);
        const exists = await fs.stat(artworkPath).then(() => true, () => false);
        if (!exists) {
          try {
            const buf = await this.cloud.download(`${this.cdnBase}/${layout.artworkKey.replace(/^\/+/, "")}`);
            const tmp = `${artworkPath}.tmp`;
            await fs.writeFile(tmp, buf);
            await fs.rename(tmp, artworkPath);
          } catch (err) {
            this.log.warn("frame_artwork_download_failed", { frameId: f.id, error: String(err) });
            const prev = this.frames.get(f.id);
            artworkPath = prev?.artworkPath ?? null;
          }
        }
      }
      this.frames.set(f.id, { id: f.id, layout, artworkPath });
    }
    await fs.writeFile(path.join(this.dir, "index.json"), JSON.stringify([...this.frames.values()]));
    return true;
  }

  /** Frame untuk compose. Tidak dikenal = layout default tanpa artwork (sesi berbayar tetap jadi). */
  get(frameId: string | null): CachedFrame {
    const f = frameId ? this.frames.get(frameId) : undefined;
    if (f) return f;
    if (frameId) this.log.warn("frame_unknown_fallback_default", { frameId });
    return { id: frameId ?? "default", layout: DEFAULT_LAYOUT_V2, artworkPath: null };
  }

  has(frameId: string): boolean {
    return this.frames.has(frameId);
  }
}
