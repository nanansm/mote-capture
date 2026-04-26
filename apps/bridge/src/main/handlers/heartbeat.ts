// Sends periodic POST /api/bridge/heartbeat with current camera + printer
// status. Cloud uses this to flag the booth Online and surface device state.
import type { CloudClient } from "../cloud-api";
import type { CameraDevice } from "../camera";
import type { PrinterDevice } from "../printer";
import type { SocketClient } from "../socket-client";
import { logger } from "../logger";

export type HeartbeatLoopOptions = {
  cloud: CloudClient;
  client: SocketClient;
  boothId: string;
  camera: () => CameraDevice;
  printer: () => PrinterDevice;
  bridgeVersion: string;
  intervalMs?: number;
};

export class HeartbeatLoop {
  private timer: NodeJS.Timeout | null = null;
  private opts: HeartbeatLoopOptions;
  private intervalMs: number;
  private lastCamera: { connected: boolean; deviceName?: string; error?: string } = { connected: false };
  private lastPrinter: { connected: boolean; deviceName?: string; error?: string } = { connected: false };

  constructor(opts: HeartbeatLoopOptions) {
    this.opts = opts;
    this.intervalMs = opts.intervalMs ?? 30_000;
  }

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  setCameraStatus(s: { connected: boolean; deviceName?: string; error?: string }): void {
    this.lastCamera = s;
  }
  setPrinterStatus(s: { connected: boolean; deviceName?: string; error?: string }): void {
    this.lastPrinter = s;
  }

  async tick(): Promise<void> {
    const cam = this.opts.camera();
    const prn = this.opts.printer();

    const payload = {
      boothId: this.opts.boothId,
      version: this.opts.bridgeVersion,
      platform: process.platform,
      camera: {
        mode: cam.mode,
        connected: this.lastCamera.connected,
        deviceName: this.lastCamera.deviceName,
        error: this.lastCamera.error,
      },
      printer: {
        mode: prn.mode,
        connected: this.lastPrinter.connected,
        deviceName: this.lastPrinter.deviceName,
        error: this.lastPrinter.error,
      },
    };

    try {
      await this.opts.cloud.heartbeat(payload);
      this.opts.client.setHeartbeat(new Date().toISOString());
    } catch (err) {
      logger.warn("heartbeat_failed", {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
