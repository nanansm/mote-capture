import type { Server as IOServer, Socket } from "socket.io";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { logger } from "@/lib/logger";
import { SocketEvents } from "@capture/shared";
import {
  compositeUploadedSchema,
  photoUploadedSchema,
  printCompletedSchema,
} from "../events";

export function registerBridgeHandlers(
  io: IOServer,
  socket: Socket,
  boothId: string,
): void {
  // Mark booth as having bridge online
  void db
    .update(schema.booths)
    .set({ lastSeenAt: new Date() })
    .where(eq(schema.booths.id, boothId));

  io.to("admin:overview").emit(SocketEvents.ADMIN_BOOTH_STATUS, {
    boothId,
    online: true,
    inSession: false,
    lastSeenAt: new Date().toISOString(),
    bridgeOnline: true,
  });

  socket.on(SocketEvents.BRIDGE_HEARTBEAT, async (raw: unknown) => {
    const meta = (raw ?? {}) as Record<string, unknown>;
    await db
      .update(schema.booths)
      .set({
        lastSeenAt: new Date(),
        metadata: { ...(meta ?? {}), lastHeartbeat: new Date().toISOString() },
      })
      .where(eq(schema.booths.id, boothId));
  });

  socket.on(SocketEvents.PHOTO_UPLOADED, (raw: unknown) => {
    const parsed = photoUploadedSchema.safeParse(raw);
    if (!parsed.success) return;
    io.to(`booth:${boothId}`).emit(SocketEvents.PHOTO_TAKEN, parsed.data);
  });

  socket.on(SocketEvents.COMPOSITE_UPLOADED, (raw: unknown) => {
    const parsed = compositeUploadedSchema.safeParse(raw);
    if (!parsed.success) return;
    io.to(`booth:${boothId}`).emit(SocketEvents.COMPOSITE_READY, parsed.data);
  });

  socket.on(SocketEvents.PRINT_COMPLETED, (raw: unknown) => {
    const parsed = printCompletedSchema.safeParse(raw);
    if (!parsed.success) return;
    io.to(`booth:${boothId}`).emit(SocketEvents.PRINT_DONE, parsed.data);
  });

  socket.on(SocketEvents.BRIDGE_ERROR, (raw: unknown) => {
    logger.warn("bridge_error", { boothId, payload: raw });
    io.to(`booth:${boothId}`).emit(SocketEvents.ERROR, {
      code: "BRIDGE_ERROR",
      message: "Hardware booth bermasalah, mohon hubungi operator.",
    });
  });

  socket.on("disconnect", () => {
    io.to("admin:overview").emit(SocketEvents.ADMIN_BOOTH_STATUS, {
      boothId,
      online: false,
      inSession: false,
      lastSeenAt: new Date().toISOString(),
      bridgeOnline: false,
    });
  });
}
