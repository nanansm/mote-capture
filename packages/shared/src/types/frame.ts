export type FrameTier = "regular" | "premium";

export type FrameLayoutSlot = {
  stripIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  photoIndex: number;
  rotation?: number;
};

/** @deprecated layout v1 (strip 2×3, kanvas 1800×1200). Diganti FrameLayoutV2. */
export type FrameLayout = {
  canvasWidth?: number;
  canvasHeight?: number;
  photoSlots?: FrameLayoutSlot[];
  stripCount?: number;
  cutLineX?: number;
};

/** Slot foto layout v2 (PRD bagian 8, "Layout v2"). Koordinat px di kanvas. */
export type FrameLayoutV2Slot = { x: number; y: number; w: number; h: number };

/**
 * Layout v2: kanvas 4R portrait 1200×1800 @300dpi, tepat 4 slot rasio 3:2.
 * `artworkKey` = kunci R2 PNG artwork (berlubang transparan di posisi slot).
 */
export type FrameLayoutV2 = {
  version: 2;
  canvasWidth: number;
  canvasHeight: number;
  slots: [FrameLayoutV2Slot, FrameLayoutV2Slot, FrameLayoutV2Slot, FrameLayoutV2Slot];
  artworkKey: string | null;
};

export type Frame = {
  id: string;
  name: string;
  tier: FrameTier;
  price: number;
  backgroundUrl: string | null;
  logoUrl: string | null;
  previewUrl: string | null;
  layoutJson: FrameLayout;
  boothId: string | null;
  isActive: boolean;
  isDefault: boolean;
  seasonStart: Date | null;
  seasonEnd: Date | null;
  sortOrder: number;
  usesCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type FrameInput = {
  name: string;
  tier: FrameTier;
  price: number;
  backgroundUrl?: string | null;
  logoUrl?: string | null;
  previewUrl?: string | null;
  boothId?: string | null;
  isActive: boolean;
  isDefault: boolean;
  seasonStart?: Date | string | null;
  seasonEnd?: Date | string | null;
  sortOrder: number;
  layoutJson?: FrameLayout;
};
