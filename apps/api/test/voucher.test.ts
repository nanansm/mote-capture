import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { REDEEM_LIMITS } from "@capture/shared";
import { getSessionRow, seedBooth, seedSession, uid } from "./helpers";

// U1 + U2 (PRD bagian 13). Tiap test pakai booth sendiri supaya penghitung
// rate limit di storage BoothDO tidak bocor antar test.

async function seedVoucher(over: { code?: string; type?: "payment" | "discount"; value?: number; limit?: number } = {}) {
  const id = uid("VCH");
  const code = over.code ?? id.replace(/[^A-Z0-9]/gi, "").slice(-8).toUpperCase();
  await env.DB.prepare(
    `INSERT INTO vouchers (id, code, type, value, "limit") VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(id, code, over.type ?? "payment", over.value ?? 30000, over.limit ?? 1)
    .run();
  return { id, code };
}

const voucherRow = (id: string) =>
  env.DB.prepare("SELECT status, used_count FROM vouchers WHERE id = ?").bind(id).first<{ status: string; used_count: number }>();

const redeem = (body: Record<string, unknown>) =>
  SELF.fetch("https://capture.test/api/voucher/redeem", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("U1 voucher menutup penuh vs diskon", () => {
  it("voucher penuh: 200, sesi paid, voucher used", async () => {
    const boothId = await seedBooth({ id: uid("BTH") });
    const sessionId = await seedSession({ boothId, paymentRef: null });
    const v = await seedVoucher({ value: 30000 });

    const res = await redeem({ code: v.code, sessionId, boothId });
    expect(res.status).toBe(200);
    expect((await getSessionRow(sessionId))?.status).toBe("paid");
    expect(await voucherRow(v.id)).toEqual({ status: "used", used_count: 1 });
  });

  it("diskon 100% dihitung penuh", async () => {
    const boothId = await seedBooth({ id: uid("BTH") });
    const sessionId = await seedSession({ boothId, paymentRef: null });
    const v = await seedVoucher({ type: "discount", value: 100 });
    expect((await redeem({ code: v.code, sessionId })).status).toBe(200);
    expect((await getSessionRow(sessionId))?.status).toBe("paid");
  });

  it("finalAmount > 0: 400, markPaid tidak jalan, kuota utuh", async () => {
    const boothId = await seedBooth({ id: uid("BTH") });
    const sessionId = await seedSession({ boothId, paymentRef: null });
    const pct = await seedVoucher({ type: "discount", value: 50 });
    const nominal = await seedVoucher({ type: "payment", value: 10000 });

    for (const v of [pct, nominal]) {
      const res = await redeem({ code: v.code, sessionId });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; message: string };
      expect(body.error).toBe("VOUCHER_NOT_FULL_COVER");
      expect(body.message.toLowerCase()).toBe("voucher tidak berlaku di booth");
      expect(await voucherRow(v.id)).toEqual({ status: "active", used_count: 0 });
    }
    expect((await getSessionRow(sessionId))?.status).toBe("payment");
  });

  it("sesi bukan payment: ditolak, kuota utuh", async () => {
    const boothId = await seedBooth({ id: uid("BTH") });
    const sessionId = await seedSession({ boothId, status: "idle", paymentRef: null });
    const v = await seedVoucher();
    expect((await redeem({ code: v.code, sessionId })).status).toBe(400);
    expect(await voucherRow(v.id)).toEqual({ status: "active", used_count: 0 });
  });

  it("boothId palsu di body diabaikan, DO booth asli yang dipakai", async () => {
    const boothId = await seedBooth({ id: uid("BTH") });
    const sessionId = await seedSession({ boothId, paymentRef: null });
    const v = await seedVoucher();
    expect((await redeem({ code: v.code, sessionId, boothId: "BTH-LAIN" })).status).toBe(200);
    expect((await getSessionRow(sessionId))?.status).toBe("paid");
  });

  it("voucher kedua untuk sesi yang sudah paid: kuota tidak dipotong", async () => {
    const boothId = await seedBooth({ id: uid("BTH") });
    const sessionId = await seedSession({ boothId, paymentRef: null });
    const a = await seedVoucher();
    const b = await seedVoucher();
    expect((await redeem({ code: a.code, sessionId })).status).toBe(200);
    expect((await redeem({ code: b.code, sessionId })).status).toBe(400);
    expect(await voucherRow(b.id)).toEqual({ status: "active", used_count: 0 });
  });
});

describe("U2 rate limit /redeem", () => {
  it(`percobaan ke-${REDEEM_LIMITS.PER_SESSION + 1} dalam satu sesi: 429`, async () => {
    const boothId = await seedBooth({ id: uid("BTH") });
    const sessionId = await seedSession({ boothId, paymentRef: null });
    for (let i = 0; i < REDEEM_LIMITS.PER_SESSION; i++) {
      expect((await redeem({ code: `SALAH${i}XX`, sessionId })).status).toBe(404);
    }
    const res = await redeem({ code: "SALAH9XX", sessionId });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(((await res.json()) as { scope: string }).scope).toBe("session");

    // Kode benar pun ditolak selama terkunci: brute force tidak bisa lolos.
    const v = await seedVoucher();
    expect((await redeem({ code: v.code, sessionId })).status).toBe(429);
    expect(await voucherRow(v.id)).toEqual({ status: "active", used_count: 0 });
  });

  it(`percobaan ke-${REDEEM_LIMITS.PER_BOOTH + 1} per booth: 429`, async () => {
    const boothId = await seedBooth({ id: uid("BTH") });
    const perSession = REDEEM_LIMITS.PER_SESSION;
    const sessions = Math.ceil(REDEEM_LIMITS.PER_BOOTH / perSession);
    let n = 0;
    for (let s = 0; s < sessions; s++) {
      const sessionId = await seedSession({ boothId, paymentRef: null });
      for (let i = 0; i < perSession && n < REDEEM_LIMITS.PER_BOOTH; i++, n++) {
        expect((await redeem({ code: `X${s}Y${i}ZZZ`, sessionId })).status).toBe(404);
      }
    }
    const fresh = await seedSession({ boothId, paymentRef: null });
    const res = await redeem({ code: "ZZZZZZZZ", sessionId: fresh });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { scope: string }).scope).toBe("booth");
  });

  it("jendela geser: setelah 10 menit penghitung pulih", async () => {
    const boothId = await seedBooth({ id: uid("BTH") });
    const stub = env.BOOTH_DO.get(env.BOOTH_DO.idFromName(boothId));
    const t0 = 1_000_000;
    for (let i = 0; i < REDEEM_LIMITS.PER_SESSION; i++) {
      expect((await stub.checkRedeemAttempt(boothId, "S", t0 + i)).ok).toBe(true);
    }
    expect((await stub.checkRedeemAttempt(boothId, "S", t0 + 10)).ok).toBe(false);
    const later = await stub.checkRedeemAttempt(boothId, "S", t0 + REDEEM_LIMITS.WINDOW_MS + 10);
    expect(later.ok).toBe(true);
  });
});
