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
  abandoned_paid: "Dibayar, Tidak Dimulai",
  stale: "Macet (Voucher Terbit)",
  cancelled: "Dibatalkan Staf",
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
  abandoned_paid: "destructive",
  stale: "destructive",
  cancelled: "destructive",
};

export const PAYMENT_PROVIDERS = [
  { value: "ipaymu", label: "iPaymu" },
  { value: "xendit", label: "Xendit" },
  { value: "doku", label: "DOKU" },
] as const;

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB
// Unggahan sesi dari booth-agent: JPEG (raw 2000D + composite sharp q92);
// PNG tetap diterima untuk klien lama.
export const ALLOWED_IMAGE_MIME = ["image/png", "image/jpeg"];
// Aset frame (artwork berlubang transparan) wajib PNG.
export const ALLOWED_FRAME_ASSET_MIME = ["image/png"];

/** Ekstensi kunci R2 mengikuti content-type (PRD bagian 8 #18). */
export function imageExtForMime(mime: string): "png" | "jpg" {
  return mime === "image/jpeg" ? "jpg" : "png";
}

export * from "./kiosk";
export * from "./layout";
