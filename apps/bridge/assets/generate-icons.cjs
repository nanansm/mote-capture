// Regenerates tray + app icons from inline SVG strings using Sharp.
// Run after `pnpm install` (or any time icons need refreshing).
//   node apps/bridge/assets/generate-icons.cjs
const path = require("node:path");
const fs = require("node:fs");

async function main() {
  let sharp;
  try {
    sharp = require("sharp");
  } catch (err) {
    console.error("[icons] sharp not installed yet — run after pnpm install");
    process.exit(0);
  }

  const outDir = __dirname;
  const dotSvg = (color) => Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <circle cx="16" cy="16" r="11" fill="${color}" stroke="#1f2937" stroke-width="1.5"/>
  <circle cx="13" cy="13" r="3" fill="rgba(255,255,255,0.45)"/>
</svg>`);

  const appSvg = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" rx="96" fill="#0f5132"/>
  <rect x="96" y="160" width="320" height="224" rx="20" fill="#fef9c3" stroke="#1f2937" stroke-width="6"/>
  <circle cx="256" cy="280" r="68" fill="#0f5132" stroke="#1f2937" stroke-width="6"/>
  <circle cx="256" cy="280" r="42" fill="#86efac"/>
  <rect x="208" y="128" width="96" height="40" rx="8" fill="#fef9c3" stroke="#1f2937" stroke-width="6"/>
  <text x="256" y="464" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="bold" font-size="56" fill="#fef9c3">MOTE</text>
</svg>`);

  const tasks = [
    { name: "tray-icon-online.png", svg: dotSvg("#22c55e"), size: 32 },
    { name: "tray-icon-offline.png", svg: dotSvg("#ef4444"), size: 32 },
    { name: "tray-icon-busy.png", svg: dotSvg("#facc15"), size: 32 },
    { name: "tray-icon-online@2x.png", svg: dotSvg("#22c55e"), size: 64 },
    { name: "tray-icon-offline@2x.png", svg: dotSvg("#ef4444"), size: 64 },
    { name: "tray-icon-busy@2x.png", svg: dotSvg("#facc15"), size: 64 },
    { name: "icon.png", svg: appSvg, size: 512 },
  ];

  for (const t of tasks) {
    const out = path.join(outDir, t.name);
    await sharp(t.svg, { density: 320 })
      .resize(t.size, t.size)
      .png()
      .toFile(out);
    console.log("[icons] wrote", t.name, fs.statSync(out).size, "bytes");
  }
}

main().catch((err) => {
  console.error("[icons] failed", err);
  process.exit(1);
});
