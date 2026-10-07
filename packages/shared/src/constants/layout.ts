// Layout v2 (PRD bagian 8). Murni TS tanpa dependensi, dipakai API (validasi
// frame) dan booth-agent (compose).
import type { FrameLayoutV2, FrameLayoutV2Slot } from "../types/frame";

export const LAYOUT_V2_CANVAS = { width: 1200, height: 1800 } as const;
/** Rasio slot = sensor 2000D 3:2, toleransi 2%. */
export const LAYOUT_V2_SLOT_RATIO = 3 / 2;
export const LAYOUT_V2_RATIO_TOLERANCE = 0.02;

// Dikunci owner 30 Sep 2026: 2×2, slot 525×350, margin 60, gutter 30, mulai y=120.
export const DEFAULT_LAYOUT_V2: FrameLayoutV2 = {
  version: 2,
  canvasWidth: LAYOUT_V2_CANVAS.width,
  canvasHeight: LAYOUT_V2_CANVAS.height,
  slots: [
    { x: 60, y: 120, w: 525, h: 350 },
    { x: 615, y: 120, w: 525, h: 350 },
    { x: 60, y: 500, w: 525, h: 350 },
    { x: 615, y: 500, w: 525, h: 350 },
  ],
  artworkKey: null,
};

const isInt = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);

function overlaps(a: FrameLayoutV2Slot, b: FrameLayoutV2Slot): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Validasi layout v2. Kembalikan daftar masalah (kosong = valid).
 * Aturan: version 2, kanvas 1200×1800, tepat 4 slot integer positif, semua
 * di dalam kanvas, tidak tumpang tindih, rasio w:h 3:2 ±2%.
 */
export function validateLayoutV2(input: unknown): string[] {
  const errs: string[] = [];
  if (!input || typeof input !== "object") return ["layout bukan objek"];
  const l = input as Record<string, unknown>;
  if (l.version !== 2) errs.push("version harus 2");
  if (l.canvasWidth !== LAYOUT_V2_CANVAS.width || l.canvasHeight !== LAYOUT_V2_CANVAS.height) {
    errs.push(`kanvas harus ${LAYOUT_V2_CANVAS.width}x${LAYOUT_V2_CANVAS.height}`);
  }
  if (l.artworkKey !== null && l.artworkKey !== undefined && typeof l.artworkKey !== "string") {
    errs.push("artworkKey harus string atau null");
  }
  if (!Array.isArray(l.slots) || l.slots.length !== 4) {
    errs.push("slots harus tepat 4");
    return errs;
  }
  const slots = l.slots as FrameLayoutV2Slot[];
  slots.forEach((s, i) => {
    const n = i + 1;
    if (!s || !isInt(s.x) || !isInt(s.y) || !isInt(s.w) || !isInt(s.h)) {
      errs.push(`slot ${n}: x/y/w/h harus bilangan bulat`);
      return;
    }
    if (s.x < 0 || s.y < 0 || s.w <= 0 || s.h <= 0) errs.push(`slot ${n}: ukuran/posisi tidak valid`);
    if (s.x + s.w > LAYOUT_V2_CANVAS.width || s.y + s.h > LAYOUT_V2_CANVAS.height) {
      errs.push(`slot ${n}: keluar kanvas`);
    }
    if (s.h > 0 && Math.abs(s.w / s.h - LAYOUT_V2_SLOT_RATIO) / LAYOUT_V2_SLOT_RATIO > LAYOUT_V2_RATIO_TOLERANCE) {
      errs.push(`slot ${n}: rasio harus 3:2`);
    }
  });
  if (errs.length) return errs;
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      if (overlaps(slots[i]!, slots[j]!)) errs.push(`slot ${i + 1} dan ${j + 1} tumpang tindih`);
    }
  }
  return errs;
}

export function isLayoutV2(input: unknown): input is FrameLayoutV2 {
  return validateLayoutV2(input).length === 0;
}
