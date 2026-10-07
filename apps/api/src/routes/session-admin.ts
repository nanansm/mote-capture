// Ported from apps/cloud/app/api/session/[id]/reset/route.ts,
// apps/cloud/app/api/session/[id]/refund/route.ts, and
// apps/cloud/app/api/dev/mock-pay/[sessionId]/route.ts (Next.js route
// handlers -> Hono sub-routers).
//
// `sessionAdminRoutes` mounts at /api/session alongside sessionUploadRoutes
// (:id/photos, :id/composite) and sessionRoutes (:id/contact, :id/notify,
// :id/resend) — see src/index.ts. Paths here (:id/reset, :id/refund) don't
// overlap with either.
//
// `devMockPayRoutes` mounts at /api/dev.
//
// Both status-changing actions (reset, refund) go through BoothDO via
// src/do/rpc.ts instead of writing `sessions` directly — BoothDO is the sole
// writer of that table (see src/do/rpc.ts header comment). `payment_logs` is
// append-only, so the refund route still writes it directly, same as the
// old code.
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { REFUND_REASONS } from "@capture/shared";
import type { Bindings } from "@/lib/env";
import { getEnv } from "@/lib/env";
import type { AdminVariables } from "@/middleware/admin";
import { requireAdmin } from "@/middleware/admin";
import { getDb, schema } from "@/db";
import { forceReset, markPaid, refundSession } from "@/do/rpc";
import { logger } from "@/lib/logger";
import { isLatePayment, recordLatePayment } from "@/lib/auto-voucher";

const sessionAdmin = new Hono<{ Bindings: Bindings; Variables: AdminVariables }>();

sessionAdmin.use("*", requireAdmin);

// ADMIN-ONLY — force-abandon whatever session is stuck at this booth.
// Ported from apps/cloud/app/api/session/[id]/reset/route.ts. The old route
// wrote `sessions.status='failed'` and called `emitToBooth(...RESET...)`
// directly; this router only reads the session (to resolve boothId) and
// hands the actual status write + kiosk broadcast off to
// BoothDO.forceReset via the `forceReset` RPC (src/do/rpc.ts).
sessionAdmin.post("/:id/reset", async (c) => {
  const adminEmail = c.get("adminEmail");
  const id = c.req.param("id");

  const db = getDb(c.env.DB);
  const [session] = await db
    .select({ id: schema.sessions.id, boothId: schema.sessions.boothId })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, id))
    .limit(1);
  if (!session) {
    return c.json({ error: "Session tidak ditemukan" }, 404);
  }

  await forceReset(c.env, session.boothId, id, adminEmail);
  logger.info("session_reset_admin", { sessionId: id, by: adminEmail });

  return c.json({ ok: true });
});

const refundBodySchema = z.object({
  reasonCode: z.enum(REFUND_REASONS).default("MANUAL"),
  reason: z.string().min(1).max(500),
});

// ADMIN-ONLY — refund manual (PRD bagian 8 #7). Tanpa panggilan refund Xendit;
// uang dikembalikan tunai/voucher di kasir, di sini hanya dicatat.
// Sesi `done` boleh: status tetap `done`, link share tetap hidup.
// Sekali per sesi: klik ganda -> 409, bukan dua baris refund.
sessionAdmin.post("/:id/refund", async (c) => {
  const adminEmail = c.get("adminEmail");
  const id = c.req.param("id");

  let json: unknown = {};
  try {
    json = await c.req.json();
  } catch {
    // body kosong -> divalidasi zod di bawah
  }
  const parsed = refundBodySchema.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "Alasan refund wajib diisi" }, 400);
  }

  const db = getDb(c.env.DB);
  const [session] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, id)).limit(1);
  if (!session) {
    return c.json({ error: "Session tidak ditemukan" }, 404);
  }

  const result = await refundSession(c.env, session.boothId, id, {
    reasonCode: parsed.data.reasonCode,
    reason: parsed.data.reason,
    byEmail: adminEmail,
  });
  if (!result.ok) {
    if (result.code === "ALREADY_REFUNDED") {
      return c.json({ error: "Sesi ini sudah pernah direfund", code: result.code }, 409);
    }
    if (result.code === "NOT_FOUND") return c.json({ error: "Session tidak ditemukan" }, 404);
    return c.json(
      { error: `Refund hanya untuk sesi yang sudah dibayar (status sekarang: ${result.status ?? session.status})`, code: result.code },
      400,
    );
  }

  await db.insert(schema.paymentLogs).values({
    sessionId: id,
    provider: session.paymentProvider ?? "unknown",
    eventType: "refund_manual",
    payload: { reasonCode: parsed.data.reasonCode, reason: parsed.data.reason, by: adminEmail, fromStatus: session.status, amount: session.amount },
  });

  logger.info("session_refunded", { sessionId: id, by: adminEmail, reasonCode: parsed.data.reasonCode });
  return c.json({ ok: true, status: result.status });
});

