// Mac/Linux printing via CUPS `lp` command.
// `lpstat -p` lists installed printers.
import { spawn } from "node:child_process";
import fs from "node:fs";
import type { PrinterDevice, PrinterOptions, PrintResult } from "./index";
import type { PrinterMode, DeviceTestResult } from "../../shared/types";
import { logger } from "../logger";

function exec(
  cmd: string,
  args: string[],
  timeoutMs = 30_000,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
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

export class CupsPrinter implements PrinterDevice {
  readonly mode: PrinterMode = "cups";
  private printerName?: string;

  constructor(opts: PrinterOptions) {
    this.printerName = opts.printerName;
  }

  async init(): Promise<void> {
    if (process.platform === "win32") {
      throw new Error("Mode 'cups' tidak didukung di Windows. Gunakan 'win32'.");
    }
    if (!this.printerName) {
      const printers = await this.listPrinters().catch(() => [] as string[]);
      if (printers.length === 0) {
        throw new Error("Tidak ada printer CUPS terpasang. Tambah printer di System Settings.");
      }
      this.printerName = printers[0];
    }
  }

  async print(filePath: string): Promise<PrintResult> {
    if (!fs.existsSync(filePath)) {
      return { ok: false, error: `File tidak ditemukan: ${filePath}` };
    }
    if (!this.printerName) await this.init();
    const args = [
      "-d", this.printerName!,
      "-o", "media=4x6",
      "-o", "fit-to-page",
      filePath,
    ];
    const result = await exec("lp", args, 30_000);
    if (result.code !== 0) {
      logger.warn("printer_cups_failed", { stderr: result.stderr });
      return { ok: false, error: result.stderr || "Print gagal" };
    }
    logger.info("printer_cups_ok", { printer: this.printerName, file: filePath });
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
    if (process.platform === "win32") return [];
    const result = await exec("lpstat", ["-p"], 5000).catch(() => null);
    if (!result || result.code !== 0) return [];
    // Lines look like: "printer EPSON_L8050 is idle. enabled since ..."
    return result.stdout
      .split("\n")
      .map((l) => {
        const m = l.match(/^printer\s+(\S+)/);
        return m ? m[1]! : "";
      })
      .filter(Boolean);
  }
}
