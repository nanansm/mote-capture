import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { uploadObject } from "@/lib/storage/r2";
import { logger } from "@/lib/logger";
import { emitToBooth, emitToAdmin } from "@/lib/socket/server";
import { SocketEvents, MOCK_BRIDGE } from "@capture/shared";
import { generateCompositeSvg, generatePhotoSvg } from "./placeholder-photos";
import { notifySession } from "@/lib/notify";

const inFlight = new Set<string>();

// Simulates the bridge: every 8s captures a photo, then composes after the 3rd,
// then "prints" 5s later. Emits the same socket events the real bridge will.
export async function runMockBridgeForSession(opts: {
  sessionId: string;
  boothId: string;
}): Promise<void> {
  const { sessionId, boothId } = opts;
  if (inFlight.has(sessionId)) return;
  inFlight.add(sessionId);

  const [booth] = await db
    .select({ name: schema.booths.name })
    .from(schema.booths)
    .where(eq(schema.booths.id, boothId))
    .limit(1);
  const boothName = booth?.name ?? "Maja Photobooth";

  try {
    for (let i = 1; i <= 3; i++) {
      await wait(MOCK_BRIDGE.CAPTURE_DELAY_MS);
      const svg = generatePhotoSvg({ index: i, sessionId });
      const key = `sessions/${boothId}/${sessionId}/photo-${i}.svg`;
      const result = await uploadObject({
        key,
        body: Buffer.from(svg, "utf8"),
        contentType: "image/svg+xml",
      });
      await db.insert(schema.photos).values({
        id: randomUUID(),
        sessionId,
        url: result.url,
        isFinal: false,
        sortOrder: i,
      });
      await db
        .update(schema.sessions)
        .set({ photoCount: i, status: "capturing" })
        .where(eq(schema.sessions.id, sessionId));
      emitToBooth(boothId, SocketEvents.PHOTO_TAKEN, { sessionId, index: i, url: result.url });
      logger.info("mock_bridge_photo", { sessionId, index: i, key });
    }

    // Composite phase
    await db
      .update(schema.sessions)
      .set({ status: "processing" })
      .where(eq(schema.sessions.id, sessionId));
    emitToBooth(boothId, SocketEvents.STATE_CHANGE, {
      sessionId,
      state: "PROCESSING",
    });

    await wait(MOCK_BRIDGE.COMPOSITE_DELAY_MS);
    const compositeSvg = generateCompositeSvg({ sessionId, boothName });
    const compositeKey = `sessions/${boothId}/${sessionId}/composite.svg`;
    const compositeResult = await uploadObject({
      key: compositeKey,
      body: Buffer.from(compositeSvg, "utf8"),
      contentType: "image/svg+xml",
    });
    await db.insert(schema.photos).values({
      id: randomUUID(),
      sessionId,
      url: compositeResult.url,
      isFinal: true,
      sortOrder: 99,
    });

    const [session] = await db
      .select({ downloadToken: schema.sessions.downloadToken })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .limit(1);

    emitToBooth(boothId, SocketEvents.COMPOSITE_READY, {
      sessionId,
      url: compositeResult.url,
      downloadToken: session?.downloadToken ?? "",
    });
    logger.info("mock_bridge_composite", { sessionId, key: compositeKey });

    // Print phase
    await wait(MOCK_BRIDGE.PRINT_DELAY_MS);
    await db
      .update(schema.sessions)
      .set({ status: "done", printCompletedAt: new Date() })
      .where(eq(schema.sessions.id, sessionId));
    emitToBooth(boothId, SocketEvents.PRINT_DONE, { sessionId });
    emitToAdmin(SocketEvents.ADMIN_SESSION_UPDATE, {
      boothId,
      sessionId,
      status: "done",
      amount: 0, // not needed at this point
    });
    logger.info("mock_bridge_print_done", { sessionId });

    // Best-effort: trigger notifications if customer contact already saved.
    // No-op when phone/email are empty.
    try {
      await notifySession(sessionId);
    } catch (err) {
      logger.warn("mock_bridge_notify_failed", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  } catch (err) {
    logger.error("mock_bridge_failed", {
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
    emitToBooth(boothId, SocketEvents.ERROR, {
      code: "MOCK_BRIDGE",
      message: "Mock bridge gagal mensimulasikan capture.",
    });
  } finally {
    inFlight.delete(sessionId);
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
