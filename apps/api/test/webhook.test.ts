import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getSessionRow, seedBooth, seedSession, uid } from "./helpers";

// U3 (PRD bagian 13): webhook PAID setelah expired -> voucher auto-late-payment, 200.

const TOKEN = "test-webhook-token";

const paidWebhook = (sessionId: string, amount = 30000, token = TOKEN) =>
  SELF.fetch("https://capture.test/api/webhook/xendit", {
    method: "POST",
    headers: { "content-type": "application/json", "x-callback-token": token },
    body: JSON.stringify({
      event: "qr.payment",
      data: { reference_id: sessionId, amount, status: "SUCCEEDED", qr_id: `qr_${sessionId}` },
    }),
  });

const autoVouchers = (sessionId: string) =>
  env.DB.prepare(
    "SELECT code, type, value, \"limit\", status, source, created_by, expires_at FROM vouchers WHERE source_session_id = ?",
  )
    .bind(sessionId)
    .all<Record<string, unknown>>()
    .then((r) => r.results);

const logs = (sessionId: string) =>
  env.DB.prepare("SELECT event_type FROM payment_logs WHERE session_id = ? ORDER BY id")
    .bind(sessionId)
    .all<{ event_type: string }>()
    .then((r) => r.results.map((x) => x.event_type));

describe("U3 webhook PAID setelah expired", () => {
  it("expired + PAID: 200, voucher auto-late-payment senilai sesi, status tetap expired", async () => {
    const boothId = await seedBooth({ id: uid("BTH") });
    const sessionId = await seedSession({ boothId, status: "expired", amount: 30000 });

    const res = await paidWebhook(sessionId);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, latePayment: true });

    const v = await autoVouchers(sessionId);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({
      type: "payment",
      value: 30000,
      limit: 1,
      status: "active",
      source: "auto-late-payment",
      created_by: "system:auto-late-payment",
      expires_at: null,
    });
    expect(String(v[0]!.code)).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect((await getSessionRow(sessionId))?.status).toBe("expired");
    expect(await logs(sessionId)).toContain("late_payment_voucher");
  });

  it("webhook diulang Xendit: tetap satu voucher", async () => {
    const boothId = await seedBooth({ id: uid("BTH") });
    const sessionId = await seedSession({ boothId, status: "expired" });
    for (let i = 0; i < 3; i++) expect((await paidWebhook(sessionId)).status).toBe(200);
    expect(await autoVouchers(sessionId)).toHaveLength(1);
    expect(await logs(sessionId)).toEqual([
      "late_payment_voucher",
      "late_payment_duplicate",
      "late_payment_duplicate",
    ]);
  });

  it("sesi payment + PAID: jalur normal, sesi paid, tanpa voucher", async () => {
    const boothId = await seedBooth({ id: uid("BTH") });
    const sessionId = await seedSession({ boothId, status: "payment" });
    expect((await paidWebhook(sessionId)).status).toBe(200);
    expect((await getSessionRow(sessionId))?.status).toBe("paid");
    expect(await autoVouchers(sessionId)).toHaveLength(0);
  });

  it("sesi failed yang pernah dibayar (reset admin): tanpa voucher", async () => {
    const boothId = await seedBooth({ id: uid("BTH") });
    const sessionId = await seedSession({ boothId, status: "failed", paidAt: Date.now() - 60_000 });
    expect((await paidWebhook(sessionId)).status).toBe(200);
    expect(await autoVouchers(sessionId)).toHaveLength(0);
  });

  it("token salah: 401, tanpa voucher", async () => {
    const boothId = await seedBooth({ id: uid("BTH") });
    const sessionId = await seedSession({ boothId, status: "expired" });
    expect((await paidWebhook(sessionId, 30000, "x".repeat(TOKEN.length))).status).toBe(401);
    expect(await autoVouchers(sessionId)).toHaveLength(0);
  });

  it("voucher terlambat bisa ditukar di sesi berikutnya", async () => {
    const boothId = await seedBooth({ id: uid("BTH") });
    const lateId = await seedSession({ boothId, status: "expired" });
    await paidWebhook(lateId);
    const [v] = await autoVouchers(lateId);
    const next = await seedSession({ boothId, status: "payment", paymentRef: null });
    const res = await SELF.fetch("https://capture.test/api/voucher/redeem", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: v!.code, sessionId: next }),
    });
    expect(res.status).toBe(200);
    expect((await getSessionRow(next))?.status).toBe("paid");
  });
});
