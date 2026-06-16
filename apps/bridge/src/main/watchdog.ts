// Crash watchdog + login-item management.
//
// The bridge is a tray GUI app (it needs digiCamControl's GUI running in the
// user session), so it cannot run as a session-0 Windows Service. Instead we
// get the same practical guarantees a service would give:
//   - auto-start  -> app.setLoginItemSettings (HKCU Run on Windows)
//   - auto-restart -> relaunch the app when the main process throws, and
//                     recreate the config window when its renderer dies.
//
// A relaunch throttle (persisted to disk so it survives the relaunch) prevents
// a boot-loop: if the app crash-relaunches too many times in a short window we
// stop and surface the error instead of spinning forever.
import { app, dialog } from "electron";
import fs from "node:fs";
import path from "node:path";
import { APP_DATA_DIR } from "./paths";
import { logger } from "./logger";
import { isAppQuitting } from "./window";

const RELAUNCH_LOG = path.join(APP_DATA_DIR, "crash-relaunch.json");
const RELAUNCH_WINDOW_MS = 60_000; // look back 60s
const RELAUNCH_MAX = 3; // >=3 crashes in the window -> stop relaunching

// Apply the OS "launch at login" setting. Best-effort: failures are logged but
// never throw, because a missing login item must not break bridge startup.
export function applyLoginItem(autoStart: boolean): void {
  try {
    // Linux has no Electron-managed login item; this is a no-op there. The
    // booth target is Windows, where this writes the HKCU Run entry.
    if (process.platform === "linux") return;
    app.setLoginItemSettings({ openAtLogin: autoStart });
    logger.info("login_item_applied", { openAtLogin: autoStart });
  } catch (err) {
    logger.warn("login_item_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

// Read the recent relaunch timestamps, dropping any outside the look-back window.
function readRecentRelaunches(now: number): number[] {
  try {
    if (!fs.existsSync(RELAUNCH_LOG)) return [];
    const raw = JSON.parse(fs.readFileSync(RELAUNCH_LOG, "utf8"));
    if (!Array.isArray(raw)) return [];
    return raw.filter((t) => typeof t === "number" && now - t < RELAUNCH_WINDOW_MS);
  } catch {
    return [];
  }
}

function recordRelaunch(times: number[]): void {
  try {
    fs.mkdirSync(APP_DATA_DIR, { recursive: true });
    fs.writeFileSync(RELAUNCH_LOG, JSON.stringify(times), "utf8");
  } catch (err) {
    logger.warn("relaunch_log_write_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

// Relaunch the whole app after a fatal main-process error, unless we've already
// crash-looped too many times recently. Returns false if relaunch was skipped.
function relaunchOrGiveUp(reason: string): boolean {
  if (isAppQuitting()) return false; // intentional shutdown, never relaunch

  const now = Date.now();
  const recent = readRecentRelaunches(now);
  if (recent.length >= RELAUNCH_MAX) {
    logger.error("crash_relaunch_loop_detected", { reason, recentCount: recent.length });
    try {
      dialog.showErrorBox(
        "Mote Capture Bridge",
        `Bridge crashed berulang kali (${recent.length}x dalam 60 detik) dan berhenti auto-restart untuk mencegah loop.\n\nPenyebab terakhir:\n${reason}\n\nCek log, lalu jalankan ulang manual.`,
      );
    } catch {
      /* dialog may be unavailable mid-crash; ignore */
    }
    return false;
  }

  recent.push(now);
  recordRelaunch(recent);
  logger.warn("crash_relaunch", { reason, attempt: recent.length });
  app.relaunch();
  app.exit(1);
  return true;
}

// Install process- and app-level crash handlers. Call once after app.whenReady.
export function installCrashWatchdog(): void {
  // Renderer (config UI) died. The bridge core lives in the main process, so a
  // dead renderer is non-fatal — log only. We deliberately do NOT auto-recreate
  // the window: if the renderer crashes on load it would spin in a loop with no
  // throttle. The window is optional UI; the user reopens it via the tray menu
  // (onShowConfig -> getOrCreateConfigWindow), which recreates it on demand.
  app.on("render-process-gone", (_event, _webContents, details) => {
    logger.error("render_process_gone", { reason: details.reason, exitCode: details.exitCode });
  });

  app.on("child-process-gone", (_event, details) => {
    // GPU/utility process death — log only, Electron recovers these itself.
    logger.warn("child_process_gone", { type: details.type, reason: details.reason });
  });

  // Fatal main-process error: log, then relaunch a fresh instance (throttled).
  process.on("uncaughtException", (err) => {
    logger.error("uncaught_exception", { err: err?.message ?? String(err), stack: err?.stack });
    relaunchOrGiveUp(err?.message ?? "uncaughtException");
  });

  // Rejections are logged but not fatal — relaunching on every stray rejection
  // would be too aggressive and risks masking recoverable transient failures.
  process.on("unhandledRejection", (reason) => {
    logger.error("unhandled_rejection", {
      reason: reason instanceof Error ? reason.message : String(reason),
    });
  });

  logger.info("crash_watchdog_installed");
}
