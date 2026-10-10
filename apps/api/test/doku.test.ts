import { SELF } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  DokuProvider,
  dokuInvoice,
  dokuSessionId,
  dokuSignature,
  dokuTimestamp,
} from "@/lib/payment/doku";
import { getSessionRow, seedBooth, seedPaymentAccount, seedSession } from "./helpers";

const CID = "MCH-0001-10791114622547";
const SK = "SK-TEST";

// Vektor dihitung terpisah dengan Python hmac/hashlib (bukan kode ini),
// mengikuti rumus dok resmi DOKU (Signature non-SNAP).
describe("DOKU signature", () => {
  it("POST: Client-Id/Request-Id/Request-Timestamp/Request-Target/Digest", async () => {
    const body = '{"order":{"invoice_number":"INV1","amount":1000}}';
    expect(
      await dokuSignature({
        clientId: CID,
        requestId: "cc682442-6c22-493e-8121-b9ef6b3fa728",
        timestamp: "2020-08-11T08:45:42Z",
        target: "/checkout/v1/payment",
        secretKey: SK,
        body,
      }),
    ).toBe("HMACSHA256=8rZww6yU4g1Wbdt8O2OVhrABVjteP8s8jGAsg2CqzD4=");
  });

  it("GET: tanpa Digest", async () => {
    expect(
      await dokuSignature({
        clientId: CID,
        requestId: "rid-1",
        timestamp: "2020-08-11T08:45:42Z",
        target: "/orders/v1/status/INV1",
        secretKey: SK,
      }),
    ).toBe("HMACSHA256=24UbFMorTrFKC8LstaTUQsGraKDwndw0bNviBTKLiPY=");
  });

  it("timestamp tanpa milidetik, invoice tanpa simbol, bolak-balik ke id sesi", () => {
    expect(dokuTimestamp(new Date("2026-10-10T01:02:03.456Z"))).toBe("2026-10-10T01:02:03Z");
    expect(dokuInvoice("SES-AB12CD34EF")).toBe("SESAB12CD34EF");
    expect(dokuSessionId("SESAB12CD34EF")).toBe("SES-AB12CD34EF");
    expect(dokuSessionId("LAIN123")).toBe("LAIN123");
  });
});

describe("DokuProvider", () => {
  afterEach(() => vi.restoreAllMocks());

  it("createQR: QRIS saja, due date = timeout kiosk, baca payment.url", async () => {
    let sent: { url: string; headers: Headers; body: Record<string, any> } | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      sent = { url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) };
      return Response.json({
        message: ["SUCCESS"],
        response: { payment: { url: "https://sandbox.doku.com/checkout-link-v2/abc123", token_id: "tok" } },
      });
    });
    const p = new DokuProvider({ clientId: CID, secretKey: SK, mode: "sandbox" });
    const qr = await p.createQR({ sessionId: "SES-AB12CD34EF", amount: 30000, expiresInMinutes: 1 });
    expect(qr).toMatchObject({ providerRef: "SESAB12CD34EF", paymentUrl: "https://sandbox.doku.com/checkout-link-v2/abc123", qrString: "" });
    expect(sent!.url).toBe("https://api-sandbox.doku.com/checkout/v1/payment");
    expect(sent!.body.order).toMatchObject({ amount: 30000, invoice_number: "SESAB12CD34EF", currency: "IDR" });
    expect(sent!.body.payment).toEqual({ payment_due_date: 1, payment_method_types: ["QRIS"] });
    expect(sent!.headers.get("client-id")).toBe(CID);
    expect(sent!.headers.get("signature")).toMatch(/^HMACSHA256=/);
    expect(sent!.headers.get("request-timestamp")).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  });

  it("production memakai api.doku.com", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ response: { payment: { url: "https://jokul.doku.com/checkout-link-v2/x" } } }),
    );
    await new DokuProvider({ clientId: CID, secretKey: SK }).createQR({ sessionId: "SES-1", amount: 1000 });
    expect(String(spy.mock.calls[0]![0])).toBe("https://api.doku.com/checkout/v1/payment");
  });

  it("createQR gagal = error jelas", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ error: { code: "invalid_client_id", message: "Invalid Client-Id" } }, { status: 400 }),
    );
    const p = new DokuProvider({ clientId: CID, secretKey: SK, mode: "sandbox" });
    await expect(p.createQR({ sessionId: "SES-1", amount: 1000 })).rejects.toThrow(/Invalid Client-Id/);
  });

  it("URL bayar bukan domain DOKU ditolak", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ response: { payment: { url: "https://evil.example/x" } } }));
    const p = new DokuProvider({ clientId: CID, secretKey: SK, mode: "sandbox" });
    await expect(p.createQR({ sessionId: "SES-1", amount: 1000 })).rejects.toThrow(/tidak dikenal/);
  });

  it("ping: Client ID salah / Secret salah / cocok", async () => {
    const p = new DokuProvider({ clientId: CID, secretKey: SK, mode: "sandbox" });
    const spy = vi.spyOn(globalThis, "fetch");
    spy.mockResolvedValueOnce(Response.json({ error: { code: "invalid_client_id", message: "Invalid Client-Id" } }, { status: 400 }));
    expect((await p.ping()).message).toMatch(/Client ID tidak dikenal/);
    spy.mockResolvedValueOnce(Response.json({ error: { code: "invalid_signature", message: "Invalid Signature" } }, { status: 400 }));
    expect((await p.ping()).message).toMatch(/Secret Key salah/);
    spy.mockResolvedValueOnce(Response.json({ error: { code: "not_found", message: "Order not found" } }, { status: 404 }));
    expect(await p.ping()).toMatchObject({ ok: true });
    spy.mockResolvedValueOnce(new Response("x", { status: 503 }));
    expect((await p.ping()).message).toMatch(/gangguan/);
  });
});

