// Ported from apps/cloud/app/api/webhook/xendit/route.ts (Next.js route
// handler -> Hono sub-router). PUBLIC endpoint — authenticated only via the
// `x-callback-token` header Xendit sends on every callback, verified inside
// `XenditProvider.verifyWebhook` before anything in the body is trusted.
//
// Architecture change from the old app (see @/do/rpc.ts header comment):
// BoothDO is now the sole writer of `sessions`/`photos`, so this route never
// runs `db.update(schema.sessions)` — it only *reads* `sessions` (to resolve
// `boothId` and validate the session exists) and *writes* the append-only
// `payment_logs` table, then hands the state transition off to the
// `markPaid` / `markExpired` RPC stubs. The old Socket.io `emitToBooth` /
// `emitToAdmin` calls are dropped entirely: that's now BoothDO's job once
// its real implementation lands (T3.2/T3.3), triggered by the RPC call.
//
// `markExpired` is the only "not paid" RPC the DO exposes today, so both the
// old "expired" and "failed" webhook events map onto it here (rpc.ts has no
// separate markFailed) — see apps/api/src/do/rpc.ts.
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import type { Bindings } from "@/lib/env";
import { getDb, schema } from "@/db";
import { logger } from "@/lib/logger";
import type { VerifyWebhookResult } from "@/lib/payment";
import { parseIpaymuBody } from "@/lib/payment/ipaymu";
import { loadAccount, loadAccountsByProvider, type LoadedAccount } from "@/lib/payment-accounts";
import { markExpired, markPaid } from "@/do/rpc";
import { isLatePayment, recordLatePayment } from "@/lib/auto-voucher";

const webhook = new Hono<{ Bindings: Bindings }>();

const PAID_TERMINAL_STATUSES = new Set(["paid", "capturing", "processing", "done", "abandoned_paid", "stale"]);

type ProviderName = "xendit" | "ipaymu";
type Ctx = Context<{ Bindings: Bindings }>;

// Alur bersama setelah callback lolos verifikasi provider. Hanya membaca
// `sessions`; transisi status diserahkan ke BoothDO lewat RPC.
async function handleVerified(c: Ctx, provider: ProviderName, accountId: string, verification: VerifyWebhookResult) {
  const db = getDb(c.env.DB);
  const rawPayload = (verification.rawPayload as Record<string, unknown> | undefined) ?? null;

  if (!verification.sessionRef) {
    await db.insert(schema.paymentLogs).values({ provider, eventType: "missing_reference", payload: rawPayload });
    return c.json({ ok: true, message: "no reference_id" });
  }

  const sessionId = verification.sessionRef;
  const [session] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).limit(1);

  if (!session) {
    await db.insert(schema.paymentLogs).values({ sessionId, provider, eventType: "session_not_found", payload: rawPayload });
    // 200 supaya provider tidak mengulang terus untuk sesi yang tidak akan ada.
    return c.json({ ok: true, message: "session not found" });
  }

  // Callback hanya boleh menyentuh sesi yang QR-nya dibuat akun yang sama.
  // Sesi lama (sebelum akun per booth) tidak punya akun: diterima.
  if (session.paymentAccountId && session.paymentAccountId !== accountId) {
    await db.insert(schema.paymentLogs).values({ sessionId, provider, eventType: "account_mismatch", payload: rawPayload });
    logger.warn(`${provider}_webhook_account_mismatch`, { sessionId, accountId, expected: session.paymentAccountId });
    return c.json({ ok: true, message: "account mismatch" });
  }

  // iPaymu: transaksi hasil Check Transaction wajib sama dengan QR yang dibuat
  // untuk sesi ini. Mencegah transaksi lain (referenceId sama) menandai lunas.
  if (provider === "ipaymu") {
    const verifiedTrx = rawPayload?.verifiedTransactionId;
    if (session.paymentProvider !== "ipaymu" || (session.paymentRef && String(verifiedTrx) !== session.paymentRef)) {
      await db.insert(schema.paymentLogs).values({ sessionId, provider, eventType: "reference_mismatch", payload: rawPayload });
      logger.warn("ipaymu_webhook_reference_mismatch", { sessionId });
      return c.json({ ok: true, message: "reference mismatch" });
    }
    if (verification.event === "paid" && typeof verification.amount === "number" && verification.amount < session.amount) {
      await db.insert(schema.paymentLogs).values({ sessionId, provider, eventType: "amount_mismatch", payload: rawPayload });
      logger.warn("ipaymu_webhook_amount_mismatch", { sessionId, paid: verification.amount, expected: session.amount });
      return c.json({ ok: true, message: "amount mismatch" });
    }
  }

  if (verification.event === "paid") {
    if (PAID_TERMINAL_STATUSES.has(session.status)) {
      await db.insert(schema.paymentLogs).values({ sessionId, provider, eventType: "duplicate", payload: rawPayload });
      logger.info(`${provider}_webhook_duplicate`, { sessionId, status: session.status });
      return c.json({ ok: true, duplicate: true });
    }

    if (session.status === "payment") {
      await db.insert(schema.paymentLogs).values({ sessionId, provider, eventType: "paid", payload: rawPayload });
      const transitioned = await markPaid(c.env, session.boothId, sessionId, { amount: verification.amount, provider });
      if (transitioned) {
        logger.info(`${provider}_webhook_paid`, { sessionId, amount: verification.amount });
        return c.json({ ok: true });
      }
      // Alarm kedaluwarsa menang di antara baca dan markPaid. Baca ulang lalu
      // perlakukan sebagai pembayaran terlambat kalau memang tertutup tanpa bayar.
      const [fresh] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).limit(1);
      if (!fresh || !isLatePayment(fresh)) {
        return c.json({ ok: true, duplicate: true });
      }
    } else if (!isLatePayment(session)) {
      await db.insert(schema.paymentLogs).values({ sessionId, provider, eventType: "paid_unexpected_status", payload: rawPayload });
      logger.warn(`${provider}_webhook_paid_unexpected_status`, { sessionId, status: session.status });
      return c.json({ ok: true });
    }

    // Pembayaran terlambat: voucher otomatis, idempoten per sesi.
    const voucher = await recordLatePayment(db, session, {
      provider,
      rawPayload,
      paidAmount: verification.amount ?? null,
    });
    // Kode voucher tidak pernah masuk log (PRD bagian 12).
    logger.info(`${provider}_webhook_late_payment`, { sessionId, voucherId: voucher.id, created: voucher.created });
    return c.json({ ok: true, latePayment: true });
  }

  if (verification.event === "expired" || verification.event === "failed") {
    await db.insert(schema.paymentLogs).values({ sessionId, provider, eventType: verification.event, payload: rawPayload });
    // Hanya sesi yang masih menunggu bayar yang boleh ditutup oleh callback.
    if (session.status === "payment") await markExpired(c.env, session.boothId, sessionId);
    logger.info(`${provider}_webhook_not_paid`, { sessionId, event: verification.event });
    return c.json({ ok: true });
  }

  // Event lain (mis. pending) — catat, balas 200 supaya tidak diulang.
  await db.insert(schema.paymentLogs).values({ sessionId, provider, eventType: "unknown_event", payload: rawPayload });
  return c.json({ ok: true });
}

