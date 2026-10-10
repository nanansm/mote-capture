import { env, SELF } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { encryptSecret } from "@/lib/secret-box";
import {
  ipaymuCallbackString,
  ipaymuRequestSignature,
  verifyIpaymuCallbackSignature,
  IpaymuProvider,
} from "@/lib/payment/ipaymu";
import { getSessionRow, seedBooth, seedSession, uid } from "./helpers";

const VA = "1179000899";
const KEY = "KEY-TEST.abc";

// Vektor dihitung terpisah dengan Python hmac/hashlib (bukan kode ini),
// mengikuti rumus dok resmi iPaymu.
describe("iPaymu signature", () => {
  it("request signature = HMAC(POST:VA:sha256(body):KEY, KEY)", async () => {
    const body = JSON.stringify({ transactionId: 123, account: VA });
    expect(await ipaymuRequestSignature("POST", VA, KEY, body)).toBe(
      "6a517e64c24488dd2b9fb5a6f6ca97b7734a912c47e65f7b7be11091b0032f77",
    );
  });

  it("callback: ksort + escape slash + HMAC dengan VA", async () => {
    const cb = {
      trx_id: 193205,
      status: "berhasil",
      status_code: 1,
      reference_id: "SES-1",
      url: "https://a/b",
      is_escrow: false,
      paid_off: 150000,
      additional_info: [],
    };
    const sig = "837d15da471aabfd4f20b5cf361d0f5fdbea5036538ff06f3f35266a4bf911c9";
    expect(ipaymuCallbackString(cb)).toBe(
      '{"additional_info":[],"is_escrow":false,"paid_off":150000,"reference_id":"SES-1","status":"berhasil","status_code":1,"trx_id":193205,"url":"https:\\/\\/a\\/b"}',
    );
    expect(await verifyIpaymuCallbackSignature({ ...cb, signature: sig }, sig, VA)).toBe(true);
    // Versi form-urlencoded (semua string) tetap cocok setelah normalisasi.
    const form = {
      trx_id: "193205",
      status: "berhasil",
      status_code: "1",
      reference_id: "SES-1",
      url: "https://a/b",
      is_escrow: "false",
      paid_off: "150000",
      additional_info: "[]",
    };
    expect(await verifyIpaymuCallbackSignature(form, sig, VA)).toBe(true);
    expect(await verifyIpaymuCallbackSignature(cb, sig, "999")).toBe(false);
  });

  it("tanpa kredensial = mock mode, tidak memanggil jaringan", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const qr = await new IpaymuProvider({}).createQR({ sessionId: "S1", amount: 1000 });
    expect(qr.mockMode).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("createQR mengirim channel mpm + MERCHANT dan membaca QrString", async () => {
    let sent: { url: string; headers: Headers; body: Record<string, unknown> } | null = null;
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      sent = {
        url: String(input),
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      };
      return Response.json({ Status: 200, Data: { TransactionId: 777, QrString: "000201QR", Expired: "x" } });
    });
    const p = new IpaymuProvider({ va: VA, apiKey: KEY, mode: "sandbox", notifyUrl: "https://x/api/webhook/ipaymu" });
    const qr = await p.createQR({ sessionId: "SES-9", amount: 30000 });
    spy.mockRestore();
    expect(qr).toMatchObject({ providerRef: "777", qrString: "000201QR" });
    expect(sent!.url).toBe("https://sandbox.ipaymu.com/api/v2/payment/direct");
    expect(sent!.body).toMatchObject({
      paymentMethod: "qris",
      paymentChannel: "mpm",
      feeDirection: "MERCHANT",
      referenceId: "SES-9",
      amount: 30000,
    });
    expect(sent!.headers.get("va")).toBe(VA);
    expect(sent!.headers.get("signature")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("createQR gagal = error jelas, bukan QR kosong", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ Status: 401, Message: "unauthorized signature" }, { status: 401 }));
    const p = new IpaymuProvider({ va: VA, apiKey: KEY, notifyUrl: "https://x" });
    await expect(p.createQR({ sessionId: "S", amount: 1000 })).rejects.toThrow(/unauthorized signature/);
    spy.mockRestore();
  });
});

