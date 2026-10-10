// iPaymu API v2 — QRIS Direct Payment.
//
// Sumber spesifikasi (diverifikasi 10 Okt 2026):
//   - Postman resmi iPaymu: https://documenter.getpostman.com/view/40296808/2sB3WtseBT
//     (Direct Payment, Check Transaction, Callback Params, Check Balance)
//   - SDK resmi: github.com/ipaymu/ipaymu-go-api (signature.go, callback.go)
//
// Signature request: stringToSign = METHOD:VA:sha256hex(body):APIKEY,
// lalu HMAC-SHA256(stringToSign, APIKEY). Header: va, signature, timestamp.
//
// Keputusan desain soal callback: status bayar TIDAK diambil dari isi
// callback. Callback hanya memicu Check Transaction ke API iPaymu memakai
// kredensial kita sendiri, dan hasil API itulah yang dipercaya. Alasannya:
//   1. Signature callback dihitung iPaymu dari JSON PHP (tipe angka/boolean,
//      slash di-escape). Kalau callback datang form-urlencoded, semua nilai
//      jadi string dan rekonstruksi bisa meleset → pembayaran asli ditolak.
//   2. Callback palsu paling jauh memicu satu lookup; tidak bisa menandai
//      sesi lunas.
// Signature tetap dicek dan hasilnya dicatat untuk audit.
import { logger } from "@/lib/logger";
import type {
  CreateQRParams,
  CreateQRResult,
  PaymentProvider,
  VerifyWebhookParams,
  VerifyWebhookResult,
} from "./types";

export type IpaymuMode = "production" | "sandbox";

export type IpaymuCredentials = {
  va?: string;
  apiKey?: string;
  mode?: IpaymuMode;
  notifyUrl?: string;
  // Relay ber-IP tetap (whitelist iPaymu). Worker Cloudflare tidak punya IP
  // statis; tanpa relay, /payment/direct ditolak "406 Invalid IP".
  relayUrl?: string;
  relayToken?: string;
};

export const IPAYMU_BASE_URL: Record<IpaymuMode, string> = {
  production: "https://my.ipaymu.com/api/v2",
  sandbox: "https://sandbox.ipaymu.com/api/v2",
};

// QRIS iPaymu tidak bisa diatur masa berlakunya (dok resmi: default 5 menit).
// Sesi kiosk tetap memakai batas sendiri; bayar setelah itu masuk jalur
// pembayaran terlambat (voucher otomatis).
export const IPAYMU_QRIS_LIFETIME_MINUTES = 5;

// Data->Status Check Transaction yang dianggap lunas (dok resmi: 1, 6, 7).
const PAID_STATUSES = new Set([1, 6, 7]);
// -2 expired, 2 batal, 4 error, 5 gagal.
const DEAD_STATUSES = new Set([-2, 2, 4, 5]);

const enc = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(input: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(input)));
}

export async function hmacSha256Hex(message: string, key: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", k, enc.encode(message)));
}

export async function ipaymuRequestSignature(method: "GET" | "POST", va: string, apiKey: string, body: string) {
  const bodyHash = (await sha256Hex(body)).toLowerCase();
  return hmacSha256Hex(`${method}:${va}:${bodyHash}:${apiKey}`, apiKey);
}

