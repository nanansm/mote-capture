// Compose 4 foto ke kanvas layout v2 (1200×1800) + artwork PNG di atas.
// Foto di-cover-crop ke ukuran slot; artwork berlubang transparan di slot.
import fs from "node:fs/promises";
import sharp from "sharp";
import type { FrameLayoutV2 } from "@capture/shared";

export async function composeStrip(opts: {
  layout: FrameLayoutV2;
  photos: string[];
  artworkPath: string | null;
  outPath: string;
}): Promise<void> {
  const { layout, photos, artworkPath, outPath } = opts;
  if (photos.length !== layout.slots.length) throw new Error(`butuh ${layout.slots.length} foto, ada ${photos.length}`);

  const layers: sharp.OverlayOptions[] = [];
  for (let i = 0; i < layout.slots.length; i++) {
    const s = layout.slots[i]!;
    const buf = await sharp(photos[i]!).rotate().resize(s.w, s.h, { fit: "cover", position: "centre" }).toBuffer();
    layers.push({ input: buf, left: s.x, top: s.y });
  }
  if (artworkPath) {
    const art = await sharp(artworkPath)
      .resize(layout.canvasWidth, layout.canvasHeight, { fit: "fill" })
      .png()
      .toBuffer();
    layers.push({ input: art, left: 0, top: 0 });
  }

  const tmp = `${outPath}.tmp`;
  await sharp({
    create: { width: layout.canvasWidth, height: layout.canvasHeight, channels: 3, background: "#ffffff" },
  })
    .composite(layers)
    .jpeg({ quality: 92, mozjpeg: false })
    .withMetadata({ density: 300 })
    .toFile(tmp);
  await fs.rename(tmp, outPath);
}

/** Thumbnail kecil untuk layar review (kiosk memuatnya lewat /files). */
export async function makeThumb(src: string, out: string): Promise<void> {
  const tmp = `${out}.tmp`;
  await sharp(src).rotate().resize(900, 600, { fit: "cover" }).jpeg({ quality: 80 }).toFile(tmp);
  await fs.rename(tmp, out);
}
