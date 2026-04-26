// Mock printer — saves the would-be print as a PDF (well, PNG copy with .pdf
// extension is unhelpful) under ~/Downloads. We use Sharp to generate a small
// PDF-ish container by just copying the PNG into ~/Downloads with a clear
// filename and (on macOS) auto-opening it via `open`.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import sharp from "sharp";
import type { PrinterDevice, PrinterOptions, PrintResult } from "./index";
import type { PrinterMode, DeviceTestResult } from "../../shared/types";
import { logger } from "../logger";

const DOWNLOADS_DIR = path.join(os.homedir(), "Downloads");

let lastPrintAt: Date | null = null;

function openInOs(filePath: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer.exe" : "xdg-open";
  try {
    spawn(cmd, [filePath], { detached: true, stdio: "ignore" }).unref();
  } catch {
    // ignore
  }
}

export class MockPrinter implements PrinterDevice {
  readonly mode: PrinterMode = "mock";

  constructor(_opts: PrinterOptions) {
    // no-op
  }

  async init(): Promise<void> {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
  }

  async print(filePath: string): Promise<PrintResult> {
    if (!fs.existsSync(filePath)) {
      return { ok: false, error: `File tidak ditemukan: ${filePath}` };
    }
    await this.init();
    const ts = Date.now();
    const out = path.join(DOWNLOADS_DIR, `mote-capture-print-${ts}.png`);
    // Resample to 4R 1800x1200 dpi 300 to mimic print output (and ensure
    // the file is non-trivial).
    await sharp(filePath)
      .resize(1800, 1200, { fit: "contain", background: "#ffffff" })
      .png()
      .toFile(out);
    lastPrintAt = new Date();
    logger.info("printer_mock_ok", { out, src: filePath });
    openInOs(out);
    return { ok: true };
  }

  async testConnection(): Promise<DeviceTestResult> {
    await this.init();
    return {
      ok: true,
      deviceName: lastPrintAt
        ? `Mock PDF (last print ${lastPrintAt.toLocaleString("id-ID", { hour12: false })})`
        : "Mock PDF (~/Downloads)",
    };
  }

  async listPrinters(): Promise<string[]> {
    return ["Mock PDF (~/Downloads)"];
  }
}

export function getLastMockPrintAt(): Date | null {
  return lastPrintAt;
}
