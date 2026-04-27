// Windows Canon DSLR capture via digiCamControl's REMOTE webserver CLI.
//
// IMPORTANT: We use CameraControlRemoteCmd.exe (not CameraControlCmd.exe).
// CameraControlCmd hangs indefinitely when invoked alongside an active GUI
// session, which is the configuration we need (the GUI must be open so the
// camera stays connected). RemoteCmd talks to the GUI's localhost webserver
// and returns immediately.
//
// Pre-flight requirements on the booth machine:
//   1) digiCamControl GUI is running with the camera connected.
//   2) GUI Settings -> Webserver is enabled (default port 5513).
//   3) A capture session is open (default: Session1).
//
// Capture flow per shot:
//   a) Snapshot existing JPGs in the session folder.
//   b) Fire `CameraControlRemoteCmd.exe /c capture` (returns instantly).
//   c) Poll the session folder for the new JPG (up to ~10s).
//   d) Copy that JPG to the bridge's tempFile() path that the rest of
//      the pipeline already expects.
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CameraDevice, CameraOptions, CaptureResult } from "./index";
import type { CameraMode, DeviceTestResult } from "../../shared/types";
import { tempFile, ensureDirs } from "../paths";
import { logger } from "../logger";

function exec(
  cmd: string,
  args: string[],
  timeoutMs = 15_000,
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

const DEFAULT_BIN =
  "C:\\Program Files (x86)\\digiCamControl\\CameraControlRemoteCmd.exe";

function defaultSessionFolder(): string {
  return path.join(os.homedir(), "Pictures", "digiCamControl", "Session1");
}

async function listJpgs(dir: string): Promise<string[]> {
  try {
    const entries = await fsp.readdir(dir);
    return entries.filter((f) => /\.jpe?g$/i.test(f));
  } catch {
    return [];
  }
}

export class DigiCamControlCamera implements CameraDevice {
  readonly mode: CameraMode = "digicamcontrol";
  private binPath: string;
  private sessionFolder: string;

  constructor(opts: CameraOptions) {
    this.binPath = opts.digiCamControlPath || DEFAULT_BIN;
    this.sessionFolder = opts.digiCamSessionFolder || defaultSessionFolder();
  }

  async init(): Promise<void> {
    ensureDirs();
    if (process.platform !== "win32") {
      throw new Error("Mode 'digicamcontrol' hanya tersedia di Windows.");
    }
    if (!fs.existsSync(this.binPath)) {
      throw new Error(
        `digiCamControl tidak ditemukan di:\n  ${this.binPath}\n\n` +
          "Install dari https://digicamcontrol.com lalu set path-nya di tab Camera. " +
          "Pastikan path mengarah ke CameraControlRemoteCmd.exe (bukan CameraControlCmd.exe).",
      );
    }
    // Make sure the session folder exists - GUI normally creates it on first
    // capture, but a missing folder upfront just means the first poll will
    // fail with a clearer "no new file" error.
    if (!fs.existsSync(this.sessionFolder)) {
      logger.warn("camera_digicam_session_missing", { sessionFolder: this.sessionFolder });
    }
    logger.info("camera_digicam_init", {
      binPath: this.binPath,
      sessionFolder: this.sessionFolder,
    });
  }

  async capture(): Promise<CaptureResult> {
    if (process.platform !== "win32") {
      throw new Error("digicamcontrol hanya jalan di Windows.");
    }
    if (!fs.existsSync(this.binPath)) {
      throw new Error(`digiCamControl tidak ditemukan: ${this.binPath}`);
    }

    // 1. Snapshot existing JPGs so we can spot the new one.
    const before = new Set(await listJpgs(this.sessionFolder));
    const startedAt = Date.now();

    // 2. Fire the capture via the webserver CLI. This returns almost instantly
    //    once the GUI accepts the command - the actual shutter happens async.
    const result = await exec(this.binPath, ["/c", "capture"], 15_000);
    if (result.code !== 0) {
      logger.warn("camera_digicam_capture_failed", {
        code: result.code,
        stdout: result.stdout,
        stderr: result.stderr,
      });
      throw new Error(
        `digiCamControl capture gagal (exit ${result.code}): ${result.stderr || result.stdout || "no output"}`,
      );
    }
    const combined = (result.stdout + " " + result.stderr).toLowerCase();
    if (combined.includes("error")) {
      throw new Error(`digiCamControl error: ${result.stdout || result.stderr}`);
    }

    // 3. Poll the session folder for the new JPG. Most DSLRs finish writing
    //    to disk within 1-3s; we give it up to ~10s.
    const POLL_INTERVAL_MS = 500;
    const MAX_POLLS = 24; // 24 * 500ms = 12s
    let newFile: string | null = null;
    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const after = await listJpgs(this.sessionFolder);
      const diff = after.filter((f) => !before.has(f));
      if (diff.length > 0) {
        // Multiple new files (rapid burst): pick the most recent by mtime.
        const stats = await Promise.all(
          diff.map(async (f) => {
            const full = path.join(this.sessionFolder, f);
            try {
              const st = await fsp.stat(full);
              return { name: f, mtime: st.mtimeMs };
            } catch {
              return { name: f, mtime: 0 };
            }
          }),
        );
        stats.sort((a, b) => b.mtime - a.mtime);
        newFile = stats[0]?.name ?? null;
        if (newFile) break;
      }
    }

    if (!newFile) {
      throw new Error(
        `Capture timeout: tidak ada file JPG baru muncul di ${this.sessionFolder} dalam ${MAX_POLLS * POLL_INTERVAL_MS / 1000}s. ` +
          "Pastikan kamera ON, mode M/Tv/Av, dan digiCamControl GUI aktif dengan session terbuka.",
      );
    }

    // 4. Copy the captured JPG to the bridge's expected temp path so the rest
    //    of the pipeline (composer, uploader) doesn't have to know about
    //    digiCamControl's session folder.
    const sessionPath = path.join(this.sessionFolder, newFile);
    const out = tempFile("canon", "jpg");
    await fsp.copyFile(sessionPath, out);
    const stat = await fsp.stat(out);
    logger.info("camera_capture_ok", {
      path: out,
      bytes: stat.size,
      sessionFile: newFile,
      elapsedMs: Date.now() - startedAt,
    });
    return { filePath: out, mimeType: "image/jpeg" };
  }

  async testConnection(): Promise<DeviceTestResult> {
    if (process.platform !== "win32") {
      return { ok: false, error: "Mode 'digicamcontrol' hanya tersedia di Windows." };
    }
    if (!fs.existsSync(this.binPath)) {
      return {
        ok: false,
        error:
          `digiCamControl tidak ditemukan di:\n  ${this.binPath}\n\n` +
          "Install dari https://digicamcontrol.com dan pastikan path mengarah ke CameraControlRemoteCmd.exe.",
      };
    }
    try {
      // Ping the GUI webserver via the remote CLI. `list cameras` returns the
      // currently connected camera names; if the GUI isn't running or its
      // webserver is disabled, this either errors out or hangs (we cap at 5s).
      const r = await exec(this.binPath, ["/c", "list", "cameras"], 5_000);
      const text = (r.stdout + "\n" + r.stderr).trim();
      if (r.code !== 0 || /error/i.test(text)) {
        return {
          ok: false,
          error:
            "digiCamControl webserver tidak respond dengan benar.\n\n" +
            "Pastikan: 1) digiCamControl GUI sudah jalan, 2) Webserver enabled di Settings, " +
            "3) Camera session aktif (Session1).\n\nOutput:\n" +
            text.slice(0, 500),
        };
      }
      // First non-blank line is the connected camera name.
      const first = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)[0];
      if (!first) {
        return {
          ok: false,
          error:
            "Tidak ada kamera Canon terdeteksi via digiCamControl. " +
            "Pastikan kamera ON, mode M/Tv/Av, terhubung USB, dan GUI sudah connect.",
        };
      }
      return { ok: true, deviceName: first };
    } catch (err) {
      return {
        ok: false,
        error:
          "digiCamControl webserver tidak respond. Pastikan GUI dibuka dan webserver enabled.\n" +
          (err instanceof Error ? err.message : String(err)),
      };
    }
  }

  async cleanup(): Promise<void> {
    // Nothing to clean up - RemoteCmd is one-shot per spawn.
  }
}
