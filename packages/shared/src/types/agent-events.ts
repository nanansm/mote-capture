// Kontrak booth-agent (mini PC) <-> kiosk, ws `/agent/ws` (PRD bagian 9).
// Agent -> kiosk, JSON `{type, ...}`. Dipisah dari `/ws/*` (proxy ke DO).

export type PrintState = "queued" | "printing" | "done" | "failed";
export type UploadState = "pending" | "uploading" | "done" | "failed";
export type PhotoSlot = 1 | 2 | 3 | 4;

export type AgentEvent =
  | { type: "camera.status"; connected: boolean; model: string | null; lastError: string | null }
  | { type: "shutter_fired"; sessionId: string; slot: PhotoSlot }
  | { type: "photo.ready"; sessionId: string; slot: PhotoSlot; thumbUrl: string; retakeUsed: boolean }
  | { type: "photo.failed"; sessionId: string; slot: PhotoSlot; error: string }
  | { type: "compose.done"; sessionId: string; compositeUrl: string }
  | { type: "compose.failed"; sessionId: string; error: string }
  | { type: "print.status"; sessionId: string; sheet: 1 | 2; state: PrintState; cupsJobId: number | null }
  | { type: "upload.status"; sessionId: string; kind: "photo" | "composite"; state: UploadState; attempt: number }
  | { type: "counters.updated"; paper: number; ink: number; lowPaper: boolean; lowInk: boolean };

export type AgentEventType = AgentEvent["type"];

/** `GET /health` agent -> `activeSession` (pemulihan kiosk, PRD bagian 5). */
export type AgentActiveSession = {
  id: string;
  /** Slot pertama yang belum punya foto (1..4). */
  nextSlot: PhotoSlot;
  retakeUsed: boolean[];
  /** `thumbUrl` per slot (panjang 4, `null` = belum ada foto). */
  thumbs: (string | null)[];
  phase: "capturing" | "reviewing" | "composing" | "finished";
};

/** Body `POST /api/bridge/session/:id/print-status` (disimpan di sessions.metadata.print). */
export type PrintStatusReport = {
  sheet: 1 | 2;
  state: PrintState;
  cupsJobId: number | null;
  error?: string;
};

/** Penghitung opsional di heartbeat agent. */
export type AgentCounters = { paper: number; ink: number };

/** `GET /health` agent (PRD bagian 9). */
export type AgentHealth = {
  camera: { connected: boolean; model: string | null; lastError: string | null };
  printer: { state: "idle" | "printing" | "stopped" | "unknown"; reason?: string | null };
  queue: { pending: number; failed: number };
  counters: { paper: number; ink: number; lowPaper: boolean; lowInk: boolean };
  activeSession: AgentActiveSession | null;
};

/** `POST /staff/login` agent. 401 membawa sisa percobaan, 423 membawa batas kunci. */
export type StaffLoginOk = { token: string; expiresAt: string };
export type StaffLoginErr = { error: "WRONG_PIN"; attemptsLeft: number } | { error: "LOCKED"; lockedUntil: string };

/** Header token halaman staf untuk semua `/staff/*` selain login. */
export const STAFF_TOKEN_HEADER = "x-staff-token";

/** `POST /staff/camera-reset` -> hasil `gphoto2 --summary` setelah usbreset. */
export type StaffCameraResetOk = { ok: boolean; camera: AgentHealth["camera"] };

/** `POST /staff/cancel-voucher` body + balasan (kode voucher staff-cancel). */
export type StaffCancelVoucherBody = { sessionId: string };
export type StaffCancelVoucherOk = { code: string; voucherId: string };

/** `POST /staff/counters`: tambah kertas dan/atau set tinta. */
export type StaffCountersBody = { paperAdd?: number; inkSet?: number };
export type StaffCountersOk = AgentHealth["counters"];

/** `GET /staff/sessions`: 20 sesi terakhir untuk cetak ulang per lembar. */
export type StaffRecentSession = { id: string; compositeUrl: string; createdAt: string };

/** `POST /print/reprint` (butuh token staf). */
export type ReprintBody = { sessionId: string; sheet: 1 | 2 };
