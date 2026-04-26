// Socket.io client connection manager. Handles auth handshake, reconnection
// with exponential backoff, and routes inbound events to handlers.
import { io as ioClient, Socket } from "socket.io-client";
import { EventEmitter } from "node:events";
import { logger } from "./logger";
import type { BridgeStatus } from "../shared/types";
import { SocketEvents } from "@capture/shared";

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

export class SocketClient extends EventEmitter {
  private socket: Socket | null = null;
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
    if (this.socket) return;
    if (!this.opts.bridgeToken || !this.opts.boothId) {
      logger.warn("socket_skip_connect", { reason: "missing token/boothId" });
      this.setStatus({ connected: false, connecting: false, lastError: "Token/boothId belum di-set" });
      return;
    }
    this.setStatus({ connecting: true, lastError: undefined });
    const sock = ioClient(this.opts.cloudUrl, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1500,
      reconnectionDelayMax: 15_000,
      timeout: 10_000,
      auth: {
        type: "bridge",
        boothId: this.opts.boothId,
        token: this.opts.bridgeToken,
      },
    });

    sock.on("connect", () => {
      this.setStatus({
        connected: true,
        connecting: false,
        socketId: sock.id ?? null,
        lastError: undefined,
      });
      logger.info("socket_connected", { socketId: sock.id });
      sock.emit(SocketEvents.BRIDGE_HELLO, {
        boothId: this.opts.boothId,
        version: this.opts.bridgeVersion,
      });
    });

    sock.on("connect_error", (err: Error) => {
      const msg = err.message || "connect failed";
      this.setStatus({ connected: false, connecting: true, lastError: msg });
      logger.warn("socket_connect_error", { err: msg });
    });

    sock.on("disconnect", (reason: string) => {
      this.setStatus({ connected: false, connecting: true, socketId: null, lastError: reason });
      logger.info("socket_disconnect", { reason });
    });

    sock.on(SocketEvents.BRIDGE_CAPTURE, (payload: CaptureEventPayload) => {
      this.emit("capture", payload);
    });

    sock.on(SocketEvents.BRIDGE_COMPOSITE, (payload: CompositeEventPayload) => {
      this.emit("composite", payload);
    });

    sock.on(SocketEvents.BRIDGE_PRINT, (payload: PrintEventPayload) => {
      this.emit("print", payload);
    });

    this.socket = sock;
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
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

  emitSocket(event: string, payload: unknown): void {
    if (!this.socket || !this.socket.connected) {
      logger.warn("socket_emit_skipped", { event });
      return;
    }
    this.socket.emit(event, payload);
  }

  setHeartbeat(ts: string): void {
    this.setStatus({ lastHeartbeatAt: ts });
  }

  private setStatus(patch: Partial<BridgeStatus>): void {
    this.status = { ...this.status, ...patch };
    super.emit("status", this.getStatus());
  }
}
