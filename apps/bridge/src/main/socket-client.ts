// WebSocket connection manager. Replaces the old Socket.io client with the
// shared envelope-protocol client (`createWsClient` from `@capture/shared`)
// running over the `ws` npm package. Handles the bearer-token handshake,
// reconnection with exponential backoff, and routes inbound pushes to
// handlers.
//
// Auth model change vs Socket.io: raw WebSocket has no handshake payload, so
// the bridge token now travels as an `Authorization: Bearer` header on the
// `ws` client's HTTP upgrade request (browsers can't set custom headers on
// WebSocket, which is why the server route also accepts a header-only
// bearer — never a query string, see apps/api/src/index.ts).
//
// Protocol change vs Socket.io: there is no implicit ack/emit framing
// anymore. Server pushes (BRIDGE_CAPTURE/COMPOSITE/PRINT) arrive as
// `{ev, data}` envelopes and are surfaced via `wsClient.on(ev, handler)`.
// Outbound one-way messages (BRIDGE_HELLO, PRINT_COMPLETED, BRIDGE_ERROR)
// are sent via `wsClient.send(ev, data)` — fire-and-forget, matching the
// old `socket.emit(event, payload)` calls that never awaited an ack either.
import WebSocket from "ws";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { logger } from "./logger";
import type { BridgeStatus } from "../shared/types";
import { SocketEvents, createWsClient, type WsClient, type MinimalWebSocket } from "@capture/shared";

export type SocketClientOptions = {
  cloudUrl: string;
  bridgeToken: string;
  boothId: string;
  bridgeVersion: string;
};

type CaptureEventPayload = { sessionId: string; photoIndex?: number };
type CompositeEventPayload = {
  sessionId: string;
  frameId?: string;
  framePngUrl?: string;
  layoutJson?: unknown;
  photos?: Array<{ index: number; url: string }>;
};
type PrintEventPayload = {
  sessionId: string;
  compositeUrl?: string;
  printerName?: string;
};

export type SocketEventMap = {
  status: BridgeStatus;
  capture: CaptureEventPayload;
  composite: CompositeEventPayload;
  print: PrintEventPayload;
};

// Builds the `/ws/bridge/:boothId` URL from the existing `cloudUrl` config
// value, swapping the scheme for its WebSocket equivalent.
function toWsUrl(cloudUrl: string, boothId: string): string {
  const u = new URL(cloudUrl);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = `/ws/bridge/${boothId}`;
  u.search = "";
  return u.toString();
}

export class SocketClient extends EventEmitter {
  private ws: WsClient | null = null;
  private status: BridgeStatus;
  private opts: SocketClientOptions;

  constructor(opts: SocketClientOptions) {
    super();
    this.opts = opts;
    this.status = {
      connected: false,
      connecting: false,
      socketId: null,
      bridgeVersion: opts.bridgeVersion,
      platform: process.platform,
      bootedAt: new Date().toISOString(),
    };
  }

  getStatus(): BridgeStatus {
    return { ...this.status };
  }

  connect(): void {
    if (this.ws) return;
    if (!this.opts.bridgeToken || !this.opts.boothId) {
      logger.warn("socket_skip_connect", { reason: "missing token/boothId" });
      this.setStatus({ connected: false, connecting: false, lastError: "Token/boothId belum di-set" });
      return;
    }
    this.setStatus({ connecting: true, lastError: undefined });

    const client = createWsClient({
      url: () => toWsUrl(this.opts.cloudUrl, this.opts.boothId),
      // Node has no global `WebSocket` with header support, so inject the
      // `ws` package here and attach the bearer token as a real HTTP header
      // (never a query string — see the server-side route comment).
      factory: (url): MinimalWebSocket =>
        new WebSocket(url, {
          headers: { Authorization: `Bearer ${this.opts.bridgeToken}` },
        }) as unknown as MinimalWebSocket,
      minBackoffMs: 1_500,
      maxBackoffMs: 15_000,
      onOpen: () => {
        const socketId = randomUUID().slice(0, 8);
        this.setStatus({
          connected: true,
          connecting: false,
          socketId,
          lastError: undefined,
        });
        logger.info("socket_connected", { socketId });
        this.ws?.send(SocketEvents.BRIDGE_HELLO, {
          boothId: this.opts.boothId,
          version: this.opts.bridgeVersion,
        });
      },
      onClose: (code, reason) => {
        this.setStatus({
          connected: false,
          connecting: true,
          socketId: null,
          lastError: reason || `connection closed (code ${code ?? "?"})`,
        });
        logger.info("socket_disconnect", { code, reason });
      },
      onError: (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.setStatus({ connected: false, connecting: true, lastError: msg });
        logger.warn("socket_connect_error", { err: msg });
      },
    });

    client.on(SocketEvents.BRIDGE_CAPTURE, (payload) => {
      this.emit("capture", payload as CaptureEventPayload);
    });
    client.on(SocketEvents.BRIDGE_COMPOSITE, (payload) => {
      this.emit("composite", payload as CompositeEventPayload);
    });
    client.on(SocketEvents.BRIDGE_PRINT, (payload) => {
      this.emit("print", payload as PrintEventPayload);
    });

    this.ws = client;
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setStatus({ connected: false, connecting: false, socketId: null });
  }

  reconnect(newOpts?: Partial<SocketClientOptions>): void {
    if (newOpts) this.opts = { ...this.opts, ...newOpts };
    this.disconnect();
    this.connect();
  }

  emit(event: keyof SocketEventMap | string, ...args: unknown[]): boolean {
    return super.emit(event as string, ...args);
  }

  // Fire-and-forget push to the server — no reply expected. Used for
  // BRIDGE_HELLO, PRINT_COMPLETED, BRIDGE_ERROR (same shape as the old
  // `socket.emit(event, payload)` calls, which never awaited an ack).
  emitSocket(event: string, payload: unknown): void {
    if (!this.ws || !this.ws.isConnected) {
      logger.warn("socket_emit_skipped", { event });
      return;
    }
    this.ws.send(event, payload);
  }

  setHeartbeat(ts: string): void {
    this.setStatus({ lastHeartbeatAt: ts });
  }

  private setStatus(patch: Partial<BridgeStatus>): void {
    this.status = { ...this.status, ...patch };
    super.emit("status", this.getStatus());
  }
}
