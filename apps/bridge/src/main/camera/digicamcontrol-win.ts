// Windows Canon DSLR capture via digiCamControl.
// Requires digiCamControl installed and `CameraControlCmd.exe` on disk.
// Default: C:\Program Files (x86)\digiCamControl\CameraControlCmd.exe
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
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
    const proc = spawn(cmd, args, { windowsHide: true });
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

const DEFAULT_PATH = "C:\\Program Files (x86)\\digiCamControl\\CameraControlCmd.exe";

export class DigiCamControlCamera implements CameraDevice {
  readonly mode: CameraMode = "digicamcontrol";
  private binPath: string;

  constructor(opts: CameraOptions) {
    this.binPath = opts.digiCamControlPath || DEFAULT_PATH;
  }

  async init(): Promise<void> {
    ensureDirs();
    if (process.platform !== "win32") {
      throw new Error("Mode 'digicamcontrol' hanya tersedia di Windows.");
    }
    if (!fs.existsSync(this.binPath)) {
      throw new Error(
        `digiCamControl tidak ditemukan di:\n  ${this.binPath}\n\nInstall dari https://digicamcontrol.com lalu set path-nya di Setup.`,
      );
    }
    logger.info("camera_digicam_init", { binPath: this.binPath });
  }

  async capture(): Promise<CaptureResult> {
    if (process.platform !== "win32") {
      throw new Error("digicamcontrol hanya jalan di Windows.");
    }
    const out = tempFile("canon", "jpg");
    const result = await exec(
      this.binPath,
      ["/filename", out, "/capture"],
      30_000,
    );
    if (result.code !== 0) {
      throw new Error(`digiCamControl gagal: ${result.stderr || result.stdout}`);
    }
    if (!fs.existsSync(out)) {
      throw new Error("digiCamControl tidak menulis file. Periksa kamera & shutter.");
    }
    logger.info("camera_capture_ok", {
      path: out,
      bytes: fs.statSync(out).size,
    });
    return { filePath: out, mimeType: "image/jpeg" };
  }

  async testConnection(): Promise<DeviceTestResult> {
    try {
      await this.init();
      // /list returns connected camera names, one per line.
      const result = await exec(this.binPath, ["/list", "cameras"], 8_000);
      const firstLine = result.stdout
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)[0];
      if (!firstLine) {
        return {
          ok: false,
          error:
            "Tidak ada kamera Canon terdeteksi. Pastikan kamera ON, mode M/Tv/Av, dan terhubung USB.",
        };
      }
      return { ok: true, deviceName: firstLine };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async cleanup(): Promise<void> {
    // No persistent process — CameraControlCmd is one-shot per spawn.
  }
}

// Suppress unused import warning under non-Windows tsc
void path;
