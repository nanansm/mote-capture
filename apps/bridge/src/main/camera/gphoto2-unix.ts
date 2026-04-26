// Linux/macOS Canon DSLR capture via gphoto2 CLI.
// Install: brew install gphoto2  (mac)
//          sudo apt install gphoto2  (debian/ubuntu)
import { spawn } from "node:child_process";
import fs from "node:fs";
import type { CameraDevice, CameraOptions, CaptureResult } from "./index";
import type { CameraMode, DeviceTestResult } from "../../shared/types";
import { tempFile, ensureDirs } from "../paths";
import { logger } from "../logger";

function exec(
  cmd: string,
  args: string[],
  timeoutMs = 30_000,
): Promise<{ code: number; stdout: string; stderr: string }> {
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

export class GPhoto2Camera implements CameraDevice {
  readonly mode: CameraMode = "gphoto2";

  constructor(_opts: CameraOptions) {
    // no-op
  }

  async init(): Promise<void> {
    ensureDirs();
    const r = await exec("gphoto2", ["--version"], 5000).catch(() => null);
    if (!r || r.code !== 0) {
      throw new Error("gphoto2 tidak ditemukan. Install: brew install gphoto2 (Mac) atau apt install gphoto2 (Linux).");
    }
    logger.info("camera_gphoto2_init");
  }

  async capture(): Promise<CaptureResult> {
    const out = tempFile("gphoto", "jpg");
    const result = await exec("gphoto2", ["--capture-image-and-download", "--filename", out, "--force-overwrite"], 30_000);
    if (result.code !== 0) {
      throw new Error(`gphoto2 gagal: ${result.stderr || result.stdout}`);
    }
    if (!fs.existsSync(out)) {
      throw new Error("gphoto2 tidak menulis file.");
    }
    return { filePath: out, mimeType: "image/jpeg" };
  }

  async testConnection(): Promise<DeviceTestResult> {
    try {
      await this.init();
      const r = await exec("gphoto2", ["--auto-detect"], 5000);
      const lines = r.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
      // First two lines are header + separator
      const cam = lines[2] ?? "";
      if (!cam) {
        return { ok: false, error: "Tidak ada kamera USB terdeteksi." };
      }
      return { ok: true, deviceName: cam };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async cleanup(): Promise<void> {
    // none
  }
}
