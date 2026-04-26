import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getIo } from "@/lib/socket/server";
import { runMockBridgeForSession } from "@/lib/kiosk/mock-bridge";
import { SocketEvents } from "@capture/shared";
import { logger } from "@/lib/logger";

type Ctx = { params: Promise<{ id: string }> };

// PUBLIC — kiosk hits this after user taps "Mulai Foto". The actual auth here
// is implicit: only the kiosk in front of the user knows the session id, and
// the session must be in `paid` status for this to do anything.
export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const [session] = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, id))
    .limit(1);
  if (!session) {
    return NextResponse.json({ error: "Session tidak ditemukan" }, { status: 404 });
  }
  if (session.status !== "paid") {
    return NextResponse.json(
      { error: `Session belum dibayar (status: ${session.status})` },
      { status: 400 },
    );
  }

  await db
    .update(schema.sessions)
    .set({ status: "capturing" })
    .where(eq(schema.sessions.id, id));

  const [booth] = await db
    .select()
    .from(schema.booths)
    .where(eq(schema.booths.id, session.boothId))
    .limit(1);
  const useMock =
    ((booth?.metadata as Record<string, unknown> | null)?.use_mock_bridge as
      | boolean
      | undefined) ?? true;

  if (useMock) {
    void runMockBridgeForSession({ sessionId: id, boothId: session.boothId });
  } else {
    // Real bridge — send to bridge room only (not the kiosk room).
    const io = getIo();
    io?.to(`bridge:${session.boothId}`).emit(SocketEvents.BRIDGE_CAPTURE, {
      sessionId: id,
      photoIndex: 1,
    });
  }

  logger.info("session_start_capture", { sessionId: id, mock: useMock });
  return NextResponse.json({ ok: true, mockMode: useMock });
}
