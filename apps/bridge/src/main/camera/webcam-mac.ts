// macOS webcam capture via the `imagesnap` CLI.
// Install: brew install imagesnap
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { CameraDevice, CameraOptions, CaptureResult } from "./index";
import type { DeviceTestResult, CameraMode } from "../../shared/types";
import { tempFile, ensureDirs } from "../paths";
import { logger } from "../logger";

const IMAGESNAP_CANDIDATES = [
  "/opt/homebrew/bin/imagesnap", // Apple Silicon brew
  "/usr/local/bin/imagesnap", // Intel brew
  "imagesnap", // anything on PATH
];

function which(cmd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn("which", [cmd]);
    let out = "";
    proc.stdout.on("data", (b) => (out += b.toString()));
    proc.on("close", (code) => resolve(code === 0 ? out.trim() : null));
    proc.on("error", () => resolve(null));
  });
}

async function findImagesnap(): Promise<string | null> {
  for (const c of IMAGESNAP_CANDIDATES) {
    if (path.isAbsolute(c) && fs.existsSync(c)) return c;
    if (!path.isAbsolute(c)) {
      const found = await which(c);
      if (found) return found;
    }
  }
  return null;
}

function exec(cmd: string, args: string[], timeoutMs = 15000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`Timeout after ${timeoutMs}ms: ${cmd}`));
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

export class WebcamMacCamera implements CameraDevice {
  readonly mode: CameraMode = "webcam-mac";
  private binPath: string | null = null;
  private deviceName: string;

  constructor(opts: CameraOptions) {
    this.deviceName = opts.deviceName ?? "";
  }

  async init(): Promise<void> {
    ensureDirs();
    this.binPath = await findImagesnap();
    if (!this.binPath) {
      throw new Error(
        "imagesnap tidak ditemukan. Install dengan:\n    brew install imagesnap",
      );
    }
    logger.info("camera_webcam_init", { binPath: this.binPath });
  }

  async capture(): Promise<CaptureResult> {
    if (!this.binPath) await this.init();
    const out = tempFile("capture", "jpg");
    const args = ["-q", "-w", "0.5"];
    if (this.deviceName) args.push("-d", this.deviceName);
    args.push(out);
    const result = await exec(this.binPath!, args, 20_000);
    if (result.code !== 0) {
      throw new Error(`imagesnap gagal: ${result.stderr || result.stdout}`);
    }
    if (!fs.existsSync(out)) {
      throw new Error("imagesnap tidak menulis file (mungkin permission kamera).");
    }
    const stat = fs.statSync(out);
    logger.info("camera_capture_ok", { path: out, bytes: stat.size });
    return { filePath: out, mimeType: "image/jpeg" };
  }

  async testConnection(): Promise<DeviceTestResult> {
    try {
      await this.init();
      const result = await exec(this.binPath!, ["-l"], 5000);
      if (result.code !== 0) {
        return { ok: false, error: result.stderr || "Tidak ada kamera terdeteksi" };
      }
      const firstLine = result.stdout
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("Video Devices:"))[0];
      const detected = firstLine ?? "FaceTime HD Camera";
      // Capture a single frame as preview proof
      const cap = await this.capture();
      const dataUrl = `data:${cap.mimeType};base64,${fs.readFileSync(cap.filePath).toString("base64")}`;
      return { ok: true, deviceName: this.deviceName || detected, previewDataUrl: dataUrl };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async cleanup(): Promise<void> {
    // imagesnap is a one-shot CLI — nothing to clean up.
  }
}
