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
  nextSlot: PhotoSlot;
  retakeUsed: boolean[];
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
