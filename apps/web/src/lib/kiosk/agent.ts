// Klien booth-agent lokal (PRD bagian 9). Kiosk dilayani agent dari origin
// yang sama (http://localhost:<port>), jadi default base URL kosong = relatif.
// `VITE_AGENT_URL` hanya untuk rig uji yang memisahkan agent dari kiosk.
import {
  STAFF_TOKEN_HEADER,
  type AgentEvent,
  type AgentHealth,
  type PhotoSlot,
  type ReprintBody,
  type StaffCameraResetOk,
  type StaffCancelVoucherOk,
  type StaffCountersBody,
  type StaffCountersOk,
  type StaffLoginErr,
  type StaffLoginOk,
  type StaffRecentSession,
} from "@capture/shared";

const BASE = ((import.meta.env.VITE_AGENT_URL as string | undefined) ?? "").replace(/\/$/, "");

export class AgentError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: Record<string, unknown> | null,
  ) {
    super(message);
    this.name = "AgentError";
  }
  get code(): string | null {
    const v = this.body?.error;
    return typeof v === "string" ? v : null;
  }
}

const REQUEST_TIMEOUT_MS = 8000;

async function call<T>(path: string, init: RequestInit & { staffToken?: string } = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.staffToken) headers[STAFF_TOKEN_HEADER] = init.staffToken;
  try {
    const res = await fetch(`${BASE}${path}`, { ...init, headers, signal: ctrl.signal });
    const text = await res.text();
    let body: Record<string, unknown> | null = null;
    try {
      body = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      body = null;
    }
    if (!res.ok) throw new AgentError(`agent ${path} ${res.status}`, res.status, body);
    return body as T;
  } catch (err) {
    if (err instanceof AgentError) throw err;
    throw new AgentError(`agent ${path} tidak terjangkau`, 0, null);
  } finally {
    window.clearTimeout(timer);
  }
}

const post = <T>(path: string, body?: unknown, staffToken?: string) =>
  call<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body), staffToken });

export const agent = {
  health: () => call<AgentHealth>("/health"),
  previewUrl: () => `${BASE}/preview.mjpeg`,
  startSession: (sessionId: string, frameId: string | null) =>
    post<{ ok: boolean }>("/session/start", { sessionId, frameId }),
  capture: (sessionId: string, slot: PhotoSlot) =>
    post<{ accepted: boolean }>(`/session/${encodeURIComponent(sessionId)}/capture`, { slot }),
  retake: (sessionId: string, slot: PhotoSlot) =>
    post<{ accepted: boolean }>(`/session/${encodeURIComponent(sessionId)}/retake`, { slot }),
  compose: (sessionId: string) => post<{ compositePath: string }>(`/session/${encodeURIComponent(sessionId)}/compose`),

  staffLogin: async (pin: string): Promise<StaffLoginOk | StaffLoginErr> => {
    try {
      return await post<StaffLoginOk>("/staff/login", { pin });
    } catch (err) {
      if (err instanceof AgentError && (err.status === 401 || err.status === 423) && err.body) {
        return err.body as unknown as StaffLoginErr;
      }
      throw err;
    }
  },
  cameraReset: (token: string) => post<StaffCameraResetOk>("/staff/camera-reset", {}, token),
  cancelVoucher: (token: string, sessionId: string) =>
    post<StaffCancelVoucherOk>("/staff/cancel-voucher", { sessionId }, token),
  counters: (token: string, body: StaffCountersBody) => post<StaffCountersOk>("/staff/counters", body, token),
  recentSessions: (token: string) => call<StaffRecentSession[]>("/staff/sessions", { staffToken: token }),
  reprint: (token: string, body: ReprintBody) => post<{ jobId: number }>("/print/reprint", body, token),
};

/** URL aset dari agent (thumb/composite). Path relatif diberi BASE. */
export function agentAsset(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^(https?:|data:|blob:)/.test(url)) return url;
  return `${BASE}${url.startsWith("/") ? "" : "/"}${url}`;
}

export function agentWsUrl(): string {
  if (BASE) return BASE.replace(/^http/, "ws") + "/agent/ws";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/agent/ws`;
}

/** ws `/agent/ws` dengan reconnect backoff. Event tak dikenal diabaikan. */
export function connectAgentWs(opts: {
  onEvent: (ev: AgentEvent) => void;
  onOpen: () => void;
  onClose: () => void;
}): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let timer: number | null = null;

  const open = () => {
    if (closed) return;
    ws = new WebSocket(agentWsUrl());
    ws.onopen = () => {
      attempt = 0;
      opts.onOpen();
    };
    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(String(msg.data)) as AgentEvent;
        if (data && typeof data.type === "string") opts.onEvent(data);
      } catch {
        // frame rusak: buang, jangan lempar
      }
    };
    ws.onclose = () => {
      ws = null;
      opts.onClose();
      if (closed) return;
      const delay = Math.min(5000, 500 * 2 ** attempt++);
      timer = window.setTimeout(open, delay);
    };
    ws.onerror = () => ws?.close();
  };
  open();

  return () => {
    closed = true;
    if (timer !== null) window.clearTimeout(timer);
    ws?.close();
  };
}
