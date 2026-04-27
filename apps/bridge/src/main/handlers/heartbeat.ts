// Sends periodic POST /api/bridge/heartbeat with current camera + printer
// status. Cloud uses this to flag the booth Online and surface device state.
//
// Each tick re-reads the persistent config so a freshly-saved camera/printer
// mode appears in the next heartbeat without needing a full restart - this
// avoids stale "mode: mock" payloads after the user switched to win32/digicam.
import type { CloudClient } from "../cloud-api";
import type { CameraDevice } from "../camera";
import type { PrinterDevice } from "../printer";
import type { SocketClient } from "../socket-client";
import { getStore } from "../config/store";
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
    // Read live config so newly-saved mode/device names show up immediately.
    const store = await getStore().catch(() => null);
    const config = store?.store;
    const cam = this.opts.camera();
    const prn = this.opts.printer();

    const cameraMode = config?.cameraMode ?? cam.mode;
    const printerMode = config?.printerMode ?? prn.mode;

    const payload = {
      boothId: config?.boothId || this.opts.boothId,
      version: this.opts.bridgeVersion,
      platform: process.platform,
      camera: {
        mode: cameraMode,
        deviceName: this.lastCamera.deviceName || config?.cameraDeviceName || undefined,
        connected: this.lastCamera.connected,
        error: this.lastCamera.error,
      },
      printer: {
        mode: printerMode,
        deviceName: this.lastPrinter.deviceName || config?.printerName || undefined,
        connected: this.lastPrinter.connected,
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