// Format header timestamp: YYYYMMDDHHmmss (WIB). Informasional, tidak ikut ditandatangani.
export function ipaymuTimestamp(d = new Date()): string {
  const w = new Date(d.getTime() + 7 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${w.getUTCFullYear()}${p(w.getUTCMonth() + 1)}${p(w.getUTCDate())}${p(w.getUTCHours())}${p(w.getUTCMinutes())}${p(w.getUTCSeconds())}`;
}

// Rekonstruksi JSON yang ditandatangani iPaymu untuk callback (dok resmi:
// buang `signature`, ksort, json_encode PHP, HMAC dengan nomor VA).
// Field form-urlencoded dikembalikan ke tipe aslinya mengikuti contoh resmi.
const INT_FIELDS = new Set(["trx_id", "status_code", "transaction_status_code", "paid_off"]);

export function ipaymuCallbackString(payload: Record<string, unknown>): string {
  const norm: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (k === "signature") continue;
    if (INT_FIELDS.has(k)) {
      const n = Number.parseInt(String(v), 10);
      norm[k] = Number.isNaN(n) ? v : n;
    } else if (k === "is_escrow") {
      norm[k] = v === true || v === "true" || v === "1" || v === 1;
    } else if (k === "additional_info") {
      norm[k] = v === "[]" || v === "" || v == null ? [] : v;
    } else {
      norm[k] = v == null ? "" : typeof v === "string" ? v : v;
    }
  }
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(norm).sort()) sorted[k] = norm[k];
  return JSON.stringify(sorted).replace(/\//g, "\\/");
}

export async function verifyIpaymuCallbackSignature(
  payload: Record<string, unknown>,
  received: string | undefined,
  va: string,
): Promise<boolean> {
  if (!received || !va) return false;
  const expected = await hmacSha256Hex(ipaymuCallbackString(payload), va);
  const a = expected.toLowerCase();
  const b = received.trim().toLowerCase();
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function parseIpaymuBody(body: string, contentType: string): Record<string, unknown> | null {
  const trimmed = body.trim();
  if (!trimmed) return null;
  if (contentType.includes("application/json") || trimmed.startsWith("{")) {
    try {
      const v = JSON.parse(trimmed) as unknown;
      return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of new URLSearchParams(trimmed)) out[k] = v;
  return Object.keys(out).length ? out : null;
}

export type IpaymuTransaction = {
  transactionId: string;
  referenceId: string;
  status: number;
  amount: number;
};

export class IpaymuProvider implements PaymentProvider {
  readonly name = "ipaymu";
  private readonly va?: string;
  private readonly apiKey?: string;
  private readonly mode: IpaymuMode;
  private readonly notifyUrl?: string;
  private readonly relayUrl?: string;
  private readonly relayToken?: string;

  constructor(c: IpaymuCredentials) {
    this.relayUrl = c.relayUrl?.trim().replace(/\/+$/, "") || undefined;
    this.relayToken = c.relayToken?.trim() || undefined;
    this.va = c.va?.trim() || undefined;
    this.apiKey = c.apiKey?.trim() || undefined;
    this.mode = c.mode === "sandbox" ? "sandbox" : "production";
    this.notifyUrl = c.notifyUrl;
  }

  get configured(): boolean {
    return Boolean(this.va && this.apiKey);
  }

  private async call(path: string, payload: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown>; text: string }> {
    const body = JSON.stringify(payload);
    const signature = await ipaymuRequestSignature("POST", this.va!, this.apiKey!, body);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json",
      va: this.va!,
      signature,
      timestamp: ipaymuTimestamp(),
    };
    const useRelay = Boolean(this.relayUrl && this.relayToken);
    if (useRelay) {
      headers["x-relay-token"] = this.relayToken!;
      headers["x-ipaymu-mode"] = this.mode;
    }
    const url = useRelay ? `${this.relayUrl}/v2${path}` : `${IPAYMU_BASE_URL[this.mode]}${path}`;
    const res = await fetch(url, { method: "POST", headers, body });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // biarkan kosong
    }
    return { status: res.status, json, text };
  }

  async createQR(params: CreateQRParams): Promise<CreateQRResult> {
    const expiresInMinutes = params.expiresInMinutes ?? IPAYMU_QRIS_LIFETIME_MINUTES;
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60_000);

    if (!this.configured) {
      logger.warn("ipaymu_mock_create_qr", { sessionId: params.sessionId, amount: params.amount });
      return {
        providerRef: `MOCK_IPAYMU_${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        qrString: `MOCK_${params.sessionId}_${params.amount}_${Date.now()}`,
        expiresAt,
        rawResponse: { mock: true },
        mockMode: true,
      };
    }
    if (!this.notifyUrl) throw new Error("iPaymu notifyUrl belum tersedia (APP_URL kosong)");

    // name/phone/email wajib di Direct Payment. Booth tidak mengumpulkan data
    // pembeli sebelum bayar, jadi diisi identitas booth (bukan data konsumen).
    // feeDirection MERCHANT: pelanggan membayar persis harga sesi.
    const { status, json, text } = await this.call("/payment/direct", {
      name: "Mote Capture Booth",
      phone: "081200000000",
      email: "booth@motekreatif.com",
      amount: params.amount,
      notifyUrl: this.notifyUrl,
      referenceId: params.sessionId,
      paymentMethod: "qris",
      paymentChannel: "mpm",
      feeDirection: "MERCHANT",
      comments: `Sesi ${params.sessionId}`,
    });

    const data = (json.Data ?? {}) as Record<string, unknown>;
    if (status !== 200 || Number(json.Status) !== 200) {
      logger.error("ipaymu_create_qr_failed", { status, body: text.slice(0, 300) });
      const msg = typeof json.Message === "string" ? json.Message : text.slice(0, 160);
      throw new Error(`iPaymu QR gagal dibuat (${status}): ${msg}`);
    }
    const trxId = data.TransactionId != null ? String(data.TransactionId) : "";
    const qrString =
      typeof data.QrString === "string" && data.QrString
        ? data.QrString
        : typeof data.PaymentNo === "string"
          ? data.PaymentNo
          : "";
    if (!trxId || !qrString) throw new Error("Respons iPaymu tanpa TransactionId/QrString");

    return { providerRef: trxId, qrString, expiresAt, rawResponse: json };
  }

  async checkTransaction(transactionId: string): Promise<IpaymuTransaction | null> {
    if (!this.configured) return null;
    const id = Number.parseInt(transactionId, 10);
    if (!Number.isFinite(id)) return null;
    let r: { status: number; json: Record<string, unknown>; text: string };
    try {
      r = await this.call("/transaction", { transactionId: id, account: this.va });
    } catch (err) {
      logger.warn("ipaymu_check_network_error", { message: err instanceof Error ? err.message : String(err) });
      return null;
    }
    const { status, json, text } = r;
    const data = (json.Data ?? null) as Record<string, unknown> | null;
    if (status !== 200 || Number(json.Status) !== 200 || !data) {
      logger.warn("ipaymu_check_failed", { status, body: text.slice(0, 200) });
      return null;
    }
    return {
      transactionId: String(data.TransactionId ?? id),
      referenceId: data.ReferenceId == null ? "" : String(data.ReferenceId),
      status: Number(data.Status),
      amount: Number(data.Amount ?? 0),
    };
  }

  // Dipakai route webhook: verifikasi = signature (audit) + Check Transaction (otoritas).
  async verifyWebhook(params: VerifyWebhookParams): Promise<VerifyWebhookResult> {
    const ct = params.headers["content-type"] ?? "";
    const payload = parseIpaymuBody(params.body, ct);
    if (!payload) return { valid: false, reason: "body kosong/tidak valid" };
    const trxId = payload.trx_id != null ? String(payload.trx_id) : "";
    if (!trxId) return { valid: false, reason: "trx_id kosong", rawPayload: payload };
    if (!this.configured) return { valid: false, reason: "kredensial iPaymu belum diisi", rawPayload: payload };

    const sig = params.headers["x-signature"] ?? (typeof payload.signature === "string" ? payload.signature : undefined);
    const signatureOk = await verifyIpaymuCallbackSignature(payload, sig, this.va!);

    const trx = await this.checkTransaction(trxId);
    if (!trx) return { valid: false, reason: "Check Transaction gagal", rawPayload: { ...payload, signatureOk } };

    const event = PAID_STATUSES.has(trx.status) ? "paid" : DEAD_STATUSES.has(trx.status) ? "expired" : undefined;
    return {
      valid: true,
      event,
      // Referensi dari API, bukan dari body callback.
      sessionRef: trx.referenceId || undefined,
      amount: trx.amount,
      rawPayload: { ...payload, signatureOk, verifiedStatus: trx.status, verifiedTransactionId: trx.transactionId },
    };
  }

  async ping(): Promise<{ ok: boolean; message: string }> {
    if (!this.configured) return { ok: false, message: "VA / API Key iPaymu belum diisi (mock mode aktif)" };
    try {
      const { status, json, text } = await this.call("/balance", { account: this.va });
      if (status !== 200 || Number(json.Status) !== 200) {
        const msg = typeof json.Message === "string" ? json.Message : text.slice(0, 120);
        return { ok: false, message: `iPaymu (${this.mode}) menolak: ${status} ${msg}` };
      }
      return { ok: true, message: `iPaymu ${this.mode === "sandbox" ? "SANDBOX" : "PRODUCTION"} terhubung` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "Network error" };
    }
  }
}
