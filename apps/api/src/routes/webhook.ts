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
import type { Bindings } from "@/lib/env";
import { getDb, schema } from "@/db";
import { logger } from "@/lib/logger";
import { getPaymentProvider } from "@/lib/payment";
import { markExpired, markPaid } from "@/do/rpc";

const webhook = new Hono<{ Bindings: Bindings }>();

const PAID_TERMINAL_STATUSES = new Set(["paid", "capturing", "processing", "done"]);

webhook.post("/xendit", async (c) => {
  const rawBody = await c.req.text();
  const headers: Record<string, string> = {};
  c.req.raw.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  const db = getDb(c.env.DB);
  const provider = getPaymentProvider("xendit", c.env);
  const verification = await provider.verifyWebhook({ headers, body: rawBody });

  if (!verification.valid) {
    // Token check failed — do NOT trust anything in the body, and do not
    // write payment_logs for it (nothing here is verified as coming from
    // Xendit at all).
    logger.warn("xendit_invalid_webhook", { reason: verification.reason });
    return c.json({ error: "Invalid signature" }, 401);
  }

  if (!verification.sessionRef) {
    await db.insert(schema.paymentLogs).values({
      provider: "xendit",
      eventType: "missing_reference",
      payload: (verification.rawPayload as Record<string, unknown> | undefined) ?? null,
    });
    return c.json({ ok: true, message: "no reference_id" });
  }

  const sessionId = verification.sessionRef;

  // READ-ONLY: BoothDO is the sole writer of `sessions` (see file header).
  const [session] = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .limit(1);

  if (!session) {
    await db.insert(schema.paymentLogs).values({
      sessionId,
      provider: "xendit",
      eventType: "session_not_found",
      payload: (verification.rawPayload as Record<string, unknown> | undefined) ?? null,
    });
    // 200 anyway so Xendit doesn't retry forever over a session that will
    // never show up (e.g. stale/replayed callback).
    return c.json({ ok: true, message: "session not found" });
  }

  if (verification.event === "paid") {
    if (PAID_TERMINAL_STATUSES.has(session.status)) {
      await db.insert(schema.paymentLogs).values({
        sessionId,
        provider: "xendit",
        eventType: "duplicate",
        payload: (verification.rawPayload as Record<string, unknown> | undefined) ?? null,
      });
      logger.info("xendit_webhook_duplicate", { sessionId, status: session.status });
      return c.json({ ok: true, duplicate: true });
    }

    await db.insert(schema.paymentLogs).values({
      sessionId,
      provider: "xendit",
      eventType: "paid",
      payload: (verification.rawPayload as Record<string, unknown> | undefined) ?? null,
    });

    await markPaid(c.env, session.boothId, sessionId, {
      amount: verification.amount,
      provider: "xendit",
    });

    logger.info("xendit_webhook_paid", { sessionId, amount: verification.amount });
    return c.json({ ok: true });
  }

  if (verification.event === "expired" || verification.event === "failed") {
    await db.insert(schema.paymentLogs).values({
      sessionId,
      provider: "xendit",
      eventType: verification.event,
      payload: (verification.rawPayload as Record<string, unknown> | undefined) ?? null,
    });

    await markExpired(c.env, session.boothId, sessionId);

    logger.info("xendit_webhook_not_paid", { sessionId, event: verification.event });
    return c.json({ ok: true });
  }

  // Unknown event — log but ack so Xendit doesn't keep retrying.
  await db.insert(schema.paymentLogs).values({
    sessionId,
    provider: "xendit",
    eventType: "unknown_event",
    payload: (verification.rawPayload as Record<string, unknown> | undefined) ?? null,
  });
  return c.json({ ok: true });
});

export default webhook;
