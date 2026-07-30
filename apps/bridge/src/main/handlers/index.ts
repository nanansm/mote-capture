// Wires the SocketClient events (capture/composite/print) to the actual
// camera/printer/composer drivers. Holds per-session state in memory so
// multiple sequential photo events can compose into one print.
import fs from "node:fs";
import fsp from "node:fs/promises";
import { logger } from "../logger";
import { errMsg, type CloudClient } from "../cloud-api";
import { createCamera, type CameraDevice } from "../camera";
import { createPrinter, type PrinterDevice } from "../printer";
import { compose } from "../image/composer";
import { ensureWithinSizeLimit } from "../image/compress";
import { getCachedFrame } from "../image/frame-cache";
import { tempFile } from "../paths";
import type { SocketClient } from "../socket-client";
import type { BridgeConfig } from "../../shared/types";
import { SocketEvents } from "@capture/shared";

type SessionContext = {
  sessionId: string;
  photos: Map<number, string>; // photoIndex (1..3) → filePath
};

export type HandlerDeps = {
  client: SocketClient;
  cloud: CloudClient;
  config: BridgeConfig;
};

export class BridgeHandlers {
  private camera: CameraDevice;
  private printer: PrinterDevice;
  private sessions = new Map<string, SessionContext>();
  private deps: HandlerDeps;

  constructor(deps: HandlerDeps) {
    this.deps = deps;
    this.camera = createCamera(deps.config.cameraMode, {
      deviceName: deps.config.cameraDeviceName,
      digiCamControlPath: deps.config.digiCamControlPath,
      digiCamSessionFolder: deps.config.digiCamSessionFolder,
      ffmpegPath: deps.config.ffmpegPath,
    });
    this.printer = createPrinter(deps.config.printerMode, {
      printerName: deps.config.printerName,
    });
  }

  async init(): Promise<void> {
    // Best-effort init — failures are surfaced via heartbeat status.
    await this.camera.init().catch((err) => {
      logger.warn("camera_init_failed", { err: errMsg(err) });
    });
    await this.printer.init().catch((err) => {
      logger.warn("printer_init_failed", { err: errMsg(err) });
    });
  }

  attach(): void {
    const { client } = this.deps;
    client.on("capture", (p) => void this.handleCapture(p));
    client.on("composite", (p) => void this.handleComposite(p));
    client.on("print", (p) => void this.handlePrint(p));
  }

  private context(sessionId: string): SessionContext {
    let ctx = this.sessions.get(sessionId);
    if (!ctx) {
      ctx = { sessionId, photos: new Map() };
      this.sessions.set(sessionId, ctx);
    }
    return ctx;
  }

  private async handleCapture(payload: { sessionId: string; photoIndex?: number }): Promise<void> {
    const sessionId = payload.sessionId;
    const ctx = this.context(sessionId);
    const photoIndex = payload.photoIndex ?? ctx.photos.size + 1;
    logger.info("handler_capture", { sessionId, photoIndex });

    // Best-effort: kick the camera's live view on the first capture of a
    // session so the kiosk's countdown overlay has a real preview to render.
    // Cameras without a live view (mock, gphoto2, webcam-mac) silently no-op.
    if (photoIndex === 1 && this.camera.startLiveView) {
      await this.camera.startLiveView().catch((err) => {
        logger.debug("handler_live_view_start_failed", {
          sessionId,
          err: errMsg(err),
        });
      });
    }

    try {
      const cap = await this.camera.capture();
      // Keep the full-quality original in the session map - composite/print
      // happens locally and benefits from the extra pixels.
      ctx.photos.set(photoIndex, cap.filePath);

      // The cloud rejects > 5 MB bodies; resize+recompress if needed before
      // upload. The compressed temp file is separate from the original so
      // composite still gets the high-res source.
      const compressed = await ensureWithinSizeLimit(cap.filePath);
      const upload = await this.deps.cloud.uploadPhoto(
        sessionId,
        compressed.uploadPath,
        photoIndex,
      );
      if (compressed.compressed) {
        await fsp.unlink(compressed.uploadPath).catch(() => undefined);
      }

      // No upload-ack push back to the server anymore — the HTTP upload
      // route itself notifies BoothDO (see apps/api/src/routes/bridge.ts),
      // which replies with the next BRIDGE_CAPTURE or BRIDGE_COMPOSITE push.
      // Nothing to send here.
      logger.info("handler_capture_uploaded", {
        sessionId,
        photoIndex,
        key: upload.key,
        uploadBytes: compressed.bytes,
        compressed: compressed.compressed,
      });
    } catch (err) {
      const message = errMsg(err);
      logger.error("handler_capture_failed", { sessionId, err: message });
      this.deps.client.emitSocket(SocketEvents.BRIDGE_ERROR, {
        code: "CAPTURE_FAILED",
        sessionId,
        message,
      });
    }
  }

