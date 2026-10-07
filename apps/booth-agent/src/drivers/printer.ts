// Abstraksi printer. Mock untuk rig e2e; driver CUPS (`lp` + `lpstat`) diisi
// di M4 setelah opsi PPD Gutenprint CP1500 terbaca dari `lpoptions -l`.
//
// Catatan: CUPS "completed" = data terkirim ke printer, BUKAN kertas keluar.
// Penghitung kertas/tinta tetap hitungan; kertas habis nyata terdeteksi dari
// printer `stopped` (PRD bagian 9).

export type PrinterState = "idle" | "printing" | "stopped" | "unknown";
export type PrinterStatus = { state: PrinterState; reason: string | null };
export type JobState = "queued" | "printing" | "done" | "failed";

export interface PrinterDriver {
  readonly name: string;
  status(): Promise<PrinterStatus>;
  submit(filePath: string, title: string): Promise<number>;
  jobState(jobId: number): Promise<JobState>;
}

export class MockPrinter implements PrinterDriver {
  readonly name = "mock";
  private nextId = 1;
  private jobs = new Map<number, { at: number; fail: boolean }>();
  private stopped: string | null = null;
  private failNext = false;
  printMs = 300;
  readonly submitted: { jobId: number; filePath: string; title: string }[] = [];

  async status(): Promise<PrinterStatus> {
    if (this.stopped) return { state: "stopped", reason: this.stopped };
    const busy = [...this.jobs.values()].some((j) => Date.now() - j.at < this.printMs);
    return { state: busy ? "printing" : "idle", reason: null };
  }
  async submit(filePath: string, title: string): Promise<number> {
    const id = this.nextId++;
    this.jobs.set(id, { at: Date.now(), fail: this.failNext });
    this.failNext = false;
    this.submitted.push({ jobId: id, filePath, title });
    return id;
  }
  async jobState(jobId: number): Promise<JobState> {
    const j = this.jobs.get(jobId);
    if (!j) return "failed";
    if (this.stopped) return "queued"; // CUPS menahan job saat printer stopped
    const age = Date.now() - j.at;
    if (age < this.printMs / 3) return "queued";
    if (age < this.printMs) return "printing";
    return j.fail ? "failed" : "done";
  }

  // ── kontrol uji ──
  setStopped(reason: string | null): void {
    this.stopped = reason;
  }
  failNextJob(): void {
    this.failNext = true;
  }
  resetMock(): void {
    this.stopped = null;
    this.failNext = false;
    this.submitted.length = 0;
  }
}

/** Driver CUPS: SENGAJA belum diisi sampai CP1500 + Gutenprint diuji (M4). */
export class CupsPrinter implements PrinterDriver {
  readonly name = "cups";
  async status(): Promise<PrinterStatus> {
    return { state: "unknown", reason: "driver CUPS belum diimplementasi (M4)" };
  }
  async submit(): Promise<number> {
    throw new Error("driver CUPS belum diimplementasi (M4)");
  }
  async jobState(): Promise<JobState> {
    return "failed";
  }
}
