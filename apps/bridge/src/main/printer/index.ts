import type { PrinterMode, DeviceTestResult } from "../../shared/types";
import { Win32Printer } from "./win32-print";
import { CupsPrinter } from "./cups-print";
import { MockPrinter } from "./mock";

export type PrinterOptions = {
  printerName?: string;
};

export type PrintResult = {
  ok: boolean;
  error?: string;
};

export interface PrinterDevice {
  readonly mode: PrinterMode;
  init(): Promise<void>;
  print(filePath: string): Promise<PrintResult>;
  testConnection(): Promise<DeviceTestResult>;
  listPrinters(): Promise<string[]>;
}

export function createPrinter(mode: PrinterMode, options: PrinterOptions = {}): PrinterDevice {
  switch (mode) {
    case "win32":
      return new Win32Printer(options);
    case "cups":
      return new CupsPrinter(options);
    case "mock":
      return new MockPrinter(options);
  }
}