  private async handleComposite(payload: {
    sessionId: string;
    frameId?: string;
    framePngUrl?: string;
    layoutJson?: unknown;
    photos?: Array<{ index: number; url: string }>;
  }): Promise<void> {
    const ctx = this.context(payload.sessionId);
    if (ctx.photos.size < 3) {
      logger.warn("handler_composite_incomplete", {
        sessionId: payload.sessionId,
        have: ctx.photos.size,
      });
      // Try to fall back to URLs if cloud sent them.
      if (payload.photos && payload.photos.length === 3) {
        for (const p of payload.photos) {
          const local = tempFile("dl", "jpg");
          await this.deps.cloud.downloadFile(p.url, local).catch(() => undefined);
          if (fs.existsSync(local)) ctx.photos.set(p.index, local);
        }
      }
    }
    if (ctx.photos.size < 3) {
      this.deps.client.emitSocket(SocketEvents.BRIDGE_ERROR, {
        code: "COMPOSITE_NO_PHOTOS",
        sessionId: payload.sessionId,
        message: `Composite butuh 3 foto, hanya ada ${ctx.photos.size}`,
      });
      return;
    }

    try {
      const ordered = [1, 2, 3].map((i) => ctx.photos.get(i)!).filter(Boolean) as string[];
      let framePath: string | undefined;
      if (payload.frameId && payload.framePngUrl) {
        const cached = await getCachedFrame(this.deps.cloud, {
          frameId: payload.frameId,
          url: payload.framePngUrl,
        });
        framePath = cached ?? undefined;
      }
      const result = await compose({
        sessionId: payload.sessionId,
        photoPaths: ordered,
        framePngPath: framePath,
        layout: (payload.layoutJson as never) ?? null,
      });
      const upload = await this.deps.cloud.uploadComposite(payload.sessionId, result.outputPath);
      // No upload-ack push here either — same reasoning as the capture path
      // above: the upload route notifies BoothDO directly, which replies
      // with BRIDGE_PRINT.
      logger.info("handler_composite_uploaded", { sessionId: payload.sessionId, key: upload.key });
      // Stash composite path for the upcoming print event.
      ctx.photos.set(99, result.outputPath);
    } catch (err) {
      const message = errMsg(err);
      logger.error("handler_composite_failed", { sessionId: payload.sessionId, err: message });
      this.deps.client.emitSocket(SocketEvents.BRIDGE_ERROR, {
        code: "COMPOSITE_FAILED",
        sessionId: payload.sessionId,
        message,
      });
    }
  }

  private async handlePrint(payload: {
    sessionId: string;
    compositeUrl?: string;
    printerName?: string;
  }): Promise<void> {
    const ctx = this.context(payload.sessionId);
    let compositePath = ctx.photos.get(99);
    if (!compositePath && payload.compositeUrl) {
      compositePath = tempFile("composite-dl", "png");
      await this.deps.cloud.downloadFile(payload.compositeUrl, compositePath);
    }
    if (!compositePath) {
      this.deps.client.emitSocket(SocketEvents.BRIDGE_ERROR, {
        code: "PRINT_NO_COMPOSITE",
        sessionId: payload.sessionId,
        message: "Composite tidak tersedia untuk diprint",
      });
      return;
    }
    try {
      const result = await this.printer.print(compositePath);
      if (!result.ok) {
        throw new Error(result.error ?? "Print gagal");
      }
      this.deps.client.emitSocket(SocketEvents.PRINT_COMPLETED, {
        sessionId: payload.sessionId,
      });
      // Best-effort: close the camera's live view so the next session starts
      // from a clean state (also relieves the camera battery on long shifts).
      if (this.camera.stopLiveView) {
        await this.camera.stopLiveView().catch(() => undefined);
      }
      // Cleanup temp captures (keep composite for download).
      for (const [k, p] of ctx.photos) {
        if (k !== 99 && fs.existsSync(p)) {
          try {
            fs.unlinkSync(p);
          } catch {
            // ignore
          }
        }
      }
      this.sessions.delete(payload.sessionId);
    } catch (err) {
      const message = errMsg(err);
      logger.error("handler_print_failed", { sessionId: payload.sessionId, err: message });
      this.deps.client.emitSocket(SocketEvents.BRIDGE_ERROR, {
        code: "PRINT_FAILED",
        sessionId: payload.sessionId,
        message,
      });
    }
  }

  cameraInstance(): CameraDevice {
    return this.camera;
  }

  printerInstance(): PrinterDevice {
    return this.printer;
  }

  async rebuildDevices(config: BridgeConfig): Promise<void> {
    this.deps.config = config;
    await this.camera.cleanup().catch(() => undefined);
    this.camera = createCamera(config.cameraMode, {
      deviceName: config.cameraDeviceName,
      digiCamControlPath: config.digiCamControlPath,
      digiCamSessionFolder: config.digiCamSessionFolder,
      ffmpegPath: config.ffmpegPath,
    });
    this.printer = createPrinter(config.printerMode, {
      printerName: config.printerName,
    });
    await this.init();
  }
}
