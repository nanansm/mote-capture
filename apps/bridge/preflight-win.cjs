#!/usr/bin/env node
/* eslint-disable no-console */
// Pre-flight check for the Windows installer build (`pnpm package:win`).
// Fails early with an actionable message if the bundled digiCamControl
// installer is missing, instead of a cryptic electron-builder error halfway
// through the build. See installer-deps/README.md.
const fs = require("node:fs");
const path = require("node:path");

const DEP = path.join(__dirname, "installer-deps", "digiCamControl-setup.exe");

if (!fs.existsSync(DEP)) {
  console.error(
    [
      "",
      "✗ Build dibatalkan: digiCamControl installer tidak ditemukan.",
      "",
      "  Dibutuhkan : " + DEP,
      "",
      "  Cara:",
      "    1. Download dari https://digicamcontrol.com/download",
      "    2. Rename jadi exactly: digiCamControl-setup.exe",
      "    3. Taruh di apps/bridge/installer-deps/",
      "    4. Ulangi: pnpm --filter bridge package:win",
      "",
      "  (Detail: apps/bridge/installer-deps/README.md)",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

const sizeMB = (fs.statSync(DEP).size / (1024 * 1024)).toFixed(1);
console.log(`✓ digiCamControl-setup.exe ditemukan (${sizeMB} MB). Lanjut build…`);