export default sessionAdmin;

// ---------------------------------------------------------------------------
// DEV-ONLY: simulate a Xendit `paid` webhook so the kiosk advances to
// COUNTDOWN without an actual payment. Ported from
// apps/cloud/app/api/dev/mock-pay/[sessionId]/route.ts, which returned 403
// when `NODE_ENV=production`. Workers have no `NODE_ENV`, so this checks
// `env.APP_URL` instead: enabled only when it looks like a local dev server
// (`localhost`/`127.0.0.1`). Deliberately NOT matched on `workers.dev` —
// this project's real production APP_URL (wrangler.jsonc `vars.APP_URL`) is
// itself `https://mote-capture.workers.dev`, so that substring would
// misfire and enable this in production. Disabled (404, not 403 — the old
// route's 403 leaked that the endpoint exists at all) for anything that
// isn't explicitly localhost, which fails closed for staging/preview too.
// ---------------------------------------------------------------------------
export const devMockPayRoutes = new Hono<{ Bindings: Bindings }>();

devMockPayRoutes.post("/mock-pay/:sessionId", async (c) => {
  const env = getEnv(c.env);
  const isDev = env.APP_URL.includes("localhost") || env.APP_URL.includes("127.0.0.1");
  if (!isDev) {
    return c.json({ error: "Not found" }, 404);
  }

  const sessionId = c.req.param("sessionId");
  const db = getDb(c.env.DB);
  const [session] = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .limit(1);
  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }

  // Idempotent: a double-click should not error. If the session has already
  // moved past payment we just echo the current state.
  if (
    session.status === "paid" ||
    session.status === "capturing" ||
    session.status === "processing" ||
    session.status === "done"
  ) {
    return c.json({
      ok: true,
      mock: true,
      duplicate: true,
      sessionId,
      boothId: session.boothId,
      currentStatus: session.status,
    });
  }

  // Uji A5: mock-pay setelah expired = webhook PAID terlambat, jalur yang sama.
  if (isLatePayment(session)) {
    const voucher = await recordLatePayment(db, session, {
      provider: session.paymentProvider ?? "xendit",
      rawPayload: { mock: true, dev: true },
      paidAmount: session.amount,
    });
    return c.json({ ok: true, mock: true, latePayment: true, voucherId: voucher.id, sessionId });
  }

  if (session.status !== "payment") {
    return c.json(
      {
        error: `Session status is "${session.status}", cannot mock-pay`,
        currentStatus: session.status,
      },
      400,
    );
  }

  // Writes go through BoothDO (sole writer of `sessions`) via the same
  // `markPaid` RPC the real Xendit webhook uses (src/routes/webhook.ts) —
  // this is genuinely "as if the webhook fired", not a separate code path.
  await markPaid(c.env, session.boothId, sessionId, { mock: true, dev: true });

  await db.insert(schema.paymentLogs).values({
    sessionId,
    provider: session.paymentProvider ?? "xendit",
    eventType: "mock_paid_dev",
    payload: { mock: true, dev: true, paidAt: new Date().toISOString() },
  });

  logger.info("dev_mock_pay", { sessionId, boothId: session.boothId, amount: session.amount });

  return c.json({
    ok: true,
    mock: true,
    sessionId,
    boothId: session.boothId,
    paidAt: new Date().toISOString(),
  });
});
