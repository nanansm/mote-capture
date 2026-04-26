import type { Server as IOServer, Socket } from "socket.io";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { generateSessionId, generateDownloadToken } from "@/lib/utils/token";
import { getPaymentProvider } from "@/lib/payment";
import { resolvePrice } from "@/lib/session-helpers";
import { SocketEvents } from "@capture/shared";
import { runMockBridgeForSession } from "@/lib/kiosk/mock-bridge";
import {
  cancelSchema,
  confirmAndPaySchema,
  startCaptureSchema,
  submitContactSchema,
} from "../events";

export function registerKioskHandlers(
  io: IOServer,
  socket: Socket,
  boothId: string,
): void {
  // Send ready ack with booth + bridge info
  void (async () => {
    const [booth] = await db
      .select()
      .from(schema.booths)
      .where(eq(schema.booths.id, boothId))
      .limit(1);
    if (!booth) return;
    const useMockBridge =
      ((booth.metadata as Record<string, unknown> | null)?.use_mock_bridge as
        | boolean
        | undefined) ?? true;
    socket.emit(SocketEvents.KIOSK_READY, {
      boothId,
      boothName: booth.name,
      defaultPrice: booth.defaultPrice,
      bridgeOnline: bridgeRoomHasMembers(io, boothId),
      useMockBridge,
    });
  })();

  socket.on(SocketEvents.CONFIRM_AND_PAY, async (raw: unknown, ack?: (v: unknown) => void) => {
    const parsed = confirmAndPaySchema.safeParse(raw);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Invalid payload";
      ack?.({ ok: false, error: msg });
      socket.emit(SocketEvents.ERROR, { code: "BAD_INPUT", message: msg });
      return;
    }
    if (parsed.data.boothId !== boothId) {
      ack?.({ ok: false, error: "boothId mismatch" });
      return;
    }

    try {
      const result = await createSessionAndQr(parsed.data);
      socket.emit(SocketEvents.PAYMENT_QR, {
        sessionId: result.sessionId,
        qrString: result.qrString,
        amount: result.amount,
        expiresAt: result.expiresAt,
        mockMode: result.mockMode,
      });
      // Inform admins that booth is now in session
      io.to("admin:overview").emit(SocketEvents.ADMIN_SESSION_UPDATE, {
        boothId,
        sessionId: result.sessionId,
        status: "payment",
        amount: result.amount,
      });
      ack?.({ ok: true, sessionId: result.sessionId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "session create failed";
      logger.error("kiosk_session_create_failed", { boothId, err: msg });
      ack?.({ ok: false, error: msg });
      socket.emit(SocketEvents.ERROR, { code: "SESSION_CREATE", message: msg });
    }
  });

  socket.on(SocketEvents.START_CAPTURE, async (raw: unknown, ack?: (v: unknown) => void) => {
    const parsed = startCaptureSchema.safeParse(raw);
    if (!parsed.success) {
      ack?.({ ok: false, error: "invalid payload" });
      return;
    }
    const { sessionId } = parsed.data;
    const [session] = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .limit(1);
    if (!session || session.boothId !== boothId) {
      ack?.({ ok: false, error: "session not found" });
      return;
    }
    if (session.status !== "paid") {
      ack?.({ ok: false, error: `session not paid (current: ${session.status})` });
      return;
    }

    await db
      .update(schema.sessions)
      .set({ status: "capturing" })
      .where(eq(schema.sessions.id, sessionId));

    const [booth] = await db
      .select()
      .from(schema.booths)
      .where(eq(schema.booths.id, boothId))
      .limit(1);
    const useMock =
      ((booth?.metadata as Record<string, unknown> | null)?.use_mock_bridge as boolean | undefined) ??
      true;

    if (useMock) {
      // Schedule mock-bridge to drive capture/composite/print
      void runMockBridgeForSession({ sessionId, boothId });
    } else {
      // Real bridge — start the capture sequence at photoIndex 1.
      io.to(`bridge:${boothId}`).emit(SocketEvents.BRIDGE_CAPTURE, {
        sessionId,
        photoIndex: 1,
      });
    }
    ack?.({ ok: true, mockMode: useMock });
  });

  socket.on(SocketEvents.SUBMIT_CONTACT, async (raw: unknown, ack?: (v: unknown) => void) => {
    const parsed = submitContactSchema.safeParse(raw);
    if (!parsed.success) {
      ack?.({ ok: false, error: parsed.error.issues[0]?.message ?? "invalid" });
      return;
    }
    const { sessionId, phone, email } = parsed.data;
    await db
      .update(schema.sessions)
      .set({ customerPhone: phone, customerEmail: email || null })
      .where(eq(schema.sessions.id, sessionId));
    try {
      const { notifySession } = await import("@/lib/notify");
      const result = await notifySession(sessionId);
      ack?.({ ok: true, ...result });
    } catch (err) {
      ack?.({
        ok: false,
        error: err instanceof Error ? err.message : "notify failed",
      });
    }
  });

  socket.on(SocketEvents.CANCEL, async (raw: unknown, ack?: (v: unknown) => void) => {
    const parsed = cancelSchema.safeParse(raw ?? {});
    const sessionId = parsed.success ? parsed.data.sessionId : undefined;
    if (sessionId) {
      const [session] = await db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, sessionId))
        .limit(1);
      if (session && session.boothId === boothId && session.status !== "done") {
        await db
          .update(schema.sessions)
          .set({ status: "expired" })
          .where(eq(schema.sessions.id, sessionId));
      }
    }
    socket.emit(SocketEvents.RESET, { sessionId });
    ack?.({ ok: true });
  });
}