describe("POST /api/webhook/doku/:accountId", () => {
  const ACC = "PAY-DOKU-A";
  const PATH = `/api/webhook/doku/${ACC}`;
  let n = 0;
  beforeAll(async () => {
    await seedPaymentAccount({ id: ACC, provider: "doku", mode: "sandbox", secrets: { clientId: CID, dokuSecretKey: SK } });
  });
  afterEach(() => vi.restoreAllMocks());

  const newSid = () => `SES-${(Date.now().toString(36) + (n++).toString(36)).toUpperCase().padStart(10, "0").slice(-10)}`;

  async function seedDoku(status = "payment", amount = 30000) {
    const boothId = await seedBooth();
    const sid = newSid();
    await seedSession({ id: sid, boothId, status, amount, paymentRef: dokuInvoice(sid), provider: "doku", accountId: ACC });
    return sid;
  }

  const payload = (invoice: string, status = "SUCCESS", amount = 30000) => ({
    order: { invoice_number: invoice, amount },
    transaction: { status, date: "2026-10-10T01:00:00Z", original_request_id: "x" },
    channel: { id: "QRIS" },
  });

  async function notify(body: unknown, opts: { key?: string; path?: string; clientId?: string } = {}) {
    const raw = JSON.stringify(body);
    const requestId = crypto.randomUUID();
    const timestamp = dokuTimestamp();
    const path = opts.path ?? PATH;
    const signature = await dokuSignature({
      clientId: opts.clientId ?? CID,
      requestId,
      timestamp,
      target: path,
      secretKey: opts.key ?? SK,
      body: raw,
    });
    return SELF.fetch(`https://capture.test${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Client-Id": opts.clientId ?? CID,
        "Request-Id": requestId,
        "Request-Timestamp": timestamp,
        Signature: signature,
      },
      body: raw,
    });
  }

  function mockStatus(invoice: string, status: string, amount = 30000) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      expect(String(input)).toBe(`https://api-sandbox.doku.com/orders/v1/status/${invoice}`);
      return Response.json(payload(invoice, status, amount));
    });
  }

  it("signature cocok + Check Status SUCCESS = lunas", async () => {
    const sid = await seedDoku();
    const spy = mockStatus(dokuInvoice(sid), "SUCCESS");
    const res = await notify(payload(dokuInvoice(sid)));
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(["paid", "capturing"]).toContain((await getSessionRow(sid))?.status);
  });

  it("signature salah = 401, sesi tidak berubah", async () => {
    const sid = await seedDoku();
    const spy = vi.spyOn(globalThis, "fetch");
    const res = await notify(payload(dokuInvoice(sid)), { key: "SK-SALAH" });
    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
    expect((await getSessionRow(sid))?.status).toBe("payment");
  });

  it("Client-Id lain = 401", async () => {
    const sid = await seedDoku();
    const res = await notify(payload(dokuInvoice(sid)), { clientId: "BRN-0001-999" });
    expect(res.status).toBe(401);
  });

  it("notifikasi SUCCESS tapi Check Status PENDING: sesi tetap menunggu", async () => {
    const sid = await seedDoku();
    mockStatus(dokuInvoice(sid), "PENDING");
    const res = await notify(payload(dokuInvoice(sid)));
    expect(res.status).toBe(200);
    expect((await getSessionRow(sid))?.status).toBe("payment");
  });

  it("API DOKU gangguan: notifikasi bertanda tangan sah tetap dipakai", async () => {
    const sid = await seedDoku();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("bad gateway", { status: 502 }));
    const res = await notify(payload(dokuInvoice(sid)));
    expect(res.status).toBe(200);
    expect(["paid", "capturing"]).toContain((await getSessionRow(sid))?.status);
  });

  it("nominal kurang ditolak", async () => {
    const sid = await seedDoku("payment", 30000);
    mockStatus(dokuInvoice(sid), "SUCCESS", 1000);
    const res = await notify(payload(dokuInvoice(sid), "SUCCESS", 1000));
    expect(await res.json()).toMatchObject({ message: "amount mismatch" });
    expect((await getSessionRow(sid))?.status).toBe("payment");
  });

  it("EXPIRED menutup sesi yang masih menunggu", async () => {
    const sid = await seedDoku();
    mockStatus(dokuInvoice(sid), "EXPIRED");
    await notify(payload(dokuInvoice(sid), "EXPIRED"));
    expect((await getSessionRow(sid))?.status).not.toBe("payment");
  });

  it("bayar setelah sesi expired = voucher otomatis", async () => {
    const sid = await seedDoku("expired");
    mockStatus(dokuInvoice(sid), "SUCCESS");
    const res = await notify(payload(dokuInvoice(sid)));
    expect(await res.json()).toMatchObject({ latePayment: true });
  });

  it("akun DOKU lain tidak bisa melunasi sesi akun A", async () => {
    const other = await seedPaymentAccount({ provider: "doku", mode: "sandbox", secrets: { clientId: CID, dokuSecretKey: "SK-B" } });
    const sid = await seedDoku();
    mockStatus(dokuInvoice(sid), "SUCCESS");
    const res = await notify(payload(dokuInvoice(sid)), { key: "SK-B", path: `/api/webhook/doku/${other}` });
    expect(await res.json()).toMatchObject({ message: "account mismatch" });
    expect((await getSessionRow(sid))?.status).toBe("payment");
  });

  it("akun bukan DOKU di URL DOKU = 401", async () => {
    const x = await seedPaymentAccount({ provider: "ipaymu", secrets: { va: "1", apiKey: "k" } });
    const res = await notify({}, { path: `/api/webhook/doku/${x}` });
    expect(res.status).toBe(401);
  });
});
