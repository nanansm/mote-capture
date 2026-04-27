import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { logger } from "@/lib/logger";
import { emitToBooth, emitToAdmin } from "@/lib/socket/server";
import { SocketEvents } from "@capture/shared";

// DEV-ONLY: simulate Xendit `paid` webhook so the kiosk advances to COUNTDOWN
// without an actual payment. Side-effects mirror the real webhook handler at
// app/api/webhook/xendit/route.ts so the kiosk + admin overview see the same
// socket events. Returns 403 when NODE_ENV=production.
async function handle(sessionId: string): Promise<Response> {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "Not available in production" },
      { status: 403 },
    );
  }

  const [session] = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .limit(1);

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Idempotent: a double-click should not error. If the session has already
  // moved past payment we just echo the current state.
  if (
    session.status === "paid" ||
    session.status === "capturing" ||
    session.status === "processing" ||
    session.status === "done"
  ) {
    return NextResponse.json({
      ok: true,
      mock: true,
      duplicate: true,
      sessionId,
      boothId: session.boothId,
      currentStatus: session.status,
    });
  }

  if (session.status !== "payment" && session.status !== "idle") {
    return NextResponse.json(
      {
        error: `Session status is "${session.status}", cannot mock-pay`,
        currentStatus: session.status,
      },
      { status: 400 },
    );
  }

  const paidAt = new Date();

  await db
    .update(schema.sessions)
    .set({ status: "paid", paidAt })
    .where(eq(schema.sessions.id, sessionId));

  await db.insert(schema.paymentLogs).values({
    sessionId,
    provider: session.paymentProvider ?? "xendit",
    eventType: "mock_paid_dev",
    payload: {
      mock: true,
      env: process.env.NODE_ENV ?? "development",
      paidAt: paidAt.toISOString(),
    },
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

  logger.info("dev_mock_pay", {
    sessionId,
    boothId: session.boothId,
    amount: session.amount,
  });

  return NextResponse.json({
    ok: true,
    mock: true,
    sessionId,
    boothId: session.boothId,
    paidAt: paidAt.toISOString(),
  });
}

type Ctx = { params: Promise<{ sessionId: string }> };

export async function POST(_req: Request, { params }: Ctx) {
  const { sessionId } = await params;
  return handle(sessionId);
}

// Browser-friendly: hitting the URL in a tab works the same as POST.
export async function GET(_req: Request, { params }: Ctx) {
  const { sessionId } = await params;
  return handle(sessionId);
}
