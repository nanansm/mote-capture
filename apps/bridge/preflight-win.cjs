#!/usr/bin/env node
/* eslint-disable no-console */
// Pre-flight check for the Windows installer build (`pnpm package:win`).
// Fails early with an actionable message if a bundled binary is missing,
// instead of a cryptic electron-builder error halfway through the build.
// See installer-deps/README.md.
const fs = require("node:fs");
const path = require("node:path");

const DEPS = [
  {
    file: "digiCamControl-setup.exe",
    what: "digiCamControl installer",
    minMB: 50,
    how: [
      "1. Download dari https://digicamcontrol.com/download",
      "2. Rename jadi exactly: digiCamControl-setup.exe",
      "3. Taruh di apps/bridge/installer-deps/",
    ],
  },
  {
    file: "ffmpeg.exe",
    what: "ffmpeg (dipakai cameraMode webcam-win — Sony ZV-E10 via UVC)",
    minMB: 20,
    how: [
      "1. Download build Windows dari https://www.gyan.dev/ffmpeg/builds/",
      "   (ambil ffmpeg-release-essentials.zip)",
      "2. Ekstrak, ambil bin\\ffmpeg.exe saja",
      "3. Taruh di apps/bridge/installer-deps/ffmpeg.exe",
    ],
  },
];

let failed = false;

for (const dep of DEPS) {
  const full = path.join(__dirname, "installer-deps", dep.file);
  if (!fs.existsSync(full)) {
    console.error(
      [
        "",
        `✗ Build dibatalkan: ${dep.what} tidak ditemukan.`,
        "",
        "  Dibutuhkan : " + full,
        "",
        "  Cara:",
        ...dep.how.map((l) => "    " + l),
        "    4. Ulangi: pnpm --filter bridge package:win",
        "",
        "  (Detail: apps/bridge/installer-deps/README.md)",
        "",
      ].join("\n"),
    );
    failed = true;
    continue;
  }

  const sizeMB = fs.statSync(full).size / (1024 * 1024);
  if (sizeMB < dep.minMB) {
    // Guards the SourceForge/CDN failure mode where an HTML interstitial gets
    // saved under the binary's name — the build would then ship a 4 KB "exe".
    console.error(
      [
        "",
        `✗ Build dibatalkan: ${dep.file} cuma ${sizeMB.toFixed(1)} MB ` +
          `(minimal wajar ${dep.minMB} MB).`,
        "  Kemungkinan yang keunduh halaman HTML, bukan binary. Hapus dan unduh ulang.",
        "",
      ].join("\n"),
    );
    failed = true;
    continue;
  }

  console.log(`✓ ${dep.file} ditemukan (${sizeMB.toFixed(1)} MB).`);
}

if (failed) process.exit(1);
console.log("✓ Semua binary bundled siap. Lanjut build…");
