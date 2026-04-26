// Composes 3 captured photos onto a 4R 1800×1200 (px) canvas using a frame
// PNG overlay. Layout B = two identical strips per print so the user can cut
// in half and share. Slots come from the frame's `layout_json`; if missing we
// fall back to DEFAULT_LAYOUT_B.
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { logger } from "../logger";
import { COMPOSITES_DIR, ensureDirs } from "../paths";

export type PhotoSlot = {
  stripIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  photoIndex: number; // 0, 1, 2
};

export type LayoutJson = {
  canvasWidth: number;
  canvasHeight: number;
  photoSlots: PhotoSlot[];
  stripCount: number;
  cutLineX?: number;
};

export const DEFAULT_LAYOUT_B: LayoutJson = {
  canvasWidth: 1800,
  canvasHeight: 1200,
  photoSlots: [
    { stripIndex: 0, x: 65, y: 80, width: 770, height: 320, photoIndex: 0 },
    { stripIndex: 0, x: 65, y: 425, width: 770, height: 320, photoIndex: 1 },
    { stripIndex: 0, x: 65, y: 770, width: 770, height: 320, photoIndex: 2 },
    { stripIndex: 1, x: 965, y: 80, width: 770, height: 320, photoIndex: 0 },
    { stripIndex: 1, x: 965, y: 425, width: 770, height: 320, photoIndex: 1 },
    { stripIndex: 1, x: 965, y: 770, width: 770, height: 320, photoIndex: 2 },
  ],
  stripCount: 2,
  cutLineX: 900,
};

export type CompositeInput = {
  sessionId: string;
  photoPaths: string[]; // exactly 3
  framePngPath?: string; // optional — if missing, only photos + cut line
  layout?: Partial<LayoutJson> | null;
};

export type CompositeResult = {
  outputPath: string;
  width: number;
  height: number;
};

function normalizeLayout(input?: Partial<LayoutJson> | null): LayoutJson {
  if (!input || !input.photoSlots || input.photoSlots.length === 0) {
    return DEFAULT_LAYOUT_B;
  }
  return {
    canvasWidth: input.canvasWidth ?? DEFAULT_LAYOUT_B.canvasWidth,
    canvasHeight: input.canvasHeight ?? DEFAULT_LAYOUT_B.canvasHeight,
    photoSlots: input.photoSlots,
    stripCount: input.stripCount ?? DEFAULT_LAYOUT_B.stripCount,
    cutLineX: input.cutLineX,
  };
}

export async function compose(input: CompositeInput): Promise<CompositeResult> {
  ensureDirs();
  if (input.photoPaths.length < 3) {
    throw new Error(`Composer butuh 3 foto, dapat ${input.photoPaths.length}`);
  }
  const layout = normalizeLayout(input.layout);
  const { canvasWidth, canvasHeight, photoSlots } = layout;

  // 1. Build base canvas (white).
  let pipeline = sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  });

  // 2. Resize each photo into each slot.
  const overlays: sharp.OverlayOptions[] = [];
  for (const slot of photoSlots) {
    const src = input.photoPaths[slot.photoIndex];
    if (!src || !fs.existsSync(src)) {
      throw new Error(`Foto index ${slot.photoIndex} tidak ada: ${src}`);
    }
    const buf = await sharp(src)
      .rotate() // honour EXIF orientation
      .resize(slot.width, slot.height, { fit: "cover", position: "centre" })
      .toBuffer();
    overlays.push({ input: buf, top: slot.y, left: slot.x });
  }

  // 3. Optional cut-line marker (light gray vertical line) for 2-strip layouts.
  if (layout.stripCount > 1 && typeof layout.cutLineX === "number") {
    const lineSvg = Buffer.from(
      `<svg width="${canvasWidth}" height="${canvasHeight}" xmlns="http://www.w3.org/2000/svg">` +
        `<line x1="${layout.cutLineX}" y1="0" x2="${layout.cutLineX}" y2="${canvasHeight}" stroke="#cbd5e1" stroke-width="2" stroke-dasharray="12 8"/>` +
        `</svg>`,
    );
    overlays.push({ input: lineSvg, top: 0, left: 0 });
  }

  // 4. Frame overlay (transparent PNG) on top of everything.
  if (input.framePngPath && fs.existsSync(input.framePngPath)) {
    const frameBuf = await sharp(input.framePngPath)
      .resize(canvasWidth, canvasHeight, { fit: "fill" })
      .png()
      .toBuffer();
    overlays.push({ input: frameBuf, top: 0, left: 0 });
  }

  pipeline = pipeline.composite(overlays);

  const outputPath = path.join(COMPOSITES_DIR, `composite-${input.sessionId}.png`);
  await pipeline.png({ compressionLevel: 6 }).toFile(outputPath);
  const stat = fs.statSync(outputPath);
  logger.info("composer_ok", {
    sessionId: input.sessionId,
    bytes: stat.size,
    out: outputPath,
  });
  return { outputPath, width: canvasWidth, height: canvasHeight };
}
