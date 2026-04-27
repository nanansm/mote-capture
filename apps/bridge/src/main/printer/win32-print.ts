// Windows printing - silent print of an image via mspaint /pt + the printer's
// default driver settings. Printer enumeration uses Get-Printer (PowerShell)
// with JSON output so we can also see status (skip Error/PendingDeletion).
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

// Get-Printer returns one entry per installed printer. Status flags we want
// to skip: Error, PendingDeletion. Everything else (Normal, Idle, Paused,
// Printing, Busy, Offline, etc.) is acceptable - the user might still want
// to pick it.
const SKIP_STATUSES = new Set(["Error", "PendingDeletion"]);

type PrinterInfo = {
  Name: string;
  PrinterStatus?: string | number;
  Default?: boolean;
};

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
    // If a printer was already chosen in config, accept it without further
    // validation - listing can fail transiently and we should not crash init
    // because of that. Test/print paths will surface real errors.
    if (this.printerName && this.printerName.trim().length > 0) {
      logger.info("printer_win32_init", { printer: this.printerName, source: "config" });
      return;
    }
    // No printer chosen yet - try to fall back to the OS default.
    const def = await this.getDefaultPrinter().catch(() => undefined);
    if (def) {
      this.printerName = def;
      logger.info("printer_win32_init", { printer: def, source: "default" });
      return;
    }
    // Last resort: pick the first listed printer so we have something to point at.
    const printers = await this.listPrinters().catch(() => [] as string[]);
    if (printers.length === 0) {
      throw new Error(
        "Tidak ada printer terdeteksi. Tambah printer di Settings > Bluetooth & Devices > Printers.",
      );
    }
    this.printerName = printers[0];
    logger.info("printer_win32_init", { printer: this.printerName, source: "first" });
  }

  async print(filePath: string): Promise<PrintResult> {
    if (process.platform !== "win32") {
      return { ok: false, error: "win32 printer hanya jalan di Windows" };
    }
    if (!fs.existsSync(filePath)) {
      return { ok: false, error: `File tidak ditemukan: ${filePath}` };
    }
    if (!this.printerName) {
      try {
        await this.init();
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    // Silent print via System.Drawing.Printing.PrintDocument. mspaint /pt
    // surfaces the Windows print dialog on top of the kiosk fullscreen,
    // which interrupts customers; PrintDocument prints headlessly.
    //
    // Paper config: 4R landscape (4x6 inch). PaperSize is in 100ths of inch
    // and we pass 600x400 to match a 6"x4" landscape sheet, with margins=0
    // and DrawImage(image, e.PageBounds) so the composite fills the entire
    // printable area edge-to-edge (composite already has SAFE_MARGIN_X
    // baked in to avoid the Epson L8050's unprintable border).
    const escFile = filePath.replace(/'/g, "''");
    const escPrinter = this.printerName!.replace(/'/g, "''");
    const psScript = [
      "$ErrorActionPreference = 'Stop'",
      "Add-Type -AssemblyName System.Drawing",
      `$image = [System.Drawing.Image]::FromFile('${escFile}')`,
      "try {",
      "  $printDoc = New-Object System.Drawing.Printing.PrintDocument",
      `  $printDoc.PrinterSettings.PrinterName = '${escPrinter}'`,
      "  $paper = New-Object System.Drawing.Printing.PaperSize('4R', 600, 400)",
      "  $paper.RawKind = 0",
      "  $printDoc.DefaultPageSettings.PaperSize = $paper",
      "  $printDoc.DefaultPageSettings.Landscape = $true",
      "  $printDoc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0,0,0,0)",
      "  $printDoc.PrintController = New-Object System.Drawing.Printing.StandardPrintController",
      "  $printDoc.add_PrintPage({",
      "    param($sender, $e)",
      "    $e.Graphics.DrawImage($image, $e.PageBounds)",
      "  })",
      "  $printDoc.Print()",
      "} finally {",
      "  $image.Dispose()",
      "}",
    ].join("\n");

    const result = await exec(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        psScript,
      ],
      60_000,
    );
    if (result.code !== 0) {
      logger.warn("printer_win32_failed", {
        printer: this.printerName,
        code: result.code,
        stderr: result.stderr,
        stdout: result.stdout,
      });
      return {
        ok: false,
        error: result.stderr || result.stdout || `Print gagal (exit ${result.code})`,
      };
    }
    logger.info("printer_win32_ok", { printer: this.printerName, file: filePath });
    return { ok: true };
  }

  async testConnection(): Promise<DeviceTestResult> {
    if (process.platform !== "win32") {
      return { ok: false, error: "Mode 'win32' hanya tersedia di Windows." };
    }
    try {
      const printers = await this.listPrinters();
      // If the user set a printer name in config, prefer it as the test target.
      if (this.printerName && this.printerName.trim().length > 0) {
        if (printers.length > 0 && !printers.includes(this.printerName)) {
          return {
            ok: false,
            error:
              `Printer "${this.printerName}" tidak ditemukan.\n\n` +
              `Tersedia: ${printers.join(", ") || "(none)"}`,
          };
        }
        return { ok: true, deviceName: this.printerName };
      }
      // No name set - fall back to default
      const def = await this.getDefaultPrinter().catch(() => undefined);
      if (def) return { ok: true, deviceName: def };
      if (printers.length === 0) return { ok: false, error: "Tidak ada printer terpasang." };
      return { ok: true, deviceName: printers[0] };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async listPrinters(): Promise<string[]> {
    if (process.platform !== "win32") return [];
    // ConvertTo-Json -Compress avoids extra whitespace; -Depth 3 covers nested fields.
    const ps =
      "Get-Printer | Select-Object Name,PrinterStatus,Default | " +
      "ConvertTo-Json -Compress -Depth 3";
    const result = await exec(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", ps],
      10_000,
    );
    if (result.code !== 0) {
      logger.warn("printer_list_failed", {
        code: result.code,
        stderr: result.stderr,
        stdout: result.stdout,
      });
      return [];
    }
    const raw = result.stdout.trim();
    if (!raw) return [];
    let parsed: PrinterInfo[] | PrinterInfo;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      logger.warn("printer_list_parse_failed", {
        err: err instanceof Error ? err.message : String(err),
        raw: raw.slice(0, 500),
      });
      return [];
    }
    const list = Array.isArray(parsed) ? parsed : [parsed];
    const filtered = list
      .filter((p) => p && typeof p.Name === "string")
      .filter((p) => {
        const status = typeof p.PrinterStatus === "string" ? p.PrinterStatus : "";
        return !SKIP_STATUSES.has(status);
      })
      .map((p) => p.Name)
      .filter((name): name is string => Boolean(name));
    logger.debug("printer_list_ok", { count: filtered.length, names: filtered });
    return filtered;
  }

  private async getDefaultPrinter(): Promise<string | undefined> {
    if (process.platform !== "win32") return undefined;
    const ps =
      "Get-CimInstance Win32_Printer -Filter 'Default = TRUE' | " +
      "Select-Object -ExpandProperty Name";
    const r = await exec(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", ps],
      6_000,
    );
    if (r.code !== 0) return undefined;
    const name = r.stdout.split(/\r?\n/)[0]?.trim();
    return name || undefined;
  }
}
