import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getCurrentSession } from "@/lib/auth";
import { emitToBooth } from "@/lib/socket/server";
import { SocketEvents } from "@capture/shared";
import { logger } from "@/lib/logger";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Ctx) {
  const admin = await getCurrentSession();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const [session] = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, id))
    .limit(1);
  if (!session) return NextResponse.json({ error: "Session tidak ditemukan" }, { status: 404 });

  if (session.status !== "done") {
    await db
      .update(schema.sessions)
      .set({ status: "failed" })
      .where(eq(schema.sessions.id, id));
  }

  emitToBooth(session.boothId, SocketEvents.RESET, {
    sessionId: id,
    reason: `force-reset by ${admin.email}`,
  });
  logger.info("session_reset_admin", { sessionId: id, by: admin.email });

  return NextResponse.json({ ok: true });
}
