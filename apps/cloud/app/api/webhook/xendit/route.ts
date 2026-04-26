import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payment";
import { logger } from "@/lib/logger";
import { emitToBooth, emitToAdmin } from "@/lib/socket/server";
import { SocketEvents } from "@capture/shared";

// PUBLIC endpoint — verified via x-callback-token header.
export async function POST(req: Request) {
  const rawBody = await req.text();
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  const provider = getPaymentProvider("xendit");
  const verification = await provider.verifyWebhook({ headers, body: rawBody });

  if (!verification.valid) {
    await db.insert(schema.paymentLogs).values({
      provider: "xendit",
      eventType: "invalid_webhook",
      payload: { reason: verification.reason, headers },
    });
    logger.warn("xendit_invalid_webhook", { reason: verification.reason });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  if (!verification.sessionRef) {
    await db.insert(schema.paymentLogs).values({
      provider: "xendit",
      eventType: "missing_reference",
      payload: verification.rawPayload as object,
    });
    return NextResponse.json({ ok: true, message: "no reference_id" });
  }

  const sessionId = verification.sessionRef;
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
      payload: verification.rawPayload as object,
    });
    // Return 200 anyway so Xendit doesn't retry forever
    return NextResponse.json({ ok: true, message: "session not found" });
  }

  if (verification.event === "paid") {
    if (session.status === "paid" || session.status === "capturing" || session.status === "processing" || session.status === "done") {
      // Idempotent: already past this point
      await db.insert(schema.paymentLogs).values({
        sessionId,
        provider: "xendit",
        eventType: "duplicate",
        payload: verification.rawPayload as object,
      });
      logger.info("xendit_webhook_duplicate", { sessionId, status: session.status });
      return NextResponse.json({ ok: true, duplicate: true });
    }
    const paidAt = new Date();
    await db
      .update(schema.sessions)
      .set({ status: "paid", paidAt })
      .where(eq(schema.sessions.id, sessionId));
    await db.insert(schema.paymentLogs).values({
      sessionId,
      provider: "xendit",
      eventType: "paid",
      payload: verification.rawPayload as object,
    });
    emitToBooth(session.boothId, SocketEvents.PAYMENT_PAID, {
      sessionId,
      amount: session.amount,
      paidAt: paidAt.toISOString(),
    });
    emitToAdmin(SocketEvents.ADMIN_SESSION_UPDATE, {
      boothId: session.boothId,
      sessionId,
      status: "paid",
      amount: session.amount,
    });
    logger.info("xendit_webhook_paid", { sessionId, amount: verification.amount });
    return NextResponse.json({ ok: true });
  }

  if (verification.event === "expired" || verification.event === "failed") {
    if (session.status !== "expired" && session.status !== "failed" && session.status !== "done") {
      await db
        .update(schema.sessions)
        .set({ status: verification.event })
        .where(eq(schema.sessions.id, sessionId));
    }
    await db.insert(schema.paymentLogs).values({
      sessionId,
      provider: "xendit",
      eventType: verification.event,
      payload: verification.rawPayload as object,
    });
    emitToBooth(session.boothId, SocketEvents.PAYMENT_EXPIRED, { sessionId });
    return NextResponse.json({ ok: true });
  }

  // Unknown event — log but ack
  await db.insert(schema.paymentLogs).values({
    sessionId,
    provider: "xendit",
    eventType: "unknown_event",
    payload: verification.rawPayload as object,
  });
  return NextResponse.json({ ok: true });
}
