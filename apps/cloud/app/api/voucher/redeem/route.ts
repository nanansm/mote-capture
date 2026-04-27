import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { logger } from "@/lib/logger";
import { emitToBooth, emitToAdmin } from "@/lib/socket/server";
import { SocketEvents } from "@capture/shared";

// Public endpoint — auth is "the kiosk knows the sessionId, code, and boothId
// from its own context". The voucher code itself is the secret; same trust
// model as the QRIS happy-path (anyone with the QR can pay).
export async function POST(req: Request) {
  let body: { code?: unknown; sessionId?: unknown; boothId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { error: "BAD_BODY", message: "Body tidak valid" },
      { status: 400 },
    );
  }

  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  const boothIdHint = typeof body.boothId === "string" ? body.boothId : undefined;

  if (!code || !sessionId) {
    return NextResponse.json(
      { error: "MISSING_FIELDS", message: "Kode voucher atau sesi kosong" },
      { status: 400 },
    );
  }

  const [voucher] = await db
    .select()
    .from(schema.vouchers)
    .where(eq(schema.vouchers.code, code))
    .limit(1);

  if (!voucher) {
    return NextResponse.json(
      { error: "NOT_FOUND", message: "Kode voucher tidak ditemukan" },
      { status: 404 },
    );
  }

  // Check expiry first — flip status if past expiresAt and inform the user.
  if (voucher.expiresAt && voucher.expiresAt.getTime() < Date.now()) {
    if (voucher.status !== "expired") {
      await db
        .update(schema.vouchers)
        .set({ status: "expired", updatedAt: new Date() })
        .where(eq(schema.vouchers.id, voucher.id));
    }
    return NextResponse.json(
      { error: "EXPIRED", message: "Voucher sudah kadaluarsa" },
      { status: 400 },
    );
  }

  if (voucher.status !== "active") {
    const message =
      voucher.status === "used"
        ? "Voucher sudah habis dipakai"
        : voucher.status === "disabled"
          ? "Voucher dinonaktifkan"
          : `Voucher tidak aktif (${voucher.status})`;
    return NextResponse.json(
      { error: "INACTIVE", message, currentStatus: voucher.status },
      { status: 400 },
    );
  }

  if (voucher.limit > 0 && voucher.usedCount >= voucher.limit) {
    // Repair drift: status should already be "used" but we self-heal.
    await db
      .update(schema.vouchers)
      .set({ status: "used", updatedAt: new Date() })
      .where(eq(schema.vouchers.id, voucher.id));
    return NextResponse.json(
      { error: "QUOTA_EXHAUSTED", message: "Voucher sudah habis dipakai" },
      { status: 400 },
    );
  }

  const [session] = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .limit(1);

  if (!session) {
    return NextResponse.json(
      { error: "SESSION_NOT_FOUND", message: "Sesi tidak ditemukan" },
      { status: 404 },
    );
  }

  if (session.status !== "payment" && session.status !== "idle") {
    return NextResponse.json(
      {
        error: "SESSION_NOT_PAYABLE",
        message: `Sesi tidak dapat dibayar (status: ${session.status})`,
        currentStatus: session.status,
      },
      { status: 400 },
    );
  }

  // Compute final amount + discount.
  let finalAmount: number;
  let discountApplied: number;

  if (voucher.type === "payment") {
    if (voucher.value >= session.amount) {
      finalAmount = 0;
      discountApplied = session.amount;
    } else {
      finalAmount = session.amount - voucher.value;
      discountApplied = voucher.value;
    }
  } else if (voucher.type === "discount") {
    const pct = Math.max(0, Math.min(100, voucher.value));
    discountApplied = Math.round((session.amount * pct) / 100);
    finalAmount = session.amount - discountApplied;
  } else {
    return NextResponse.json(
      { error: "BAD_VOUCHER_TYPE", message: `Jenis voucher tidak valid (${voucher.type})` },
      { status: 500 },
    );
  }

  const paidAt = new Date();
  const newUsedCount = voucher.usedCount + 1;
  const nextStatus =
    voucher.limit > 0 && newUsedCount >= voucher.limit ? "used" : "active";

  // Atomic redemption: fail any one of these and the whole thing rolls back.
  // pg-driver's transaction wrapper — same pattern Drizzle uses elsewhere.
  await db.transaction(async (tx) => {
    await tx
      .update(schema.vouchers)
      .set({
        usedCount: sql`${schema.vouchers.usedCount} + 1`,
        status: nextStatus,
        updatedAt: new Date(),
      })
      .where(eq(schema.vouchers.id, voucher.id));

    await tx.insert(schema.voucherRedemptions).values({
      voucherId: voucher.id,
      sessionId,
      boothId: boothIdHint || session.boothId,
      originalAmount: session.amount,
      finalAmount,
      discountApplied,
    });

    // Sprint 1.5 simplification: ALL voucher redemptions mark the session
    // paid, even if finalAmount > 0. Sprint 3 will branch a discount voucher
    // back into the QRIS flow for the remaining gap.
    await tx
      .update(schema.sessions)
      .set({ status: "paid", paidAt })
      .where(eq(schema.sessions.id, sessionId));

    await tx.insert(schema.paymentLogs).values({
      sessionId,
      provider: "voucher",
      eventType: "voucher_redeemed",
      payload: {
        voucherId: voucher.id,
        code,
        type: voucher.type,
        value: voucher.value,
        originalAmount: session.amount,
        finalAmount,
        discountApplied,
        redemptionId: randomUUID(),
      },
    });
  });

  // Same payload shape as the Xendit webhook + dev mock-pay so the kiosk
  // doesn't need to special-case voucher payments.
  emitToBooth(session.boothId, SocketEvents.PAYMENT_PAID, {
    sessionId,
    amount: finalAmount,
    paidAt: paidAt.toISOString(),
  });

  emitToAdmin(SocketEvents.ADMIN_SESSION_UPDATE, {
    boothId: session.boothId,
    sessionId,
    status: "paid",
    amount: finalAmount,
  });

  logger.info("voucher_redeemed", {
    sessionId,
    boothId: session.boothId,
    voucherId: voucher.id,
    code,
    type: voucher.type,
    originalAmount: session.amount,
    finalAmount,
    discountApplied,
  });

  return NextResponse.json({
    ok: true,
    voucher: {
      code,
      type: voucher.type,
      value: voucher.value,
    },
    session: {
      id: sessionId,
      status: "paid",
      originalAmount: session.amount,
      finalAmount,
      discountApplied,
    },
  });
}
