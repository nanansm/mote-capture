// DOKU Checkout (non-SNAP), dibatasi ke QRIS. Jalur yang sama dengan Selfbooth:
// admin cukup isi Client ID + Active Secret Key, lalu tempel Notification URL
// per akun di Back Office DOKU.
//
// Sumber (dicek 10 Okt 2026):
// - Create:   developers.doku.com/accept-payments/doku-checkout/integration-guide/backend-integration
//             POST /checkout/v1/payment -> response.payment.url (halaman bayar)
// - Signature: HMACSHA256=base64(HMAC_SHA256(secret,
//               "Client-Id:..\nRequest-Id:..\nRequest-Timestamp:..\nRequest-Target:..[\nDigest:..]"))
//              Digest = base64(sha256(body)); GET tanpa Digest.
// - Status:   GET /orders/v1/status/{invoice_number}
// - Notify:   header Signature dengan Request-Target = path Notification URL kita.
// - Plugin resmi DOKU WooCommerce (Common/JokulUtils.php) memakai rumus yang sama.
//
// Notifikasi tidak dipercaya mentah: signature wajib cocok, lalu status dicek
// ulang ke API DOKU. Hanya "SUCCESS" dari API yang membuka sesi.
import { logger } from "@/lib/logger";
import type {
  CreateQRParams,
  CreateQRResult,
  PaymentProvider,
  VerifyWebhookParams,
  VerifyWebhookResult,
  WebhookEvent,
} from "./types";

export type DokuMode = "production" | "sandbox";

export const DOKU_BASE_URL: Record<DokuMode, string> = {
  production: "https://api.doku.com",
  sandbox: "https://api-sandbox.doku.com",
};

export type DokuCredentials = {
  clientId?: string;
  secretKey?: string;
  mode?: DokuMode;
};

const enc = new TextEncoder();

function b64(bytes: ArrayBuffer): string {
  let s = "";
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i++) s += String.fromCharCode(view[i]!);
  return btoa(s);
}

export async function dokuDigest(body: string): Promise<string> {
  return b64(await crypto.subtle.digest("SHA-256", enc.encode(body)));
}

