// Generates a colorful SVG → PNG placeholder via Sharp. Used for offline dev
// or when no real camera is configured. Output is a 1280×960 PNG so the
// composer downstream sees realistic photo dimensions.
import sharp from "sharp";
import fs from "node:fs";
import type { CameraDevice, CameraOptions, CaptureResult } from "./index";
import type { CameraMode, DeviceTestResult } from "../../shared/types";
import { tempFile, ensureDirs } from "../paths";
import { logger } from "../logger";

const PALETTE = ["#0f5132", "#198754", "#fef9c3", "#fb923c", "#dc2626", "#3b82f6"];

function pseudoRandomColor(seed: number): string {
  return PALETTE[seed % PALETTE.length] as string;
}

function makeSvg(label: string, color: string): Buffer {
  const ts = new Date().toLocaleString("id-ID", { hour12: false });
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg width="1280" height="960" viewBox="0 0 1280 960" xmlns="http://www.w3.org/2000/svg">
  <rect width="1280" height="960" fill="${color}"/>
  <circle cx="640" cy="380" r="220" fill="#fef9c3" opacity="0.85"/>
  <text x="640" y="420" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="bold" font-size="240" fill="#0f5132">${label}</text>
  <text x="640" y="780" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="42" fill="#fef9c3">MOCK CAMERA</text>
  <text x="640" y="850" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="32" fill="#fef9c3">${ts}</text>
</svg>`);
}

export class MockCamera implements CameraDevice {
  readonly mode: CameraMode = "mock";
  private counter = 0;

  constructor(_opts: CameraOptions) {
    // no-op
  }

  async init(): Promise<void> {
    ensureDirs();
    logger.info("camera_mock_init");
  }

  async capture(): Promise<CaptureResult> {
    this.counter += 1;
    const color = pseudoRandomColor(this.counter);
    const svg = makeSvg(String(this.counter), color);
    const out = tempFile("mock", "jpg");
    await sharp(svg, { density: 144 })
      .resize(1280, 960)
      .jpeg({ quality: 85 })
      .toFile(out);
    return { filePath: out, mimeType: "image/jpeg" };
  }

  async testConnection(): Promise<DeviceTestResult> {
    const cap = await this.capture();
    const dataUrl = `data:${cap.mimeType};base64,${fs.readFileSync(cap.filePath).toString("base64")}`;
    return { ok: true, deviceName: "Mock Camera (SVG generator)", previewDataUrl: dataUrl };
  }

  async cleanup(): Promise<void> {
    // no-op
  }
}
