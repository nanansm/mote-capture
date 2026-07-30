// Isomorphic WebSocket client built on the envelope protocol from
// `./envelope.ts`. Runs unmodified in the kiosk browser, in the Node bridge,
// and against a Cloudflare Durable Object.
//
// This file must stay free of Node-only APIs (no `ws`, no `events`, no
// `node:*`). Node callers inject their WebSocket implementation via the
// `factory` option; browsers can omit it and fall back to the global
// `WebSocket`.

import { decode, encode, isPush, isReply, WS_REQUEST_TIMEOUT_MS } from "./envelope";

/**
 * The minimal surface this client needs from a WebSocket instance. Both the
 * browser's native `WebSocket` and the `ws` npm package satisfy this shape,
 * so a Node caller can pass `() => new WSFromWsPackage(url)` as `factory`
 * without this file ever importing `ws` itself.
 */
export interface MinimalWebSocket {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
}

/** Standard WebSocket readyState values (identical across DOM and `ws`). */
const READY_STATE = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
} as const;

export type WebSocketFactory = (
  url: string,
  protocols?: string | string[],
) => MinimalWebSocket;

export interface CreateWsClientOptions {
  /** Target URL, or a function returning it (re-evaluated on every (re)connect — handy for one-shot auth tokens). */
  url: string | (() => string);
  protocols?: string | string[];
  /** WebSocket constructor injection. Required in Node; optional in the browser (falls back to global `WebSocket`). */
  factory?: WebSocketFactory;
  onOpen?: () => void;
  onClose?: (code?: number, reason?: string) => void;
  onError?: (err: unknown) => void;
  /** Reconnect automatically after an unexpected close. Default true. */
  autoReconnect?: boolean;
  /** Initial reconnect delay in ms. Default 1000. */
  minBackoffMs?: number;
  /** Reconnect delay ceiling in ms. Default 15000. */
  maxBackoffMs?: number;
}

export interface WsClient {
  /** Send a request envelope and wait for the matching reply. Rejects on error reply, timeout, or disconnect. */
  request(ev: string, data?: unknown, timeoutMs?: number): Promise<unknown>;
  /** Send a push envelope with no reply expected. */
  send(ev: string, data?: unknown): void;
  /** Subscribe to server pushes for a given event name. */
  on(ev: string, handler: (data: unknown) => void): void;
  /** Unsubscribe a previously-registered push handler. */
  off(ev: string, handler: (data: unknown) => void): void;
  /** Close the socket and stop reconnecting. */
  close(): void;
  readonly readyState: number;
  readonly isConnected: boolean;
}

interface PendingRequest {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function defaultFactory(url: string, protocols?: string | string[]): MinimalWebSocket {
  // Cast through `unknown`: this package is type-checked under several lib
  // configurations (DOM for the SPA, @cloudflare/workers-types for the Worker,
  // Node for the bridge) and the global `WebSocket` shape differs between
  // them. Only the members in MinimalWebSocket are ever used.
  const Ctor = (
    globalThis as unknown as {
      WebSocket?: new (url: string, protocols?: string | string[]) => MinimalWebSocket;
    }
  ).WebSocket;
  if (!Ctor) {
    throw new Error(
      "createWsClient: no global WebSocket found — pass `factory` explicitly (required in Node; see the `ws` package).",
    );
  }
  return new Ctor(url, protocols);
}

function resolveUrl(url: string | (() => string)): string {
  return typeof url === "function" ? url() : url;
}

function computeBackoffMs(attempt: number, minMs: number, maxMs: number): number {
  const raw = Math.min(minMs * 2 ** attempt, maxMs);
  const jitter = raw * 0.3 * Math.random();
  return Math.round(raw + jitter);
}

export function createWsClient(opts: CreateWsClientOptions): WsClient {
  const factory = opts.factory ?? defaultFactory;
  const autoReconnect = opts.autoReconnect ?? true;
  const minBackoffMs = opts.minBackoffMs ?? 1_000;
  const maxBackoffMs = opts.maxBackoffMs ?? 15_000;

  let socket: MinimalWebSocket | null = null;
  let manualClose = false;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let nextId = 1;
  const pending = new Map<number, PendingRequest>();
  const pushHandlers = new Map<string, Set<(data: unknown) => void>>();

  function rejectAllPending(reason: string): void {
    for (const [, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
    }
    pending.clear();
  }

  function scheduleReconnect(): void {
    if (!autoReconnect || manualClose) return;
    if (reconnectTimer) return; // already scheduled
    const delay = computeBackoffMs(reconnectAttempt, minBackoffMs, maxBackoffMs);
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function connect(): void {
    manualClose = false;
    nextId = 1; // id counter restarts fresh for every new connection
    const url = resolveUrl(opts.url);
    const ws = factory(url, opts.protocols);
    socket = ws;

    ws.onopen = () => {
      reconnectAttempt = 0;
      opts.onOpen?.();
    };

    ws.onmessage = (event) => {
      const raw = typeof event.data === "string" ? event.data : String(event.data);
      const envelope = decode(raw);
      if (envelope === null) return; // malformed frame — drop, never throw

      if (isReply(envelope)) {
        const entry = pending.get(envelope.id);
        if (!entry) return; // reply for an id we no longer track (late/duplicate)
        clearTimeout(entry.timer);
        pending.delete(envelope.id);
        if (envelope.ok) {
          entry.resolve(envelope.data);
        } else {
          entry.reject(new Error(envelope.error));
        }
        return;
      }

      if (isPush(envelope)) {
        const handlers = pushHandlers.get(envelope.ev);
        if (handlers) {
          for (const handler of handlers) handler(envelope.data);
        }
        return;
      }
      // A Request-shaped envelope arriving at the client has no defined
      // meaning in this protocol (only client -> server requests exist) —
      // ignore it rather than throw.
    };

    ws.onerror = (err) => {
      opts.onError?.(err);
    };

    ws.onclose = (event) => {
      socket = null;
      rejectAllPending("WebSocket closed before a reply was received");
      opts.onClose?.(event?.code, event?.reason);
      scheduleReconnect();
    };
  }

  connect();

  function isConnected(): boolean {
    return socket !== null && socket.readyState === READY_STATE.OPEN;
  }

  function request(ev: string, data?: unknown, timeoutMs = WS_REQUEST_TIMEOUT_MS): Promise<unknown> {
    if (!isConnected() || !socket) {
      return Promise.reject(new Error(`WebSocket is not connected — cannot send request "${ev}"`));
    }
    const id = nextId++;
    const activeSocket = socket;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`WebSocket request "${ev}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      try {
        activeSocket.send(encode({ id, ev, data }));
      } catch (err) {
        clearTimeout(timer);
        pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  function send(ev: string, data?: unknown): void {
    if (!isConnected() || !socket) {
      throw new Error(`WebSocket is not connected — cannot send "${ev}"`);
    }
    socket.send(encode({ ev, data }));
  }

  function on(ev: string, handler: (data: unknown) => void): void {
    let handlers = pushHandlers.get(ev);
    if (!handlers) {
      handlers = new Set();
      pushHandlers.set(ev, handlers);
    }
    handlers.add(handler);
  }

  function off(ev: string, handler: (data: unknown) => void): void {
    pushHandlers.get(ev)?.delete(handler);
  }

  function close(): void {
    manualClose = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    rejectAllPending("WebSocket closed by client");
    socket?.close();
    socket = null;
  }

  return {
    request,
    send,
    on,
    off,
    close,
    get readyState() {
      return socket?.readyState ?? READY_STATE.CLOSED;
    },
    get isConnected() {
      return isConnected();
    },
  };
}
