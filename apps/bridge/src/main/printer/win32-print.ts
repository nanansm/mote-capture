// Windows printing — silent print of an image via PowerShell + the OS print
// shell verb (which uses the printer's default driver settings).
import { spawn } from "node:child_process";
import fs from "node:fs";
import type { PrinterDevice, PrinterOptions, PrintResult } from "./index";
import type { PrinterMode, DeviceTestResult } from "../../shared/types";
import { logger } from "../logger";

function exec(
  cmd: string,
  args: string[],
  timeoutMs = 60_000,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`Timeout after ${timeoutMs}ms: ${cmd}`));
    }, timeoutMs);
    proc.stdout.on("data", (b) => (stdout += b.toString()));
    proc.stderr.on("data", (b) => (stderr += b.toString()));
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export class Win32Printer implements PrinterDevice {
  readonly mode: PrinterMode = "win32";
  private printerName?: string;

  constructor(opts: PrinterOptions) {
    this.printerName = opts.printerName;
  }

  async init(): Promise<void> {
    if (process.platform !== "win32") {
      throw new Error("Mode 'win32' hanya tersedia di Windows.");
    }
    if (!this.printerName) {
      // Try to fall back to the default printer.
      const printers = await this.listPrinters().catch(() => [] as string[]);
      if (printers.length === 0) {
        throw new Error("Tidak ada printer terdeteksi.");
      }
      this.printerName = printers[0];
    }
  }

  async print(filePath: string): Promise<PrintResult> {
    if (process.platform !== "win32") {
      return { ok: false, error: "win32 printer hanya jalan di Windows" };
    }
    if (!fs.existsSync(filePath)) {
      return { ok: false, error: `File tidak ditemukan: ${filePath}` };
    }
    if (!this.printerName) await this.init();

    // Use mspaint /pt for silent print (non-blocking dialog-free print).
    const result = await exec(
      "mspaint",
      ["/pt", filePath, this.printerName!],
      90_000,
    );
    if (result.code !== 0) {
      logger.warn("printer_win32_failed", { stderr: result.stderr });
      return { ok: false, error: result.stderr || "Print gagal" };
    }
    logger.info("printer_win32_ok", { printer: this.printerName, file: filePath });
    return { ok: true };
  }

  async testConnection(): Promise<DeviceTestResult> {
    try {
      const printers = await this.listPrinters();
      const target = this.printerName ?? printers[0];
      if (!target) {
        return { ok: false, error: "Tidak ada printer terpasang." };
      }
      return { ok: true, deviceName: target };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async listPrinters(): Promise<string[]> {
    if (process.platform !== "win32") return [];
    const ps = `Get-Printer | Select-Object -ExpandProperty Name`;
    const result = await exec(
      "powershell.exe",
      ["-NoProfile", "-Command", ps],
      8_000,
    );
    if (result.code !== 0) return [];
    return result.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  }
}
