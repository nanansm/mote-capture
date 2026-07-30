// Windows UVC webcam capture via a persistent ffmpeg dshow process.
//
// Why this driver exists: the booth's Sony ZV-E10 (gen-1) cannot be tethered
// over USB. Sony's own Camera Remote SDK covers the ZV-E1 and ZV-E10 II but
// not the gen-1 body, digiCamControl only speaks to Sony over WiFi, and the
// camera's menu has no PC Remote option at all (only Auto / Mass Storage /
// MTP). What it does expose is a clean 720p UVC stream in USB Streaming mode,
// which enumerates as a standard dshow video device. 720p is not a compromise
// here: each photo slot on the print is 790x320 px (see image/composer.ts
// DEFAULT_LAYOUT_B), so a 1280x720 source is already oversampled.
//
// Why the ffmpeg process is long-lived instead of one spawn per frame: the
// kiosk polls /live-preview roughly every 150 ms. A fresh `ffmpeg -frames:v 1`
// per poll would re-negotiate the dshow graph every time (~1-2 s each) and,
// worse, dshow hands out an exclusive handle on the device — the preview spawn
// and the capture spawn would lock each other out. So one process holds the
// device, streams MJPEG to stdout, and we keep only the newest complete frame
// in memory. Preview and capture both read that frame, so they can never
// contend. This is the part that makes it NOT a straight port of webcam-mac,
// where `imagesnap` is a one-shot CLI with no device to hold.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { CameraDevice, CameraOptions, CaptureResult } from "./index";
import type { DeviceTestResult, CameraMode } from "../../shared/types";
import { tempFile, ensureDirs } from "../paths";
import { logger } from "../logger";

// JPEG frame markers. Every MJPEG frame ffmpeg writes starts with SOI (FFD8)
// and ends with EOI (FFD9); we only ever publish frames where both were seen,
// so a half-written frame can never reach the kiosk or the print composite.
const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);

// If the accumulator grows past this without yielding a frame, the stream is
// not MJPEG (or ffmpeg is emitting diagnostics on stdout) — reset rather than
// grow unbounded and eat the booth PC's RAM.
const MAX_BUFFER_BYTES = 16 * 1024 * 1024;

// How long capture() waits for the first frame after the stream starts. dshow
// negotiation on a cold device is ~1-2 s; 10 s covers a camera that was just
// plugged in without stalling a paying customer for the full session timeout.
const FIRST_FRAME_TIMEOUT_MS = 10_000;
const FRAME_POLL_INTERVAL_MS = 100;

// Restart throttle, mirroring the app-level watchdog: recover from a camera
// that was unplugged and replugged, but never spin in a tight respawn loop.
const RESTART_DELAY_MS = 1_500;
const MAX_RESTARTS_PER_WINDOW = 5;
const RESTART_WINDOW_MS = 60_000;

function ffmpegCandidates(explicitPath?: string): string[] {
  const list: string[] = [];
  if (explicitPath && explicitPath.trim().length > 0) list.push(explicitPath.trim());
  // Bundled next to the packaged app (electron-builder win.extraResources).
  if (process.resourcesPath) list.push(path.join(process.resourcesPath, "ffmpeg.exe"));
  // Repo-local copy so `pnpm dev` works on a build machine before packaging.
  list.push(path.join(process.cwd(), "installer-deps", "ffmpeg.exe"));
  // Anything on PATH last — a manually installed ffmpeg is a valid fallback.
  list.push("ffmpeg");
  return list;
}

function resolveFfmpeg(explicitPath?: string): string | null {
  for (const candidate of ffmpegCandidates(explicitPath)) {
    if (candidate === "ffmpeg") return candidate; // resolved by the OS on spawn
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// `ffmpeg -list_devices true -f dshow -i dummy` prints the device table on
// stderr and always exits non-zero — that exit code is not an error here.
function runFfmpeg(
  bin: string,
  args: string[],
  timeoutMs = 15_000,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`Timeout after ${timeoutMs}ms: ${bin} ${args.join(" ")}`));
    }, timeoutMs);
    proc.stdout.on("data", (b) => (stdout += b.toString()));
    proc.stderr.on("data", (b) => (stderr += b.toString()));
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// Parses the dshow device table. Video device lines look like:
//   [dshow @ 0000...] "ZV-E10" (video)
//   [dshow @ 0000...]   Alternative name "@device_pnp_\\?\usb#vid_054c..."
// The friendly name is what `-i video=<name>` expects; the alternative name is
// kept because two identical cameras would otherwise be indistinguishable.
export function parseDshowVideoDevices(stderr: string): { name: string; alternative?: string }[] {
  const devices: { name: string; alternative?: string }[] = [];
  const lines = stderr.split(/\r?\n/);
  for (const line of lines) {
    const videoMatch = line.match(/"([^"]+)"\s+\(video\)/);
    if (videoMatch?.[1]) {
      devices.push({ name: videoMatch[1] });
      continue;
    }
    const altMatch = line.match(/Alternative name\s+"([^"]+)"/);
    const last = devices[devices.length - 1];
    if (altMatch?.[1] && last && !last.alternative) {
      last.alternative = altMatch[1];
    }
  }
  return devices;
}

