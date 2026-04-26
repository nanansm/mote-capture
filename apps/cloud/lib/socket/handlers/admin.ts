import type { Server as IOServer, Socket } from "socket.io";
import { db, schema } from "@/lib/db";
import { SocketEvents } from "@capture/shared";

export function registerAdminHandlers(io: IOServer, socket: Socket): void {
  // Send a snapshot of all booth statuses on connect.
  void (async () => {
    const booths = await db.select().from(schema.booths);
    const offlineThresholdMs = 5 * 60 * 1000;
    for (const b of booths) {
      const online =
        b.lastSeenAt !== null && Date.now() - b.lastSeenAt.getTime() < offlineThresholdMs;
      const bridgeOnline = io.sockets.adapter.rooms.get(`bridge:${b.id}`)?.size ?? 0 > 0;
      socket.emit(SocketEvents.ADMIN_BOOTH_STATUS, {
        boothId: b.id,
        online: Boolean(online),
        inSession: false,
        lastSeenAt: b.lastSeenAt ? b.lastSeenAt.toISOString() : null,
        bridgeOnline: Boolean(bridgeOnline),
      });
    }
  })();
}
