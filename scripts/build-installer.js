#!/usr/bin/env node
/* eslint-disable no-console */
// Cross-platform helper that compiles the Windows installer with Inno Setup.
//
// Workflow:
//   1. Ensures apps/bridge/assets/icon.png exists (runs generate-icons.cjs if not)
//   2. Regenerates installer-icon.ico + .bmp wizard images
//   3. Locates ISCC.exe (Inno Setup compiler):
//        - Windows : standard install paths or PATH
//        - macOS   : Wine + ISCC.exe inside ~/.wine
//        - Linux   : Wine + ISCC.exe inside ~/.wine
//   4. Invokes ISCC.exe on apps/bridge/installer/MoteCaptureBridge.iss
//
// Usage: pnpm build:installer:windows
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const REPO_ROOT = path.resolve(__dirname, "..");
const INSTALLER_DIR = path.join(REPO_ROOT, "apps", "bridge", "installer");
const ICON_SCRIPT = path.join(REPO_ROOT, "apps", "bridge", "assets", "generate-icons.cjs");
const ICON_PNG = path.join(REPO_ROOT, "apps", "bridge", "assets", "icon.png");
const ASSETS_SCRIPT = path.join(INSTALLER_DIR, "assets", "generate-installer-assets.cjs");
const ISS_FILE = path.join(INSTALLER_DIR, "MoteCaptureBridge.iss");

function run(cmd, args, opts = {}) {
  console.log(`> ${cmd} ${args.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}`);
  const result = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function findIsccWindows() {
  const candidates = [
    "C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe",
    "C:\\Program Files\\Inno Setup 6\\ISCC.exe",
  ];
  for (const c of candidates) if (fs.existsSync(c)) return { iscc: c, useWine: false };
  // Fall back to PATH
  const which = spawnSync(process.platform === "win32" ? "where" : "which", ["ISCC.exe"]);
  if (which.status === 0) {
    return { iscc: which.stdout.toString().split(/\r?\n/)[0].trim(), useWine: false };
  }
  return null;
}

function findIsccUnix() {
  const wine = spawnSync("which", ["wine"]);
  if (wine.status !== 0) return null;
  const home = os.homedir();
  const candidates = [
    path.join(home, ".wine", "drive_c", "Program Files (x86)", "Inno Setup 6", "ISCC.exe"),
    path.join(home, ".wine", "drive_c", "Program Files", "Inno Setup 6", "ISCC.exe"),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return { iscc: c, useWine: true };
  return null;
}

(function main() {
  console.log("=== Mote Capture Bridge — installer build ===");

  if (!fs.existsSync(ICON_PNG)) {
    console.log("Generating bridge icons (icon.png missing)...");
    run("node", [ICON_SCRIPT]);
  }

  console.log("Generating installer wizard assets...");
  run("node", [ASSETS_SCRIPT]);

  let resolved = process.platform === "win32" ? findIsccWindows() : findIsccUnix();

  if (!resolved) {
    console.error("");
    console.error("✗ Inno Setup compiler (ISCC.exe) tidak ditemukan.");
    if (process.platform === "win32") {
      console.error("  Install Inno Setup 6 dari https://jrsoftware.org/isdl.php");
    } else {
      console.error("  Untuk build di macOS/Linux:");
      console.error("    1) brew install --cask wine-stable     (atau apt install wine)");
      console.error("    2) Download innosetup-6.x.x.exe        https://jrsoftware.org/isdl.php");
      console.error("    3) wine ./innosetup-6.x.x.exe");
      console.error("");
      console.error("  Alternatif: build di mesin Windows pakai apps/bridge/installer/build-installer.bat");
    }
    process.exit(1);
  }

  console.log(`Using ISCC: ${resolved.iscc}` + (resolved.useWine ? " (via wine)" : ""));
  const args = resolved.useWine ? [resolved.iscc, ISS_FILE] : [ISS_FILE];
  const cmd = resolved.useWine ? "wine" : resolved.iscc;
  run(cmd, args, { cwd: INSTALLER_DIR });

  const outFile = path.join(INSTALLER_DIR, "output", "MoteCaptureBridge-Setup-0.1.0.exe");
  if (fs.existsSync(outFile)) {
    const sizeMB = (fs.statSync(outFile).size / (1024 * 1024)).toFixed(2);
    console.log("");
    console.log(`✓ Installer berhasil di-build: ${outFile} (${sizeMB} MB)`);
  } else {
    console.warn("WARN: ISCC selesai tapi output file tidak ditemukan: " + outFile);
  }
})();