export class WebcamWinCamera implements CameraDevice {
  readonly mode: CameraMode = "webcam-win";
  private binPath: string | null = null;
  private deviceName: string;
  private explicitFfmpegPath?: string;
  private proc: ChildProcessWithoutNullStreams | null = null;
  private acc: Buffer = Buffer.alloc(0);
  private latestFrame: Buffer | null = null;
  private latestFrameAt = 0;
  private stopping = false;
  private restartTimer: NodeJS.Timeout | null = null;
  private restartTimestamps: number[] = [];
  private lastStderr = "";

  constructor(opts: CameraOptions) {
    this.deviceName = opts.deviceName?.trim() ?? "";
    this.explicitFfmpegPath = opts.ffmpegPath;
  }

  async init(): Promise<void> {
    if (process.platform !== "win32") {
      throw new Error("Mode 'webcam-win' hanya tersedia di Windows.");
    }
    ensureDirs();
    this.binPath = resolveFfmpeg(this.explicitFfmpegPath);
    if (!this.binPath) {
      throw new Error(
        "ffmpeg.exe tidak ditemukan. Installer seharusnya membundelnya; " +
          "kalau ini build dev, taruh ffmpeg.exe di apps/bridge/installer-deps/ " +
          "atau pasang ffmpeg di PATH.",
      );
    }
    if (!this.deviceName) {
      const devices = await this.listDevices();
      const first = devices[0];
      if (!first) {
        throw new Error(
          "Tidak ada kamera UVC terdeteksi. Untuk Sony ZV-E10: MENU → Setup → " +
            "USB Streaming = On (bukan MTP / Mass Storage), lalu colok ulang kabel USB.",
        );
      }
      this.deviceName = first.name;
      logger.info("camera_webcam_win_device_autopicked", {
        device: this.deviceName,
        available: devices.map((d) => d.name),
      });
    }
    this.startStream();
    logger.info("camera_webcam_win_init", { binPath: this.binPath, device: this.deviceName });
  }

  async listDevices(): Promise<{ name: string; alternative?: string }[]> {
    const bin = this.binPath ?? resolveFfmpeg(this.explicitFfmpegPath);
    if (!bin) return [];
    const res = await runFfmpeg(bin, [
      "-hide_banner",
      "-list_devices",
      "true",
      "-f",
      "dshow",
      "-i",
      "dummy",
    ]).catch(() => null);
    if (!res) return [];
    return parseDshowVideoDevices(res.stderr);
  }

  // Boots the long-lived MJPEG stream. Safe to call repeatedly — a live
  // process short-circuits, so both init() and startLiveView() can call it.
  private startStream(): void {
    if (this.proc || this.stopping) return;
    if (!this.binPath) return;

    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      // dshow drops frames when the consumer lags; a real-time buffer avoids
      // the "real-time buffer too full" spam on a 720p30 source.
      "-rtbufsize",
      "64M",
      "-f",
      "dshow",
      "-i",
      `video=${this.deviceName}`,
      // The Sony also exposes an audio device; the booth never records sound.
      "-an",
      "-f",
      "mjpeg",
      "-q:v",
      "3",
      "pipe:1",
    ];

    logger.info("camera_webcam_win_stream_start", { device: this.deviceName });
    const proc = spawn(this.binPath, args, { windowsHide: true });
    this.proc = proc;
    this.acc = Buffer.alloc(0);

