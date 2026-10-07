// Klien HTTP ke Workers (bridge + boot). Semua panggilan bertimeout supaya
// wifi kafe yang lemot tidak menggantung antrean.
import fs from "node:fs/promises";
import type { AgentConfig } from "./config.js";
import type { KioskBootData, PrintStatusReport } from "@capture/shared";

export type CloudResult<T = unknown> = { status: number; body: T | null; error?: string };

const TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 60_000;

export class Cloud {
  constructor(private cfg: AgentConfig) {}

  private async call<T>(method: string, path: string, init: { json?: unknown; file?: { path: string; type: string }; auth?: boolean; timeoutMs?: number } = {}): Promise<CloudResult<T>> {
    const headers: Record<string, string> = {};
    if (init.auth !== false) headers.authorization = `Bearer ${this.cfg.bridgeToken}`;
    let body: BodyInit | undefined;
    if (init.json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(init.json);
    } else if (init.file) {
      const buf = await fs.readFile(init.file.path);
      headers["content-type"] = init.file.type;
      // Content-Length diisi undici dari Buffer; set manual = "invalid content-length header".
      body = buf;
    }
    try {
      const res = await fetch(`${this.cfg.apiOrigin}${path}`, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(init.timeoutMs ?? TIMEOUT_MS),
      });
      const text = await res.text();
      let parsed: T | null = null;
      try {
        parsed = text ? (JSON.parse(text) as T) : null;
      } catch {
        parsed = null;
      }
      return { status: res.status, body: parsed };
    } catch (err) {
      // undici "fetch failed" menyembunyikan penyebab asli di `cause`.
      const cause = err instanceof Error && err.cause instanceof Error ? `: ${err.cause.message}` : "";
      return { status: 0, body: null, error: (err instanceof Error ? err.message : String(err)) + cause };
    }
  }

  boot() {
    return this.call<{ data: KioskBootData }>("GET", `/api/kiosk/boot?boothId=${encodeURIComponent(this.cfg.boothId)}`, { auth: false });
  }
  done(sessionId: string) {
    return this.call("POST", `/api/bridge/session/${encodeURIComponent(sessionId)}/done`);
  }
  cancelVoucher(sessionId: string, staff: string) {
    return this.call<{ data: { code: string; voucherId: string }; error?: string }>(
      "POST",
      `/api/bridge/session/${encodeURIComponent(sessionId)}/cancel-voucher`,
      { json: { staff } },
    );
  }
  printStatus(sessionId: string, report: PrintStatusReport) {
    return this.call("POST", `/api/bridge/session/${encodeURIComponent(sessionId)}/print-status`, { json: report });
  }
  uploadComposite(sessionId: string, filePath: string) {
    return this.call("PUT", `/api/session/${encodeURIComponent(sessionId)}/composite`, {
      file: { path: filePath, type: "image/jpeg" },
      timeoutMs: UPLOAD_TIMEOUT_MS,
    });
  }
  uploadPhoto(sessionId: string, slot: number, filePath: string) {
    return this.call("PUT", `/api/session/${encodeURIComponent(sessionId)}/photos?sortOrder=${slot}`, {
      file: { path: filePath, type: "image/jpeg" },
      timeoutMs: UPLOAD_TIMEOUT_MS,
    });
  }
  heartbeat(body: Record<string, unknown>) {
    return this.call("POST", "/api/bridge/heartbeat", { json: { boothId: this.cfg.boothId, ...body } });
  }
  async download(url: string): Promise<Buffer> {
    const res = await fetch(url, { signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`unduh ${url} gagal: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
}
