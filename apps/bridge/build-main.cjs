// Bundles the Electron main + preload into dist/main/ via esbuild. Used by
// `pnpm build` (one-shot) and `pnpm dev` (watch mode via --watch flag).
// Native modules (sharp, electron, electron-store, winston) are left external
// so Electron resolves them at runtime from node_modules.
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname);
const OUT = path.join(ROOT, "dist", "main");
const WATCH = process.argv.includes("--watch");

async function build() {
  fs.mkdirSync(OUT, { recursive: true });
  const common = {
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    sourcemap: true,
    minify: false,
    logLevel: "info",
    external: [
      "electron",
      "sharp",
      "electron-store",
      "winston",
      "winston-daily-rotate-file",
    ],
  };

  const entries = [
    { entry: "src/main/index.ts", out: "index.js" },
    { entry: "src/main/preload.ts", out: "preload.js" },
  ];

  if (WATCH) {
    for (const e of entries) {
      const ctx = await esbuild.context({
        ...common,
        entryPoints: [path.join(ROOT, e.entry)],
        outfile: path.join(OUT, e.out),
      });
      await ctx.watch();
    }
    console.log("[build-main] watching for changes…");
  } else {
    for (const e of entries) {
      await esbuild.build({
        ...common,
        entryPoints: [path.join(ROOT, e.entry)],
        outfile: path.join(OUT, e.out),
      });
    }
    console.log("[build-main] wrote", OUT);
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
