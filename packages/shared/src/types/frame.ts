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

export type FrameLayout = {
  canvasWidth?: number;
  canvasHeight?: number;
  photoSlots?: FrameLayoutSlot[];
  stripCount?: number;
  cutLineX?: number;
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
