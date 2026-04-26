import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getCurrentSession } from "@/lib/auth";
import { logger } from "@/lib/logger";

const bodySchema = z.object({
  reason: z.string().min(1).max(500),
});

type Ctx = { params: Promise<{ id: string }> };

// Manual refund — Sprint 2 records the intent and marks the session 'failed'.
// Real provider refund will be wired up when Xendit refunds API is integrated.
export async function POST(req: Request, { params }: Ctx) {
  const adminSession = await getCurrentSession();
  if (!adminSession) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  let json: unknown = {};
  try {
    json = await req.json();
  } catch {
    // empty
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Alasan refund wajib diisi" },
      { status: 400 },
    );
  }

  const [session] = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, id))
    .limit(1);
  if (!session) return NextResponse.json({ error: "Session tidak ditemukan" }, { status: 404 });
  if (session.status !== "paid" && session.status !== "capturing" && session.status !== "processing") {
    return NextResponse.json(
      { error: `Refund hanya bisa untuk sesi yang sudah dibayar (status sekarang: ${session.status})` },
      { status: 400 },
    );
  }

  await db
    .update(schema.sessions)
    .set({ status: "failed", metadata: { ...(session.metadata as object), refundReason: parsed.data.reason, refundedAt: new Date().toISOString(), refundedBy: adminSession.email } })
    .where(eq(schema.sessions.id, id));
  await db.insert(schema.paymentLogs).values({
    sessionId: id,
    provider: session.paymentProvider ?? "unknown",
    eventType: "refund_manual",
    payload: { reason: parsed.data.reason, by: adminSession.email },
  });

  logger.info("session_refunded", { sessionId: id, by: adminSession.email });
  return NextResponse.json({ ok: true });
}
