import path from "node:path";
import os from "node:os";
import fs from "node:fs";

export const APP_DATA_DIR = path.join(os.homedir(), ".mote-capture");
export const CAPTURES_DIR = path.join(APP_DATA_DIR, "captures");
export const TEMP_DIR = path.join(APP_DATA_DIR, "temp");
export const FRAMES_CACHE_DIR = path.join(APP_DATA_DIR, "frames");
export const COMPOSITES_DIR = path.join(APP_DATA_DIR, "composites");

export function ensureDirs(): void {
  for (const d of [APP_DATA_DIR, CAPTURES_DIR, TEMP_DIR, FRAMES_CACHE_DIR, COMPOSITES_DIR]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

export function tempFile(prefix: string, ext: string): string {
  const ts = Date.now();
  const rand = Math.floor(Math.random() * 0xffffff).toString(16);
  return path.join(TEMP_DIR, `${prefix}-${ts}-${rand}.${ext}`);
}