    proc.stdout.on("data", (chunk: Buffer) => this.onStdout(chunk));
    proc.stderr.on("data", (chunk: Buffer) => {
      // Keep only the tail: enough to explain a failure without unbounded growth.
      this.lastStderr = (this.lastStderr + chunk.toString()).slice(-2000);
    });
    proc.on("error", (err) => {
      logger.warn("camera_webcam_win_stream_error", { err: err.message });
    });
    proc.on("close", (code) => {
      const wasCurrent = this.proc === proc;
      if (wasCurrent) this.proc = null;
      if (this.stopping) return;
      logger.warn("camera_webcam_win_stream_closed", {
        code,
        stderr: this.lastStderr.trim() || undefined,
      });
      if (wasCurrent) this.scheduleRestart();
    });
  }

  // Replug recovery. Bounded to MAX_RESTARTS_PER_WINDOW so a permanently
  // missing device surfaces as a clear capture error instead of a respawn loop
  // that pegs the booth PC.
  private scheduleRestart(): void {
    if (this.restartTimer || this.stopping) return;
    const now = Date.now();
    this.restartTimestamps = this.restartTimestamps.filter((t) => now - t < RESTART_WINDOW_MS);
    if (this.restartTimestamps.length >= MAX_RESTARTS_PER_WINDOW) {
      logger.warn("camera_webcam_win_restart_throttled", {
        restarts: this.restartTimestamps.length,
        windowMs: RESTART_WINDOW_MS,
      });
      return;
    }
    this.restartTimestamps.push(now);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.startStream();
    }, RESTART_DELAY_MS);
  }

  // Slices complete JPEG frames out of the MJPEG byte stream. Only whole
  // frames (SOI..EOI) are published, so a torn frame never escapes.
  private onStdout(chunk: Buffer): void {
    this.acc = this.acc.length === 0 ? chunk : Buffer.concat([this.acc, chunk]);

    for (;;) {
      const start = this.acc.indexOf(SOI);
      if (start < 0) {
        // No frame start in flight — keep at most one marker's worth of tail.
        if (this.acc.length > 1) this.acc = this.acc.subarray(this.acc.length - 1);
        break;
      }
      const end = this.acc.indexOf(EOI, start + SOI.length);
      if (end < 0) {
        if (start > 0) this.acc = this.acc.subarray(start);
        break;
      }
      const frameEnd = end + EOI.length;
      this.latestFrame = Buffer.from(this.acc.subarray(start, frameEnd));
      this.latestFrameAt = Date.now();
      this.acc = this.acc.subarray(frameEnd);
    }

    if (this.acc.length > MAX_BUFFER_BYTES) {
      logger.warn("camera_webcam_win_buffer_reset", { bytes: this.acc.length });
      this.acc = Buffer.alloc(0);
    }
  }

  // Consumed by local-server.ts to answer /live-preview without touching the
  // device again. Returns null until the first whole frame has arrived.
  getPreviewFrame(): Buffer | null {
    return this.latestFrame;
  }

  private async waitForFrame(timeoutMs: number): Promise<Buffer> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (this.latestFrame) return this.latestFrame;
      if (Date.now() >= deadline) break;
      if (!this.proc && !this.restartTimer && !this.stopping) this.startStream();
      await new Promise((r) => setTimeout(r, FRAME_POLL_INTERVAL_MS));
    }
    throw new Error(
      `Tidak ada frame dari kamera "${this.deviceName}" dalam ${Math.round(timeoutMs / 1000)}s. ` +
        `Cek: kamera menyala, USB Streaming = On, kabel tidak lepas.` +
        (this.lastStderr.trim() ? `\n\nffmpeg: ${this.lastStderr.trim()}` : ""),
    );
  }

  async capture(): Promise<CaptureResult> {
    if (!this.binPath) await this.init();
    this.startStream();
    const frame = await this.waitForFrame(FIRST_FRAME_TIMEOUT_MS);
    const out = tempFile("capture", "jpg");
    fs.writeFileSync(out, frame);
    logger.info("camera_capture_ok", {
      path: out,
      bytes: frame.length,
      ageMs: Date.now() - this.latestFrameAt,
      device: this.deviceName,
    });
    return { filePath: out, mimeType: "image/jpeg" };
  }

  async testConnection(): Promise<DeviceTestResult> {
    try {
      await this.init();
      const frame = await this.waitForFrame(FIRST_FRAME_TIMEOUT_MS);
      return {
        ok: true,
        deviceName: this.deviceName,
        previewDataUrl: `data:image/jpeg;base64,${frame.toString("base64")}`,
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // The stream is the live view — nothing extra to open. Kept so the kiosk's
  // existing startLiveView/stopLiveView calls also serve as a stream nudge
  // after an unplug.
  async startLiveView(): Promise<void> {
    this.stopping = false;
    this.startStream();
  }

  async stopLiveView(): Promise<void> {
    // Deliberately a no-op: tearing the process down between sessions would
    // pay the dshow negotiation cost again on the next customer.
  }

  async cleanup(): Promise<void> {
    this.stopping = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    const proc = this.proc;
    this.proc = null;
    if (proc) {
      proc.stdout.removeAllListeners();
      proc.stderr.removeAllListeners();
      proc.kill();
    }
    this.acc = Buffer.alloc(0);
    this.latestFrame = null;
  }
}
