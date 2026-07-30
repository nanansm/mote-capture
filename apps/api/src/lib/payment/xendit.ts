// Ported from apps/cloud/lib/payment/providers/xendit.ts. Functional port —
// same QR-create / webhook-verify / ping behavior — with two changes forced
// by the Workers runtime:
//
//   1. No Node's built-in crypto module / `Buffer`: `randomUUID()` -> Web
//      Crypto's global `crypto.randomUUID()`; `Buffer.from(x).toString("base64")`
//      -> `btoa(x)`.
//   2. No process-level env var lookup / module-level `env` import:
//      credentials are passed into the constructor by the factory
//      (`./index.ts`), which is the only place that reads them off the
//      `Bindings` object.
//
// `apps/cloud/lib/env.ts` also exposed `XENDIT_QR_AMOUNT_CURRENCY`, but that
// var never made it into `apps/api/src/lib/env.ts` (Bindings/Secrets) — this
// product only ever charges IDR QRIS, so it's hardcoded below instead of
// threading a new binding through for a value that never varies.
import { logger } from "@/lib/logger";
import type {
  CreateQRParams,
  CreateQRResult,
  PaymentProvider,
  VerifyWebhookParams,
  VerifyWebhookResult,
} from "./types";

const XENDIT_BASE_URL = "https://api.xendit.co";
const XENDIT_QR_CURRENCY = "IDR";

function basicAuth(secretKey: string): string {
  return "Basic " + btoa(`${secretKey}:`);
}

export type XenditCredentials = {
  secretKey?: string;
  webhookToken?: string;
};

export class XenditProvider implements PaymentProvider {
  readonly name = "xendit";
  private readonly secretKey?: string;
  private readonly webhookToken?: string;

  constructor(credentials: XenditCredentials) {
    this.secretKey = credentials.secretKey;
    this.webhookToken = credentials.webhookToken;
  }

  private get configured(): boolean {
    return Boolean(this.secretKey);
  }

  async createQR(params: CreateQRParams): Promise<CreateQRResult> {
    const expiresInMinutes = params.expiresInMinutes ?? 15;
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60_000);

    if (!this.configured) {
      const mockRef = `MOCK_QR_${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const mockString = `MOCK_${params.sessionId}_${params.amount}_${Date.now()}`;
      logger.warn("xendit_mock_create_qr", { sessionId: params.sessionId, amount: params.amount });
      return {
        providerRef: mockRef,
        qrString: mockString,
        expiresAt,
        rawResponse: { mock: true },
        mockMode: true,
      };
    }

    const body = {
      reference_id: params.sessionId,
      type: "DYNAMIC",
      currency: XENDIT_QR_CURRENCY,
      amount: params.amount,
      expires_at: expiresAt.toISOString(),
    };

    const res = await fetch(`${XENDIT_BASE_URL}/qr_codes`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: basicAuth(this.secretKey!),
        "api-version": "2022-07-31",
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // leave json empty
    }

    if (!res.ok) {
      logger.error("xendit_create_qr_failed", { status: res.status, body: text.slice(0, 500) });
      throw new Error(
        `Xendit QR create failed (${res.status}): ${typeof json.message === "string" ? json.message : text.slice(0, 200)}`,
      );
    }

    const id = typeof json.id === "string" ? json.id : "";
    const qrString = typeof json.qr_string === "string" ? json.qr_string : "";
    if (!id || !qrString) {
      throw new Error("Xendit response missing id/qr_string");
    }

    return {
      providerRef: id,
      qrString,
      expiresAt,
      rawResponse: json,
    };
  }

  async verifyWebhook(params: VerifyWebhookParams): Promise<VerifyWebhookResult> {
    const expected = this.webhookToken;
    if (!expected) {
      return { valid: false, reason: "XENDIT_WEBHOOK_TOKEN not configured" };
    }
    const got = params.headers["x-callback-token"] ?? params.headers["X-Callback-Token"] ?? "";
    if (!got || got.length !== expected.length) {
      return { valid: false, reason: "missing or invalid token" };
    }
    // constant-time compare
    let mismatch = 0;
    for (let i = 0; i < expected.length; i++) {
      mismatch |= got.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    if (mismatch !== 0) {
      return { valid: false, reason: "token mismatch" };
    }

    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(params.body) as Record<string, unknown>;
    } catch {
      return { valid: false, reason: "invalid JSON body" };
    }

    // Xendit QR webhook payload shape:
    // {
    //   "event": "qr.payment",
    //   "data": { "reference_id": "...", "amount": 30000, "status": "SUCCEEDED", "qr_id": "qr_..." }
    // }
    const dataRaw = payload.data as Record<string, unknown> | undefined;
    const eventRaw = typeof payload.event === "string" ? payload.event : "";
    const sessionRef =
      typeof dataRaw?.reference_id === "string" ? dataRaw.reference_id : undefined;
    const amount = typeof dataRaw?.amount === "number" ? dataRaw.amount : undefined;
    const statusRaw =
      typeof dataRaw?.status === "string" ? dataRaw.status.toLowerCase() : "";

    let event: VerifyWebhookResult["event"] | undefined;
    if (eventRaw === "qr.payment" || statusRaw === "succeeded" || statusRaw === "paid") {
      event = "paid";
    } else if (statusRaw === "expired") {
      event = "expired";
    } else if (statusRaw === "failed") {
      event = "failed";
    }

    return {
      valid: true,
      event,
      sessionRef,
      amount,
      rawPayload: payload,
    };
  }

  async ping(): Promise<{ ok: boolean; message: string }> {
    if (!this.configured) {
      return { ok: false, message: "Xendit secret key belum di-set (mock mode aktif)" };
    }
    try {
      const res = await fetch(`${XENDIT_BASE_URL}/balance`, {
        headers: { authorization: basicAuth(this.secretKey!) },
      });
      if (!res.ok) {
        const text = await res.text();
        return { ok: false, message: `Xendit responded ${res.status}: ${text.slice(0, 120)}` };
      }
      return { ok: true, message: "Xendit credentials valid" };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "Unknown error" };
    }
  }
}
