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
import type { Bindings } from "@/lib/env";
import { getEnv } from "@/lib/env";
import type { AdminVariables } from "@/middleware/admin";
import { requireAdmin } from "@/middleware/admin";
import { getDb, schema } from "@/db";
import { forceReset, markPaid, refundSession } from "@/do/rpc";
import { logger } from "@/lib/logger";

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
  reason: z.string().min(1).max(500),
});

// ADMIN-ONLY — manual refund. Sprint 2 behavior carried over as-is: records
// the intent and marks the session 'failed'; no real provider refund call
// yet (ported from apps/cloud/app/api/session/[id]/refund/route.ts).
sessionAdmin.post("/:id/refund", async (c) => {
  const adminEmail = c.get("adminEmail");
  const id = c.req.param("id");

  let json: unknown = {};
  try {
    json = await c.req.json();
  } catch {
    // empty body — falls through to zod validation below
  }
  const parsed = refundBodySchema.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "Alasan refund wajib diisi" }, 400);
  }

  const db = getDb(c.env.DB);
  const [session] = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, id))
    .limit(1);
  if (!session) {
    return c.json({ error: "Session tidak ditemukan" }, 404);
  }
  if (session.status !== "paid" && session.status !== "capturing" && session.status !== "processing") {
    return c.json(
      { error: `Refund hanya bisa untuk sesi yang sudah dibayar (status sekarang: ${session.status})` },
      400,
    );
  }

  await refundSession(c.env, session.boothId, id, { reason: parsed.data.reason, byEmail: adminEmail });

  await db.insert(schema.paymentLogs).values({
    sessionId: id,
    provider: session.paymentProvider ?? "unknown",
    eventType: "refund_manual",
    payload: { reason: parsed.data.reason, by: adminEmail },
  });

  logger.info("session_refunded", { sessionId: id, by: adminEmail });
  return c.json({ ok: true });
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

  if (session.status !== "payment" && session.status !== "idle") {
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
