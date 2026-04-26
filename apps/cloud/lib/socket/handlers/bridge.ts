import type { Server as IOServer, Socket } from "socket.io";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { logger } from "@/lib/logger";
import { SocketEvents, type FrameLayout } from "@capture/shared";
import {
  compositeUploadedSchema,
  photoUploadedSchema,
  printCompletedSchema,
} from "../events";
import { DEFAULT_LAYOUT_B } from "@/lib/validations/frame";

// In-memory cache of "photos uploaded so far per session" so that the cloud
// can fan-out the next BRIDGE_CAPTURE / BRIDGE_COMPOSITE / BRIDGE_PRINT event
// once enough photos have arrived. Keyed by sessionId.
const photoProgress = new Map<string, Set<number>>();

const TOTAL_PHOTOS = 3;

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

  socket.on(SocketEvents.BRIDGE_HELLO, (_raw: unknown) => {
    // Acknowledge but no-op — connection-level auth already validated boothId.
    logger.info("bridge_hello", { boothId, socketId: socket.id });
  });

  socket.on(SocketEvents.BRIDGE_HEARTBEAT, async (raw: unknown) => {
    const meta = (raw ?? {}) as Record<string, unknown>;
    // Pull existing metadata so we don't blow away unrelated keys (use_mock_bridge).
    const [existing] = await db
      .select({ metadata: schema.booths.metadata })
      .from(schema.booths)
      .where(eq(schema.booths.id, boothId))
      .limit(1);
    const merged = {
      ...((existing?.metadata as Record<string, unknown> | null) ?? {}),
      ...meta,
      lastHeartbeat: new Date().toISOString(),
    };
    await db
      .update(schema.booths)
      .set({ lastSeenAt: new Date(), metadata: merged })
      .where(eq(schema.booths.id, boothId));
  });

  socket.on(SocketEvents.PHOTO_UPLOADED, async (raw: unknown) => {
    const parsed = photoUploadedSchema.safeParse(raw);
    if (!parsed.success) return;
    const { sessionId, index } = parsed.data;
    io.to(`booth:${boothId}`).emit(SocketEvents.PHOTO_TAKEN, parsed.data);

    const progress = photoProgress.get(sessionId) ?? new Set<number>();
    progress.add(index);
    photoProgress.set(sessionId, progress);

    if (progress.size < TOTAL_PHOTOS) {
      // Ask bridge to capture the next photo.
      io.to(`bridge:${boothId}`).emit(SocketEvents.BRIDGE_CAPTURE, {
        sessionId,
        photoIndex: progress.size + 1,
      });
      return;
    }

    // All 3 photos arrived — dispatch composite.
    photoProgress.delete(sessionId);
    const composite = await buildCompositePayload(sessionId);
    if (!composite) {
      logger.warn("bridge_composite_payload_unavailable", { sessionId });
      return;
    }
    io.to(`bridge:${boothId}`).emit(SocketEvents.BRIDGE_COMPOSITE, composite);
  });

  socket.on(SocketEvents.COMPOSITE_UPLOADED, (raw: unknown) => {
    const parsed = compositeUploadedSchema.safeParse(raw);
    if (!parsed.success) return;
    io.to(`booth:${boothId}`).emit(SocketEvents.COMPOSITE_READY, parsed.data);
    // Tell the bridge to print.
    io.to(`bridge:${boothId}`).emit(SocketEvents.BRIDGE_PRINT, {
      sessionId: parsed.data.sessionId,
      compositeUrl: parsed.data.url,
    });
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

async function buildCompositePayload(sessionId: string): Promise<
  | {
      sessionId: string;
      frameId?: string;
      framePngUrl?: string;
      layoutJson: FrameLayout | typeof DEFAULT_LAYOUT_B;
      photos: Array<{ index: number; url: string }>;
    }
  | null
> {
  const [session] = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .limit(1);
  if (!session) return null;

  let frameId: string | undefined;
  let framePngUrl: string | undefined;
  let layout: FrameLayout | typeof DEFAULT_LAYOUT_B = DEFAULT_LAYOUT_B;
  if (session.frameId) {
    const [frame] = await db
      .select()
      .from(schema.frames)
      .where(eq(schema.frames.id, session.frameId))
      .limit(1);
    if (frame) {
      frameId = frame.id;
      framePngUrl = frame.backgroundUrl ?? undefined;
      const lj = frame.layoutJson as FrameLayout | null;
      if (lj && typeof lj === "object" && "photoSlots" in (lj as object)) {
        layout = lj;
      }
    }
  }

  const photos = await db
    .select({ url: schema.photos.url, sortOrder: schema.photos.sortOrder })
    .from(schema.photos)
    .where(eq(schema.photos.sessionId, sessionId));

  const photoList = photos
    .filter((p) => !!p.url && p.sortOrder >= 1 && p.sortOrder <= 3)
    .map((p) => ({ index: p.sortOrder, url: p.url }))
    .sort((a, b) => a.index - b.index);

  return {
    sessionId,
    frameId,
    framePngUrl,
    layoutJson: layout,
    photos: photoList,
  };
}