async function createSessionAndQr(input: { boothId: string; frameId?: string }) {
  const [booth] = await db
    .select()
    .from(schema.booths)
    .where(eq(schema.booths.id, input.boothId))
    .limit(1);
  if (!booth) throw new Error("Booth tidak ditemukan");

  let frame: typeof schema.frames.$inferSelect | undefined;
  if (input.frameId) {
    const [row] = await db
      .select()
      .from(schema.frames)
      .where(eq(schema.frames.id, input.frameId))
      .limit(1);
    if (!row || !row.isActive) throw new Error("Frame tidak tersedia");
    if (row.boothId && row.boothId !== input.boothId)
      throw new Error("Frame tidak dipasang untuk booth ini");
    frame = row;
  }

  const amount = resolvePrice({
    frame: frame
      ? { tier: (frame.tier as "regular" | "premium") ?? "regular", price: frame.price }
      : null,
    boothDefaultPrice: booth.defaultPrice,
  });

  const sessionId = generateSessionId();
  const downloadToken = generateDownloadToken();
  const downloadExpiresAt = new Date(
    Date.now() + env.DOWNLOAD_LINK_EXPIRY_DAYS * 86400 * 1000,
  );

  const provider = getPaymentProvider(booth.paymentProvider);
  const qr = await provider.createQR({ sessionId, amount, expiresInMinutes: 5 });

  await db.insert(schema.sessions).values({
    id: sessionId,
    boothId: input.boothId,
    frameId: frame?.id ?? null,
    status: "payment",
    amount,
    paymentProvider: booth.paymentProvider,
    paymentRef: qr.providerRef,
    qrString: qr.qrString,
    downloadToken,
    downloadExpiresAt,
    expiredAt: qr.expiresAt,
  });

  await db.insert(schema.paymentLogs).values({
    sessionId,
    provider: booth.paymentProvider,
    eventType: "qr_created",
    payload: { providerRef: qr.providerRef, amount, mock: qr.mockMode ?? false },
  });

  return {
    sessionId,
    qrString: qr.qrString,
    amount,
    expiresAt: qr.expiresAt.toISOString(),
    mockMode: qr.mockMode ?? false,
  };
}

function bridgeRoomHasMembers(io: IOServer, boothId: string): boolean {
  const room = io.sockets.adapter.rooms.get(`bridge:${boothId}`);
  return Boolean(room && room.size > 0);
}
