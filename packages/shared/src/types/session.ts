// Status sesi. Hanya BoothDO yang menulis. `processing` tidak lagi diproduksi
// DO (PRD bagian 4); tetap di union karena baris lama di D1 bisa memakainya.
export type SessionStatus =
  | "idle"
  | "payment"
  | "paid"
  | "capturing"
  | "processing"
  | "done"
  | "expired"
  | "failed"
  // Dibayar, "Mulai Foto" tidak ditekan 3 menit -> voucher auto-abandoned.
  | "abandoned_paid"
  // `capturing` lewat 10 menit tanpa markDone -> voucher auto-abandoned.
  | "stale"
  // Dibatalkan staf dari halaman staf -> voucher staff-cancel.
  | "cancelled";

/** Status yang mengunci booth (uang sudah masuk, pelanggan sedang di booth). */
export const BUSY_SESSION_STATUSES = ["paid", "capturing", "processing"] as const satisfies readonly SessionStatus[];

/** Status akhir. Satu-satunya jalan keluar: `stale` -> `done` lewat markDone. */
export const TERMINAL_SESSION_STATUSES = [
  "done",
  "expired",
  "failed",
  "abandoned_paid",
  "stale",
  "cancelled",
] as const satisfies readonly SessionStatus[];

export const REFUND_REASONS = ["PRINT_FAILED", "EXPIRED_PAID", "CAMERA_FAILED", "MANUAL"] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];

export const VOUCHER_SOURCES = ["manual", "auto-late-payment", "auto-abandoned", "staff-cancel"] as const;
export type VoucherSource = (typeof VOUCHER_SOURCES)[number];

/** Snapshot sesi aktif untuk pemulihan kiosk (KIOSK_READY, PRD bagian 5). */
export type ActiveSessionSnapshot = {
  id: string;
  status: SessionStatus;
  expiresAt: string | null; // ISO
  downloadToken: string | null;
};

export type Session = {
  id: string;
  boothId: string;
  frameId: string | null;
  status: SessionStatus;
  amount: number;
  paymentProvider: string | null;
  paymentRef: string | null;
  qrString: string | null;
  paidAt: Date | null;
  customerEmail: string | null;
  customerPhone: string | null;
  photoCount: number;
  printCompletedAt: Date | null;
  downloadToken: string | null;
  downloadExpiresAt: Date | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  expiredAt: Date | null;
};

export type Photo = {
  id: string;
  sessionId: string;
  url: string;
  isFinal: boolean;
  sortOrder: number;
  createdAt: Date;
};
