// Raw-WebSocket envelope protocol shared by cloud Worker/Durable Object, kiosk
// browser, and the Node bridge. This replaces Socket.io's implicit
// event+ack framing with an explicit, tiny, dependency-free wire format.
//
// Three shapes travel over the same socket, distinguished by their fields:
//
//   Request (client -> server, expects a reply):
//     { id: number; ev: string; data?: unknown }
//
//   Reply (server -> client, answers a specific request by id):
//     { id: number; ok: true;  data?: unknown }
//     { id: number; ok: false; error: string }
//
//   Push (server -> client, fire-and-forget, no id):
//     { ev: string; data?: unknown }
//
// Event names are NOT redefined here — reuse `SocketEvents` from
// `../types/socket-events` for the `ev` field so both sides keep a single
// source of truth for event naming.

/** Client -> server envelope that expects a matching Reply from the server. */
export interface WsRequest {
  id: number;
  ev: string;
  data?: unknown;
}

/** Server -> client success reply, answering the Request with the same id. */
export interface WsReplyOk {
  id: number;
  ok: true;
  data?: unknown;
}

/** Server -> client failure reply, answering the Request with the same id. */
export interface WsReplyErr {
  id: number;
  ok: false;
  error: string;
}

/** Server -> client reply to a Request — either success or failure. */
export type WsReply = WsReplyOk | WsReplyErr;

/** Server -> client push with no id — not a reply to anything, no ack expected. */
export interface WsPush {
  ev: string;
  data?: unknown;
}

/** Any envelope shape that can travel over the wire. */
export type WsEnvelope = WsRequest | WsReply | WsPush;

/** Default time (ms) a `request()` call waits for a reply before rejecting. */
export const WS_REQUEST_TIMEOUT_MS = 10_000;

// === Type guards ===
// These operate on already-parsed JSON values (typically `unknown` straight
// out of `decode`), so they double as runtime validation, not just narrowing.

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True if `value` is a well-formed Request envelope (`{id, ev, data?}`). */
export function isRequest(value: unknown): value is WsRequest {
  if (!isPlainObject(value)) return false;
  if (typeof value.id !== "number" || typeof value.ev !== "string") return false;
  if ("ok" in value) return false; // disambiguate from Reply
  return true;
}

/** True if `value` is a well-formed Reply envelope (ok:true or ok:false). */
export function isReply(value: unknown): value is WsReply {
  if (!isPlainObject(value)) return false;
  if (typeof value.id !== "number") return false;
  if (value.ok === true) return true;
  if (value.ok === false) return typeof value.error === "string";
  return false;
}

/** True if `value` is a well-formed Push envelope (`{ev, data?}`, no id). */
export function isPush(value: unknown): value is WsPush {
  if (!isPlainObject(value)) return false;
  if (typeof value.ev !== "string") return false;
  if ("id" in value) return false; // disambiguate from Request
  return true;
}

/** Serialize an envelope to a JSON string ready to send over a WebSocket. */
export function encode(envelope: WsEnvelope): string {
  return JSON.stringify(envelope);
}

/**
 * Parse raw text (or a JSON-serializable value) received from a WebSocket
 * back into a `WsEnvelope`. Never throws — malformed JSON or a payload that
 * doesn't match any known envelope shape both resolve to `null`, so callers
 * can safely ignore garbage frames instead of crashing the socket handler.
 */
export function decode(raw: unknown): WsEnvelope | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (isRequest(value) || isReply(value) || isPush(value)) {
    return value;
  }
  return null;
}