describe("POST /api/webhook/ipaymu", () => {
  beforeAll(async () => {
    const pass = env.SETTINGS_ENC_KEY as string;
    const db = getDb(env.DB);
    await setSetting(db, "credentials", {
      xendit_secret_key: "",
      xendit_webhook_token: "",
      evolution_api_url: "",
      evolution_api_key: "",
      evolution_instance_name: "",
      ipaymu_va: await encryptSecret(VA, pass),
      ipaymu_api_key: await encryptSecret(KEY, pass),
      ipaymu_mode: await encryptSecret("sandbox", pass),
    });
    invalidateSettingsCache();
  });

  afterEach(() => vi.restoreAllMocks());

  async function seedIpaymuSession(status = "payment", trxId = "5001", amount = 30000) {
    const boothId = await seedBooth({ id: uid("BTH") });
    const sessionId = await seedSession({ boothId, status, amount, paymentRef: trxId });
    await env.DB.prepare("UPDATE sessions SET payment_provider = 'ipaymu' WHERE id = ?").bind(sessionId).run();
    return sessionId;
  }

  function mockCheck(data: Record<string, unknown>) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      expect(String(input)).toBe("https://sandbox.ipaymu.com/api/v2/transaction");
      return Response.json({ Status: 200, Success: true, Data: data });
    });
  }

  const callback = (body: Record<string, string>) =>
    SELF.fetch("https://capture.test/api/webhook/ipaymu", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    });

  it("lunas hanya kalau Check Transaction bilang Status 1", async () => {
    const sid = await seedIpaymuSession();
    const spy = mockCheck({ TransactionId: 5001, ReferenceId: sid, Status: 1, Amount: 30000 });
    const res = await callback({ trx_id: "5001", status: "berhasil", status_code: "1", reference_id: sid });
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    const row = await getSessionRow(sid);
    expect(["paid", "capturing"]).toContain(row?.status);
  });

  it("callback palsu 'berhasil' tapi API bilang pending: sesi tetap menunggu", async () => {
    const sid = await seedIpaymuSession();
    mockCheck({ TransactionId: 5001, ReferenceId: sid, Status: 0, Amount: 30000 });
    const res = await callback({ trx_id: "5001", status: "berhasil", status_code: "1", reference_id: sid });
    expect(res.status).toBe(200);
    expect((await getSessionRow(sid))?.status).toBe("payment");
  });

  it("trx_id beda dengan QR sesi ditolak (reference_mismatch)", async () => {
    const sid = await seedIpaymuSession("payment", "5001");
    mockCheck({ TransactionId: 9999, ReferenceId: sid, Status: 1, Amount: 30000 });
    const res = await callback({ trx_id: "9999", status: "berhasil", reference_id: sid });
    expect(await res.json()).toMatchObject({ message: "reference mismatch" });
    expect((await getSessionRow(sid))?.status).toBe("payment");
  });

  it("nominal kurang ditolak (amount_mismatch)", async () => {
    const sid = await seedIpaymuSession("payment", "5002", 30000);
    mockCheck({ TransactionId: 5002, ReferenceId: sid, Status: 1, Amount: 1000 });
    const res = await callback({ trx_id: "5002", reference_id: sid });
    expect(await res.json()).toMatchObject({ message: "amount mismatch" });
    expect((await getSessionRow(sid))?.status).toBe("payment");
  });

  it("API iPaymu gangguan = 400 supaya iPaymu mengulang", async () => {
    const sid = await seedIpaymuSession();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("bad gateway", { status: 502 }));
    const res = await callback({ trx_id: "5001", reference_id: sid });
    expect(res.status).toBe(400);
    expect((await getSessionRow(sid))?.status).toBe("payment");
  });

  it("jaringan ke iPaymu putus = 400, bukan 500", async () => {
    const sid = await seedIpaymuSession();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new TypeError("network down");
    });
    const res = await callback({ trx_id: "5001", reference_id: sid });
    expect(res.status).toBe(400);
  });

  it("bayar setelah sesi expired = voucher otomatis", async () => {
    const sid = await seedIpaymuSession("expired", "5003");
    mockCheck({ TransactionId: 5003, ReferenceId: sid, Status: 1, Amount: 30000 });
    const res = await callback({ trx_id: "5003", reference_id: sid });
    expect(await res.json()).toMatchObject({ latePayment: true });
  });
});
