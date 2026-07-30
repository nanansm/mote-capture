// Rewrites the kiosk Edge shortcuts (Desktop + Startup) that the NSIS
// installer creates, so they point at the booth's actual kiosk screen.
//
// Why this exists: at install time the booth's ID is not known yet, so
// installer.nsh can only point the shortcuts at the cloud root, which just
// redirects to /admin -- not the kiosk view. Once the operator saves the
// bridge config (cloudUrl + boothId resolved from the token), we rewrite both
// shortcuts here so nobody has to hand-edit shortcut properties per booth.
import { app, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { logger } from "./logger";

// Must match the literal shortcut name CreateShortcut uses in
// assets/installer.nsh -- otherwise this would create a second, stale
// shortcut instead of updating the one the installer made.
const SHORTCUT_NAME = "Mote Capture Booth.lnk";

// Same two locations installer.nsh probes (via the msedge.exe App Paths
// registry key, falling back to Program Files (x86)), checked in the same
// order here since we don't have registry access without a native module.
const EDGE_CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

function findEdge(): string | null {
  for (const candidate of EDGE_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// Rewrite both kiosk shortcuts to target `${cloudUrl}/kiosk/${boothId}`.
// Best-effort and silent on failure: a broken shortcut write must never take
// down config persistence or crash the app.
export function updateKioskShortcuts(cloudUrl: string, boothId: string): void {
  // The installer + Edge kiosk flow is Windows-only.
  if (process.platform !== "win32") return;
  // Nothing sensible to point at yet -- leave whatever shortcut exists alone.
  if (!cloudUrl || !boothId) return;

  try {
    const edgePath = findEdge();
    if (!edgePath) {
      logger.warn("kiosk_shortcut_edge_not_found", { checked: EDGE_CANDIDATES });
      return;
    }

    const kioskUrl = `${cloudUrl.replace(/\/$/, "")}/kiosk/${boothId}`;
    // Identical flags to installer.nsh so behavior doesn't drift between the
    // shortcut the installer creates and the one the bridge rewrites.
    const args = `--kiosk ${kioskUrl} --edge-kiosk-type=fullscreen`;

    const shortcutPaths = [
      path.join(app.getPath("desktop"), SHORTCUT_NAME),
      path.join(
        app.getPath("appData"),
        "Microsoft",
        "Windows",
        "Start Menu",
        "Programs",
        "Startup",
        SHORTCUT_NAME,
      ),
    ];

    for (const shortcutPath of shortcutPaths) {
      const options = {
        target: edgePath,
        args,
        description: "Mote Capture Booth kiosk",
      };
      // "update" is the normal path (the installer already created the
      // shortcut); fall back to "create" in case the operator deleted it.
      let ok = shell.writeShortcutLink(shortcutPath, "update", options);
      if (!ok) {
        ok = shell.writeShortcutLink(shortcutPath, "create", options);
      }
      if (ok) {
        logger.info("kiosk_shortcut_updated", { shortcutPath, kioskUrl });
      } else {
        logger.warn("kiosk_shortcut_write_failed", { shortcutPath });
      }
    }
  } catch (err) {
    logger.warn("kiosk_shortcut_update_error", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
