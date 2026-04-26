import type { FrameTier, SessionStatus } from "../types";

export const FRAME_TIERS: Record<FrameTier, { label: string; defaultPrice: number }> = {
  regular: { label: "Regular", defaultPrice: 30000 },
  premium: { label: "Premium", defaultPrice: 40000 },
};

export const SESSION_STATUS: Record<SessionStatus, string> = {
  idle: "Idle",
  payment: "Menunggu Pembayaran",
  paid: "Sudah Dibayar",
  capturing: "Sedang Foto",
  processing: "Memproses",
  done: "Selesai",
  expired: "Kedaluwarsa",
  failed: "Gagal",
};

export const SESSION_STATUS_VARIANT: Record<
  SessionStatus,
  "default" | "secondary" | "warn" | "success" | "destructive"
> = {
  idle: "secondary",
  payment: "secondary",
  paid: "warn",
  capturing: "warn",
  processing: "warn",
  done: "success",
  expired: "destructive",
  failed: "destructive",
};

export const PAYMENT_PROVIDERS = [
  { value: "ipaymu", label: "iPaymu" },
  { value: "xendit", label: "Xendit" },
] as const;

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB
export const ALLOWED_IMAGE_MIME = ["image/png"];
