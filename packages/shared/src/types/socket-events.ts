// Socket.io event names + payload types shared between cloud + bridge + admin.
import type { Frame, FrameLayoutV2 } from "./frame";
import type { ActiveSessionSnapshot, SessionStatus } from "./session";

export const SocketEvents = {
  // Cloud → Kiosk
  KIOSK_READY: "kiosk:ready",
  STATE_CHANGE: "state:change",
  PAYMENT_QR: "payment:qr",
  PAYMENT_PAID: "payment:paid",
  PAYMENT_EXPIRED: "payment:expired",
  PHOTO_TAKEN: "photo:taken",
  COMPOSITE_READY: "composite:ready",
  PRINT_DONE: "print:done",
  ERROR: "error",
  RESET: "session:reset",

  // Kiosk → Cloud
  KIOSK_HELLO: "kiosk:hello",
  FRAME_SELECTED: "frame:selected",
  CONFIRM_AND_PAY: "session:create",
  START_CAPTURE: "capture:start",
  SUBMIT_CONTACT: "contact:submit",
  CANCEL: "session:cancel",

  // Cloud → Bridge
  BRIDGE_CAPTURE: "bridge:capture",
  BRIDGE_COMPOSITE: "bridge:composite",
  BRIDGE_PRINT: "bridge:print",

  // Bridge → Cloud
  BRIDGE_HELLO: "bridge:hello",
  BRIDGE_HEARTBEAT: "bridge:heartbeat",
  PHOTO_UPLOADED: "photo:uploaded",
  COMPOSITE_UPLOADED: "composite:uploaded",
  PRINT_COMPLETED: "print:completed",
  BRIDGE_ERROR: "bridge:error",

  // Cloud → Admin
  ADMIN_BOOTH_STATUS: "admin:booth:status",
  ADMIN_SESSION_UPDATE: "admin:session:update",
} as const;

export type SocketEventName = (typeof SocketEvents)[keyof typeof SocketEvents];

// === Payloads ===

export type KioskHelloPayload = {
  boothId: string;
  language?: "id" | "en";
};

export type KioskReadyPayload = {
  boothId: string;
  boothName: string;
  defaultPrice: number;
  /** Sesi yang masih hidup di DO, untuk pemulihan kiosk setelah reload (PRD bagian 5). */
  activeSession: ActiveSessionSnapshot | null;
};

export type FrameSelectedPayload = {
  frameId: string;
};

export type ConfirmAndPayPayload = {
  boothId: string;
  frameId?: string;
};

export type PaymentQrPayload = {
  sessionId: string;
  qrString: string;
  amount: number;
  expiresAt: string; // ISO
  mockMode: boolean;
};

export type PaymentPaidPayload = {
  sessionId: string;
  amount: number;
  paidAt: string;
};

export type PaymentExpiredPayload = {
  sessionId: string;
};

export type StartCapturePayload = {
  sessionId: string;
};

export type PhotoTakenPayload = {
  sessionId: string;
  index: number; // 1, 2, 3
  url: string;
};

export type CompositeReadyPayload = {
  sessionId: string;
  url: string;
  downloadToken: string;
};

export type PrintDonePayload = {
  sessionId: string;
};

export type ResetPayload = {
  sessionId?: string;
  reason?: string;
};

export type SubmitContactPayload = {
  sessionId: string;
  phone: string;
  email?: string;
};

export type AdminBoothStatusPayload = {
  boothId: string;
  online: boolean;
  inSession: boolean;
  lastSeenAt: string | null;
  bridgeOnline: boolean;
};

export type AdminSessionUpdatePayload = {
  boothId: string;
  sessionId: string;
  status: SessionStatus;
  amount: number;
};

/** Kode error yang kiosk perlu bedakan. String lain tetap boleh. */
export type KnownErrorCode =
  | "BOOTH_BUSY" // sesi lain masih paid/capturing; lihat `releasesAt`
  | "SESSION_NOT_PAID" // capture:start ditolak (mis. sudah abandoned_paid)
  | "SESSION_STALE"; // markDone ditolak: voucher pengganti sudah terpakai

export type ErrorPayload = {
  code: KnownErrorCode | (string & {});
  message: string;
  /** BOOTH_BUSY: kapan alarm tahap aktif membebaskan booth (ISO). */
  releasesAt?: string;
};

// Kiosk boot data
export type KioskBootData = {
  booth: {
    id: string;
    name: string;
    location: string | null;
    defaultPrice: number;
    paymentProvider: string;
    isActive: boolean;
  };
  // Hanya frame dengan layout v2 valid. Dipakai kiosk (pilih frame) dan
  // booth-agent (compose + cache artwork lokal).
  frames: Array<
    Pick<
      Frame,
      | "id"
      | "name"
      | "tier"
      | "price"
      | "backgroundUrl"
      | "previewUrl"
      | "logoUrl"
      | "boothId"
      | "isDefault"
      | "sortOrder"
    > & { layoutJson: FrameLayoutV2 }
  >;
  settings: {
    defaultCurrency: "IDR";
    languageDefault: "id" | "en";
    availableLanguages: Array<"id" | "en">;
  };
};