export async function dokuSignature(p: {
  clientId: string;
  requestId: string;
  timestamp: string;
  target: string;
  secretKey: string;
  body?: string;
}): Promise<string> {
  let raw = `Client-Id:${p.clientId}\nRequest-Id:${p.requestId}\nRequest-Timestamp:${p.timestamp}\nRequest-Target:${p.target}`;
  if (p.body !== undefined) raw += `\nDigest:${await dokuDigest(p.body)}`;
  const key = await crypto.subtle.importKey("raw", enc.encode(p.secretKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `HMACSHA256=${b64(await crypto.subtle.sign("HMAC", key, enc.encode(raw)))}`;
}

// Format DOKU: ISO8601 UTC tanpa milidetik, mis. 2020-08-11T08:45:42Z.
export function dokuTimestamp(d = new Date()): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

// Invoice tanpa simbol (aturan DOKU untuk KKI): "SES-AB12" -> "SESAB12".
export function dokuInvoice(sessionId: string): string {
  return sessionId.replace(/[^A-Za-z0-9]/g, "").slice(0, 30);
}

// Kebalikan dokuInvoice untuk id sesi kita (SES-XXXXXXXXXX). Invoice lain
// dikembalikan apa adanya; webhook tetap mencocokkan ke payment_ref sesi.
export function dokuSessionId(invoice: string): string {
  const m = /^SES([A-Z0-9]{10})$/.exec(invoice);
  return m ? `SES-${m[1]}` : invoice;
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type DokuStatus = { invoice: string; status: string; amount: number };

// Body notifikasi & respons Check Status berbentuk sama ({order, transaction}).
export function readDokuStatus(json: unknown): DokuStatus | null {
  if (!json || typeof json !== "object") return null;
  const root = json as Record<string, unknown>;
  const src = (root.order ? root : (root.response as Record<string, unknown> | undefined)) ?? root;
  const order = (src.order ?? {}) as Record<string, unknown>;
  const trx = (src.transaction ?? {}) as Record<string, unknown>;
  const invoice = order.invoice_number == null ? "" : String(order.invoice_number);
  const status = trx.status == null ? "" : String(trx.status).toUpperCase();
  if (!invoice || !status) return null;
  const amount = Number(order.amount ?? 0);
  return { invoice, status, amount: Number.isFinite(amount) ? amount : 0 };
}

export function dokuEvent(status: string): WebhookEvent | undefined {
  if (status === "SUCCESS") return "paid";
  if (status === "EXPIRED") return "expired";
  if (status === "FAILED") return "failed";
  return undefined; // PENDING, TIMEOUT, REDIRECT: belum final
}

function errorCode(json: Record<string, unknown>): string {
  const e = json.error as Record<string, unknown> | undefined;
  return typeof e?.code === "string" ? e.code : "";
}

function errorText(json: Record<string, unknown>, text: string): string {
  const e = json.error as Record<string, unknown> | undefined;
  if (typeof e?.message === "string") return e.message;
  if (Array.isArray(json.message)) return json.message.join(", ");
  return text.slice(0, 160);
}

export class DokuProvider implements PaymentProvider {
  readonly name = "doku";
  private readonly clientId?: string;
  private readonly secretKey?: string;
  readonly mode: DokuMode;

  constructor(c: DokuCredentials) {
    this.clientId = c.clientId?.trim() || undefined;
    this.secretKey = c.secretKey?.trim() || undefined;
    this.mode = c.mode === "sandbox" ? "sandbox" : "production";
  }

  get configured(): boolean {
    return Boolean(this.clientId && this.secretKey);
  }

  private async call(method: "GET" | "POST", target: string, payload?: Record<string, unknown>) {
    const body = payload ? JSON.stringify(payload) : undefined;
    const requestId = crypto.randomUUID();
    const timestamp = dokuTimestamp();
    const signature = await dokuSignature({
      clientId: this.clientId!,
      requestId,
      timestamp,
      target,
      secretKey: this.secretKey!,
      body,
    });
    const res = await fetch(`${DOKU_BASE_URL[this.mode]}${target}`, {
      method,
      headers: {
        "content-type": "application/json",
        "Client-Id": this.clientId!,
        "Request-Id": requestId,
        "Request-Timestamp": timestamp,
        Signature: signature,
      },
      body,
    });
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
    const minutes = Math.max(1, params.expiresInMinutes ?? 1);
    const expiresAt = new Date(Date.now() + minutes * 60_000);
    if (!this.configured) throw new Error("Akun DOKU belum lengkap (Client ID / Secret Key)");

    const invoice = dokuInvoice(params.sessionId);
    const { status, json, text } = await this.call("POST", "/checkout/v1/payment", {
      order: {
        amount: params.amount,
        invoice_number: invoice,
        currency: "IDR",
        line_items: [{ name: "Sesi foto", quantity: 1, price: params.amount }],
      },
      payment: { payment_due_date: minutes, payment_method_types: ["QRIS"] },
    });
    const payment = ((json.response as Record<string, unknown> | undefined)?.payment ?? {}) as Record<string, unknown>;
    const url = typeof payment.url === "string" ? payment.url : "";
    if (status !== 200 || !url) {
      logger.error("doku_create_failed", { status, body: text.slice(0, 300) });
      throw new Error(`DOKU gagal membuat pembayaran (${status}): ${errorText(json, text)}`);
    }
    if (!/^https:\/\/([a-z0-9-]+\.)*doku\.com\//i.test(url)) throw new Error("URL pembayaran DOKU tidak dikenal");
    return { providerRef: invoice, qrString: "", paymentUrl: url, expiresAt, rawResponse: { invoice, tokenId: payment.token_id } };
  }

  // null = tidak bisa dipastikan (jaringan/API gangguan).
  async checkStatus(invoice: string): Promise<DokuStatus | null> {
    if (!this.configured) return null;
    try {
      const { status, json, text } = await this.call("GET", `/orders/v1/status/${encodeURIComponent(invoice)}`);
      if (status !== 200) {
        logger.warn("doku_check_failed", { status, body: text.slice(0, 200) });
        return null;
      }
      return readDokuStatus(json);
    } catch (err) {
      logger.warn("doku_check_network_error", { message: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }

  // headers: huruf kecil. path: path URL notifikasi yang diterima (Request-Target).
  async verifyWebhook(params: VerifyWebhookParams): Promise<VerifyWebhookResult> {
    if (!this.configured) return { valid: false, reason: "DOKU account incomplete" };
    const h = params.headers;
    const received = h["signature"] ?? "";
    const clientId = h["client-id"] ?? "";
    const requestId = h["request-id"] ?? "";
    const timestamp = h["request-timestamp"] ?? "";
    if (!received || !requestId || !timestamp || !params.path) return { valid: false, reason: "missing signature headers" };
    if (clientId !== this.clientId) return { valid: false, reason: "client id mismatch" };
    const expected = await dokuSignature({
      clientId,
      requestId,
      timestamp,
      target: params.path,
      secretKey: this.secretKey!,
      body: params.body,
    });
    if (!safeEqual(expected, received.trim())) return { valid: false, reason: "bad signature" };

    let parsed: unknown;
    try {
      parsed = JSON.parse(params.body);
    } catch {
      return { valid: false, reason: "invalid json" };
    }
    const notified = readDokuStatus(parsed);
    if (!notified) return { valid: true, rawPayload: { notified: null } };

    // Otoritas = API Check Status. Kalau API tidak terjangkau, notifikasi yang
    // signature-nya cocok tetap dipakai (signature = bukti dari DOKU).
    const checked = await this.checkStatus(notified.invoice);
    const final = checked ?? notified;
    if (checked && checked.invoice !== notified.invoice) return { valid: false, reason: "status invoice mismatch" };
    return {
      valid: true,
      event: dokuEvent(final.status),
      sessionRef: dokuSessionId(notified.invoice),
      amount: final.amount || notified.amount,
      rawPayload: { invoice: notified.invoice, notifiedStatus: notified.status, checkedStatus: checked?.status ?? null, checked: Boolean(checked) },
    };
  }

  // Tes koneksi: tanya status invoice acak. Key benar = DOKU menjawab selain
  // invalid_client_id / invalid_signature (biasanya "tidak ditemukan").
  async ping(): Promise<{ ok: boolean; message: string }> {
    if (!this.configured) return { ok: false, message: "Client ID dan Secret Key wajib diisi." };
    const label = this.mode === "sandbox" ? "Sandbox" : "Production";
    let r: Awaited<ReturnType<DokuProvider["call"]>>;
    try {
      r = await this.call("GET", `/orders/v1/status/PING${Date.now()}`);
    } catch (err) {
      return { ok: false, message: `Tidak bisa menghubungi DOKU: ${err instanceof Error ? err.message : String(err)}` };
    }
    // Kode "invalid_client_id" terbukti dari probe API sandbox (10 Okt 2026).
    // Selain itu belum terbukti, jadi hanya 200/404 (invoice tidak ada) yang
    // dianggap lulus; sisanya ditampilkan apa adanya.
    const code = errorCode(r.json);
    const msg = errorText(r.json, r.text);
    if (code === "invalid_client_id")
      return { ok: false, message: `Client ID tidak dikenal di DOKU ${label}. Cek ejaan, atau Mode Sandbox/Production tertukar.` };
    if (/signature/i.test(code) || /signature/i.test(msg) || r.status === 401)
      return { ok: false, message: "Client ID dikenal, tapi Secret Key salah. Salin ulang Active Secret Key dari Back Office DOKU." };
    if (r.status >= 500) return { ok: false, message: `Server DOKU sedang gangguan (${r.status}). Coba lagi nanti.` };
    if (r.status === 200 || r.status === 404 || /not.?found/i.test(code) || /not.?found/i.test(msg))
      return { ok: true, message: `Terhubung ke DOKU ${label}. Client ID dan Secret Key cocok.` };
    return { ok: false, message: `Jawaban DOKU tidak dikenali (${r.status}): ${msg}` };
  }
}