function lowerHeaders(c: Ctx): Record<string, string> {
  const headers: Record<string, string> = {};
  c.req.raw.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  return headers;
}

// Xendit: satu URL per akun (didaftarkan di dashboard Xendit akun tsb).
// Token callback dicek dengan token akun itu saja.
async function xenditVerify(c: Ctx, account: LoadedAccount, rawBody: string) {
  return account.provider.verifyWebhook({ headers: lowerHeaders(c), body: rawBody });
}

webhook.post("/xendit/:accountId", async (c) => {
  const rawBody = await c.req.text();
  const db = getDb(c.env.DB);
  const account = await loadAccount(db, c.env, c.req.param("accountId"));
  if (!account || account.row.provider !== "xendit") {
    logger.warn("xendit_webhook_unknown_account", { accountId: c.req.param("accountId") });
    return c.json({ error: "Invalid signature" }, 401);
  }
  const verification = await xenditVerify(c, account, rawBody);
  if (!verification.valid) {
    // Token salah: jangan percaya isi body, jangan tulis payment_logs.
    logger.warn("xendit_invalid_webhook", { reason: verification.reason, accountId: account.row.id });
    return c.json({ error: "Invalid signature" }, 401);
  }
  return handleVerified(c, "xendit", account.row.id, verification);
});

// URL lama tanpa id akun (sudah terdaftar di dashboard Xendit sebelum akun per
// booth). Token dicocokkan ke semua akun Xendit; yang cocok = pengirimnya.
webhook.post("/xendit", async (c) => {
  const rawBody = await c.req.text();
  const db = getDb(c.env.DB);
  const candidates = await loadAccountsByProvider(db, c.env, "xendit");
  for (const account of candidates) {
    const verification = await xenditVerify(c, account, rawBody);
    if (verification.valid) return handleVerified(c, "xendit", account.row.id, verification);
  }
  logger.warn("xendit_invalid_webhook", { reason: "no account token matched", accounts: candidates.length });
  return c.json({ error: "Invalid signature" }, 401);
});

// iPaymu: status lunas TIDAK diambil dari body callback. Provider memanggil
// Check Transaction ke API iPaymu dengan kredensial akun pembuat QR, dan hasil
// itu yang dipakai (lihat lib/payment/ipaymu.ts).
async function ipaymuHandle(c: Ctx, account: LoadedAccount | null, rawBody: string) {
  if (!account || account.row.provider !== "ipaymu") {
    logger.warn("ipaymu_webhook_unknown_account");
    return c.json({ error: "Unverified callback" }, 400);
  }
  const verification = await account.provider.verifyWebhook({ headers: lowerHeaders(c), body: rawBody });
  if (!verification.valid) {
    logger.warn("ipaymu_unverified_webhook", { reason: verification.reason, accountId: account.row.id });
    // 400 bukan 401: bisa karena API iPaymu sedang gangguan, biar iPaymu mengulang.
    return c.json({ error: "Unverified callback" }, 400);
  }
  const raw = verification.rawPayload as Record<string, unknown> | undefined;
  if (raw && raw.signatureOk === false) logger.warn("ipaymu_webhook_signature_mismatch", { verifiedBy: "check_transaction" });
  return handleVerified(c, "ipaymu", account.row.id, verification);
}

webhook.post("/ipaymu/:accountId", async (c) => {
  const rawBody = await c.req.text();
  const account = await loadAccount(getDb(c.env.DB), c.env, c.req.param("accountId"));
  return ipaymuHandle(c, account, rawBody);
});

// Tanpa id akun: akun diambil dari sesi yang disebut body. Aman karena body
// tidak dipercaya; status tetap dari Check Transaction akun sesi itu.
webhook.post("/ipaymu", async (c) => {
  const rawBody = await c.req.text();
  const db = getDb(c.env.DB);
  const body = parseIpaymuBody(rawBody, c.req.header("content-type") ?? "");
  const ref = body?.reference_id != null ? String(body.reference_id) : "";
  let account: LoadedAccount | null = null;
  if (ref) {
    const [s] = await db
      .select({ accountId: schema.sessions.paymentAccountId })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, ref))
      .limit(1);
    account = await loadAccount(db, c.env, s?.accountId);
  }
  return ipaymuHandle(c, account, rawBody);
});

export default webhook;
