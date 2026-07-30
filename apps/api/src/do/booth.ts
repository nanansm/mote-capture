// BoothDO — the realtime brain of a single photobooth. One Durable Object
// instance per `boothId` (routed via `env.BOOTH_DO.idFromName(boothId)`).
//
// Replaces the old apps/cloud Socket.io server. Ported behavior from:
//   - apps/cloud/lib/socket/handlers/kiosk.ts   (CONFIRM_AND_PAY/createSessionAndQr,
//     START_CAPTURE, SUBMIT_CONTACT, CANCEL)
//   - apps/cloud/lib/socket/handlers/bridge.ts  (photo/composite/print orchestration,
//     buildCompositePayload)
//   - apps/cloud/lib/kiosk/mock-bridge.ts       (mock capture/composite/print timing)
//
// Architecture rules this file exists to satisfy (see task spec):
//   1. BoothDO is the SOLE writer of `sessions`/`photos` — routes only read
//      those tables and call the RPC wrappers in `./rpc.ts`.
//   2. WebSocket Hibernation API only (`ctx.acceptWebSocket` +
//      `webSocketMessage`/`webSocketClose`/`webSocketError`) — never the
//      plain WebSocket accept + event-listener pattern, so idle kiosk/bridge
//      sockets don't burn Durable Object wall-clock quota.
//   3. No JS-timer-based delays for anything long-running (QR expiry,
//      mock-bridge timing) — everything goes through `ctx.storage.setAlarm()`
//      so the chain survives hibernation/eviction.
//   4. Photo-capture progress for the *real* bridge flow lives in DO storage
//      (`photosKey(sessionId)`), not an in-memory Map — that in-memory Map is
//      exactly the bug in the old app (progress lost on server restart).
//
// Storage keys used (all via `this.ctx.storage`, survives hibernation/restart):
//   - "boothId"            -> string, this DO's own booth id (set on first
//                              WebSocket upgrade from the URL the Worker forwarded).
//   - "alarm:task"          -> AlarmTask, describes what the next-firing alarm
//                              should do (QR expiry or the next mock-bridge step).
//                              There is at most one alarm per DO (setAlarm()
//                              always replaces the previous one), which is safe
//                              here because a booth only ever has one active
//                              (non-terminal) session at a time (enforced in
//                              handleConfirmAndPay).
//   - photosKey(sessionId)  -> number[], indices of photos received so far for
//                              the *real* bridge flow (drives BRIDGE_CAPTURE /
//                              BRIDGE_COMPOSITE fan-out in onPhotoUploaded).
//
// `sessions`/`photos` themselves remain the source of truth for status/counts —
// storage here only tracks orchestration state the DO needs between events.
import { DurableObject } from "cloudflare:workers";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { decode, encode, isPush, isRequest, MOCK_BRIDGE, SocketEvents, type FrameLayout } from "@capture/shared";
import type { Bindings } from "@/lib/env";
import { getEnv } from "@/lib/env";
import { getDb, schema } from "@/db";
import { getPaymentProvider } from "@/lib/payment";
import { resolveCredentials } from "@/lib/runtime-credentials";
import { generateDownloadToken, generateSessionId } from "@/lib/id";
import { getPublicUrl, sessionAssetKey, uploadObject } from "@/lib/storage";
import { notifySession } from "@/lib/notify";
import { DEFAULT_LAYOUT_B } from "@/lib/validations/frame";
import { logger } from "@/lib/logger";
import { adminBroadcast } from "@/do/rpc";

const TOTAL_PHOTOS = 3;

// ---------------------------------------------------------------------------
// Validation — ported from apps/cloud/lib/socket/events.ts, with `method`
// added to confirmAndPaySchema (the required fix: skip QR creation entirely
// when the customer pays with a voucher instead of QRIS).
// ---------------------------------------------------------------------------

const confirmAndPaySchema = z.object({
  boothId: z.string().min(1),
  frameId: z.string().min(1).optional(),
  method: z.enum(["qris", "voucher"]).default("qris"),
});

const startCaptureSchema = z.object({
  sessionId: z.string().min(1),
  // Which photo the kiosk wants shot now. Absent = 1, so an older kiosk build
  // that only ever asked for the first photo still starts a session.
  photoIndex: z.number().int().min(1).max(3).optional(),
});

const submitContactSchema = z.object({
  sessionId: z.string().min(1),
  phone: z.string().min(8).max(20),
  email: z.string().email().optional().or(z.literal("")),
});

const cancelSchema = z.object({
  sessionId: z.string().min(1).optional(),
  reason: z.string().optional(),
});

const printCompletedSchema = z.object({
  sessionId: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

type HandlerResult = { ok: true; data?: unknown } | { ok: false; error: string };

type AlarmTask =
  | { type: "qr_expiry"; sessionId: string }
  | { type: "mock_capture"; sessionId: string; index: number }
  | { type: "mock_composite"; sessionId: string }
  | { type: "mock_print"; sessionId: string };

function photosKey(sessionId: string): string {
  return `photos:${sessionId}`;
}

// Ported from apps/cloud/lib/session-helpers.ts#resolvePrice. `tier` is unused
// by the actual logic there (frame.price is always the source of truth when
// set), so the local port only needs `price`.
function resolvePrice(frame: { price: number } | null, boothDefaultPrice: number): number {
  if (!frame) return boothDefaultPrice;
  return frame.price > 0 ? frame.price : boothDefaultPrice;
}

// ---------------------------------------------------------------------------
// Mock-bridge placeholder assets — simplified port of
// apps/cloud/lib/kiosk/placeholder-photos.ts (SVG, not pixel-identical, just
// visually equivalent placeholders for the simulated capture/composite).
// ---------------------------------------------------------------------------

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function generatePlaceholderPhotoSvg(index: number, sessionId: string): string {
  const w = 800;
  const h = 600;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="100%" height="100%" fill="#F5E642"/>
  <g font-family="sans-serif" fill="#1A3A2A" text-anchor="middle">
    <text x="50%" y="45%" font-size="80" font-weight="800">PHOTO ${index}</text>
    <text x="50%" y="58%" font-size="28" opacity="0.6">${escapeXml(sessionId)}</text>
  </g>
</svg>`;
}

function generatePlaceholderCompositeSvg(sessionId: string, boothName: string): string {
  const w = 1800;
  const h = 1200;
  const colors = ["#F5E642", "#E8A598", "#86C67C"];
  const cells: string[] = [];
  for (let col = 0; col < 2; col++) {
    for (let row = 0; row < 3; row++) {
      const x = 40 + col * 840;
      const y = 40 + row * 390;
      cells.push(
        `<g transform="translate(${x},${y})"><rect width="760" height="360" rx="20" fill="${colors[row]}"/><text x="380" y="190" text-anchor="middle" font-size="40" font-weight="800" fill="#1A3A2A">PHOTO ${row + 1}</text></g>`,
      );
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="100%" height="100%" fill="#F5F0E8"/>
  ${cells.join("")}
  <text x="${w / 2}" y="${h - 16}" text-anchor="middle" font-size="24" font-weight="700" fill="#1A3A2A">${escapeXml(
    boothName.toUpperCase(),
  )} · MOTE CAPTURE</text>
</svg>`;
}

// ---------------------------------------------------------------------------
// BoothDO
// ---------------------------------------------------------------------------

export class BoothDO extends DurableObject<Bindings> {
  // -------------------------------------------------------------------
  // fetch() — WebSocket upgrade entrypoint only. The Worker
  // (src/index.ts) has already authenticated the caller (booth
  // active for kiosk; bridgeToken bearer match for bridge) before
  // forwarding here with the path rewritten to `/kiosk/:boothId` or
  // `/bridge/:boothId`.
  // -------------------------------------------------------------------
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const role = parts[0];
    const boothId = parts[1];
    if ((role !== "kiosk" && role !== "bridge") || !boothId) {
      return new Response("Not found", { status: 404 });
    }

    const db = getDb(this.env.DB);
    const [booth] = await db.select().from(schema.booths).where(eq(schema.booths.id, boothId)).limit(1);
    if (!booth) {
      return new Response("Booth not found", { status: 404 });
    }

    await this.ctx.storage.put("boothId", boothId);

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server, [role]);

    if (role === "kiosk") {
      // Sent synchronously, in-line with the upgrade itself — no
      // fire-and-forget async gap during which bridgeOnline could be stale
      // (the bug in the old apps/cloud handler).
      const useMockBridge =
        ((booth.metadata as Record<string, unknown> | null)?.use_mock_bridge as boolean | undefined) ?? true;
      const bridgeOnline = this.ctx.getWebSockets("bridge").length > 0;
      server.send(
        encode({
          ev: SocketEvents.KIOSK_READY,
          data: {
            boothId,
            boothName: booth.name,
            defaultPrice: booth.defaultPrice,
            bridgeOnline,
            useMockBridge,
          },
        }),
      );
      // Admin dashboard broadcast point (ADMIN_BOOTH_STATUS) — kiosk connect.
      // Ported from apps/cloud/lib/socket/server.ts:120-132. Awaited (not
      // fire-and-forget): this is inside fetch(), and any promise not
      // awaited before the 101 Response is returned risks being cancelled
      // by the runtime once the request context ends. adminBroadcast()
      // itself never throws (see src/do/rpc.ts), so this cannot fail the
      // upgrade.
      await adminBroadcast(this.env, SocketEvents.ADMIN_BOOTH_STATUS, {
        boothId,
        online: true,
        inSession: false,
        lastSeenAt: new Date().toISOString(),
        bridgeOnline,
      });
    } else {
      await db.update(schema.booths).set({ lastSeenAt: new Date() }).where(eq(schema.booths.id, boothId));
      // Admin dashboard broadcast point (ADMIN_BOOTH_STATUS) — bridge connect.
      // Ported from apps/cloud/lib/socket/handlers/bridge.ts:26-37.
      await adminBroadcast(this.env, SocketEvents.ADMIN_BOOTH_STATUS, {
        boothId,
        online: this.ctx.getWebSockets("kiosk").length > 0,
        inSession: false,
        lastSeenAt: new Date().toISOString(),
        bridgeOnline: true,
      });
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  // -------------------------------------------------------------------
  // Hibernatable WebSocket handlers — the only supported connection model here.
  // -------------------------------------------------------------------
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const raw = typeof message === "string" ? message : new TextDecoder().decode(message);
    const envelope = decode(raw);
    if (!envelope) return; // malformed frame — drop, never throw

    let ev: string;
    let data: unknown;
    let replyId: number | undefined;
    if (isRequest(envelope)) {
      ev = envelope.ev;
      data = envelope.data;
      replyId = envelope.id;
    } else if (isPush(envelope)) {
      ev = envelope.ev;
      data = envelope.data;
    } else {
      return; // a Reply arriving here has no meaning — drop
    }

    const tags = this.ctx.getTags(ws);
    const role = tags.includes("bridge") ? "bridge" : tags.includes("kiosk") ? "kiosk" : null;
    if (!role) return;

    const boothId = (await this.ctx.storage.get<string>("boothId")) ?? "";

    let result: HandlerResult;
    try {
      result = role === "kiosk" ? await this.dispatchKiosk(boothId, ev, data) : await this.dispatchBridge(boothId, ev, data);
    } catch (err) {
      const message2 = err instanceof Error ? err.message : "internal error";
      logger.error("booth_do_handler_failed", { boothId, role, ev, err: message2 });
      result = { ok: false, error: message2 };
    }

    if (replyId !== undefined) {
      ws.send(
        result.ok
          ? encode({ id: replyId, ok: true, data: result.data })
          : encode({ id: replyId, ok: false, error: result.error }),
      );
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    logger.info("booth_do_ws_close", { code, reason, wasClean, tags: this.ctx.getTags(ws) });
    await this.broadcastDisconnect(ws);
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    logger.warn("booth_do_ws_error", {
      tags: this.ctx.getTags(ws),
      err: error instanceof Error ? error.message : String(error),
    });
    await this.broadcastDisconnect(ws);
  }

  // Admin dashboard broadcast point (ADMIN_BOOTH_STATUS) — kiosk/bridge
  // disconnect. Ported from apps/cloud/lib/socket/server.ts:142-155 (kiosk)
  // and apps/cloud/lib/socket/handlers/bridge.ts:117-125 (bridge). Shared by
  // both webSocketClose and webSocketError since Cloudflare only guarantees
  // one of the two fires per closed socket, and either way the connection is
  // gone — the admin dashboard needs to know regardless of *how* it closed.
  private async broadcastDisconnect(ws: WebSocket): Promise<void> {
    const tags = this.ctx.getTags(ws);
    const boothId = (await this.ctx.storage.get<string>("boothId")) ?? "";
    if (!boothId) return;

    if (tags.includes("kiosk")) {
      await adminBroadcast(this.env, SocketEvents.ADMIN_BOOTH_STATUS, {
        boothId,
        online: false,
        inSession: false,
        lastSeenAt: new Date().toISOString(),
        bridgeOnline: this.ctx.getWebSockets("bridge").length > 0,
      });
    } else if (tags.includes("bridge")) {
      await adminBroadcast(this.env, SocketEvents.ADMIN_BOOTH_STATUS, {
        boothId,
        online: this.ctx.getWebSockets("kiosk").length > 0,
        inSession: false,
        lastSeenAt: new Date().toISOString(),
        bridgeOnline: false,
      });
    }
  }

  // -------------------------------------------------------------------
  // Dispatch
  // -------------------------------------------------------------------
  private async dispatchKiosk(boothId: string, ev: string, data: unknown): Promise<HandlerResult> {
    switch (ev) {
      case SocketEvents.CONFIRM_AND_PAY:
        return this.handleConfirmAndPay(boothId, data);
      case SocketEvents.START_CAPTURE:
        return this.handleStartCapture(boothId, data);
      case SocketEvents.SUBMIT_CONTACT:
        return this.handleSubmitContact(data);
      case SocketEvents.CANCEL:
        return this.handleCancel(boothId, data);
      default:
        return { ok: false, error: `Unknown kiosk event: ${ev}` };
    }
  }

  private async dispatchBridge(boothId: string, ev: string, data: unknown): Promise<HandlerResult> {
    switch (ev) {
      case SocketEvents.BRIDGE_HELLO:
        return this.handleBridgeHello(boothId, data);
      case SocketEvents.PRINT_COMPLETED:
        return this.handlePrintCompleted(boothId, data);
      case SocketEvents.BRIDGE_ERROR:
        return this.handleBridgeError(boothId, data);
      default:
        return { ok: false, error: `Unknown bridge event: ${ev}` };
    }
  }

  // -------------------------------------------------------------------
  // Kiosk handlers
  // -------------------------------------------------------------------

  // Ported from apps/cloud/lib/socket/handlers/kiosk.ts#createSessionAndQr +
  // the CONFIRM_AND_PAY handler. Required fix: `method` decides whether a QR
  // is created at all — a voucher-paying customer never needs one.
  private async handleConfirmAndPay(ownBoothId: string, raw: unknown): Promise<HandlerResult> {
    const parsed = confirmAndPaySchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid payload" };
    }
    if (parsed.data.boothId !== ownBoothId) {
      return { ok: false, error: "boothId mismatch" };
    }

    const db = getDb(this.env.DB);

    // One active (non-terminal) session per booth at a time — this is what
    // makes the single-alarm-per-DO design safe (QR expiry and mock-bridge
    // timers never need to coexist).
    //
    // A leftover session is only a real conflict once money has changed hands:
    // `paid`/`capturing`/`processing` means somebody is physically mid-session
    // at this booth. A session still sitting at `payment` (or `idle`) is an
    // abandoned checkout — the customer walked away, or the kiosk reloaded
    // before CANCEL was sent. Rejecting those would leave the booth unusable
    // until the QR expiry alarm fires (up to 5 minutes of lost sales), so we
    // retire them here and continue.
    const [existingActive] = await db
      .select({ id: schema.sessions.id, status: schema.sessions.status })
      .from(schema.sessions)
      .where(
        and(
          eq(schema.sessions.boothId, ownBoothId),
          sql`${schema.sessions.status} not in ('done','expired','failed')`,
        ),
      )
      .limit(1);
    if (existingActive) {
      if (existingActive.status !== "payment" && existingActive.status !== "idle") {
        return { ok: false, error: "Sesi lain sedang berlangsung di booth ini" };
      }
      await db
        .update(schema.sessions)
        .set({ status: "expired" })
        .where(eq(schema.sessions.id, existingActive.id));
      // Drop the alarm that belonged to the abandoned session so it cannot
      // fire against the session we are about to create.
      const pending = await this.ctx.storage.get<AlarmTask>("alarm:task");
      if (pending && "sessionId" in pending && pending.sessionId === existingActive.id) {
        await this.ctx.storage.delete("alarm:task");
        await this.ctx.storage.deleteAlarm();
      }
      logger.info("booth_abandoned_session_retired", {
        boothId: ownBoothId,
        sessionId: existingActive.id,
        previousStatus: existingActive.status,
      });
    }

    const [booth] = await db.select().from(schema.booths).where(eq(schema.booths.id, ownBoothId)).limit(1);
    if (!booth) return { ok: false, error: "Booth tidak ditemukan" };

    let frame: typeof schema.frames.$inferSelect | undefined;
    if (parsed.data.frameId) {
      const [row] = await db.select().from(schema.frames).where(eq(schema.frames.id, parsed.data.frameId)).limit(1);
      if (!row || !row.isActive) return { ok: false, error: "Frame tidak tersedia" };
      if (row.boothId && row.boothId !== ownBoothId) {
        return { ok: false, error: "Frame tidak dipasang untuk booth ini" };
      }
      frame = row;
    }

    const amount = resolvePrice(frame ? { price: frame.price } : null, booth.defaultPrice);
    const sessionId = generateSessionId();
    const downloadToken = generateDownloadToken();
    const cfg = getEnv(this.env);
    const downloadExpiresAt = new Date(Date.now() + cfg.DOWNLOAD_LINK_EXPIRY_DAYS * 86_400_000);

    let qrString: string | null = null;
    let paymentRef: string | null = null;
    let expiresAt: Date;
    let mockMode = false;

    if (parsed.data.method === "voucher") {
      // No QR — the kiosk collects a voucher code and redeems it via the
      // public HTTP endpoint (/api/voucher/redeem), which calls markPaid.
      // Still bounded by a timeout so an abandoned VOUCHER_INPUT session
      // doesn't linger forever — reuses the same qr_expiry alarm path.
      expiresAt = new Date(Date.now() + 5 * 60_000);
    } else {
      const { xendit } = await resolveCredentials(db, this.env);
      const provider = getPaymentProvider(
        booth.paymentProvider as "xendit" | "ipaymu",
        this.env,
        xendit,
      );
      const qr = await provider.createQR({ sessionId, amount, expiresInMinutes: 5 });
      qrString = qr.qrString;
      paymentRef = qr.providerRef;
      expiresAt = qr.expiresAt;
      mockMode = qr.mockMode ?? false;
    }

    await db.insert(schema.sessions).values({
      id: sessionId,
      boothId: ownBoothId,
      frameId: frame?.id ?? null,
      status: "payment",
      amount,
      paymentProvider: booth.paymentProvider,
      paymentRef,
      qrString,
      downloadToken,
      downloadExpiresAt,
      expiredAt: expiresAt,
    });

    await db.insert(schema.paymentLogs).values({
      sessionId,
      provider: parsed.data.method === "voucher" ? "voucher" : booth.paymentProvider,
      eventType: parsed.data.method === "voucher" ? "voucher_pending" : "qr_created",
      payload: { providerRef: paymentRef, amount, mock: mockMode, method: parsed.data.method },
    });

    await this.ctx.storage.put<AlarmTask>("alarm:task", { type: "qr_expiry", sessionId });
    await this.ctx.storage.setAlarm(expiresAt.getTime());

    // Admin dashboard broadcast point (ADMIN_SESSION_UPDATE) — session
    // created. Ported from apps/cloud/lib/socket/handlers/kiosk.ts:67-72.
    await adminBroadcast(this.env, SocketEvents.ADMIN_SESSION_UPDATE, {
      boothId: ownBoothId,
      sessionId,
      status: "payment",
      amount,
    });

    return {
      ok: true,
      data: {
        sessionId,
        qrString,
        amount,
        expiresAt: expiresAt.toISOString(),
        mockMode,
        method: parsed.data.method,
      },
    };
  }

  // Ported from apps/cloud/lib/socket/handlers/kiosk.ts START_CAPTURE handler.
  //
  // The kiosk asks for EACH photo, not just the first. Pacing belongs to the
  // kiosk because that is where the human-facing countdown lives: the shutter
  // has to fire on the same beat as the "CHEESE!" the guest is reading. The DO
  // used to auto-cascade the next photo the instant the previous upload landed
  // (see onPhotoUploaded), which on the Sony/UVC driver — where capture() just
  // grabs the newest in-memory frame — fired all three shots milliseconds
  // apart while the kiosk was still animating a 3-2-1 that had already been
  // overtaken. The DO stays the authority on WHICH photo is next; it just no
  // longer decides WHEN.
  private async handleStartCapture(ownBoothId: string, raw: unknown): Promise<HandlerResult> {
    const parsed = startCaptureSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: "invalid payload" };
    const { sessionId } = parsed.data;
    const photoIndex = parsed.data.photoIndex ?? 1;

    const db = getDb(this.env.DB);
    const [session] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).limit(1);
    if (!session || session.boothId !== ownBoothId) return { ok: false, error: "session not found" };

    const [booth] = await db.select().from(schema.booths).where(eq(schema.booths.id, ownBoothId)).limit(1);
    const useMock =
      ((booth?.metadata as Record<string, unknown> | null)?.use_mock_bridge as boolean | undefined) ?? true;

    // Photos 2 and 3: the session is already running, so validate against the
    // uploads we have rather than payment status.
    if (photoIndex > 1) {
      if (session.status !== "capturing") {
        return { ok: false, error: `session not capturing (current: ${session.status})` };
      }
      // Mock bridge paces itself through alarms — the kiosk's per-photo asks
      // are redundant there, so acknowledge and drop them.
      if (useMock) return { ok: true, data: { mockMode: true, ignored: true } };

      const received = new Set<number>((await this.ctx.storage.get<number[]>(photosKey(sessionId))) ?? []);
      // Already have it: a retry or a re-render asking twice. Acknowledge so
      // the kiosk doesn't surface an error and tear down a live session.
      if (received.has(photoIndex)) return { ok: true, data: { mockMode: false, ignored: true } };
      const expected = received.size + 1;
      if (photoIndex !== expected) {
        return { ok: false, error: `out of order photo (expected ${expected}, got ${photoIndex})` };
      }

      this.pushToBridge(SocketEvents.BRIDGE_CAPTURE, { sessionId, photoIndex });
      return { ok: true, data: { mockMode: false } };
    }

    if (session.status !== "paid") {
      return { ok: false, error: `session not paid (current: ${session.status})` };
    }

    await db.update(schema.sessions).set({ status: "capturing" }).where(eq(schema.sessions.id, sessionId));
    await this.ctx.storage.put(photosKey(sessionId), [] as number[]);

    if (useMock) {
      await this.ctx.storage.put<AlarmTask>("alarm:task", { type: "mock_capture", sessionId, index: 1 });
      await this.ctx.storage.setAlarm(Date.now() + MOCK_BRIDGE.CAPTURE_DELAY_MS);
    } else {
      // Real bridge — photo 1. Photos 2 and 3 arrive as their own requests
      // when the kiosk reaches each CHEESE.
      this.pushToBridge(SocketEvents.BRIDGE_CAPTURE, { sessionId, photoIndex: 1 });
    }

    return { ok: true, data: { mockMode: useMock } };
  }

  private async handleSubmitContact(raw: unknown): Promise<HandlerResult> {
    const parsed = submitContactSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid" };
    const { sessionId, phone, email } = parsed.data;

    const db = getDb(this.env.DB);
    const [session] = await db
      .select({ id: schema.sessions.id })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .limit(1);
    if (!session) return { ok: false, error: "session not found" };

    await db
      .update(schema.sessions)
      .set({ customerPhone: phone, customerEmail: email || null })
      .where(eq(schema.sessions.id, sessionId));

    try {
      const result = await notifySession(this.env, sessionId);
      return { ok: true, data: result };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "notify failed" };
    }
  }

  private async handleCancel(ownBoothId: string, raw: unknown): Promise<HandlerResult> {
    const parsed = cancelSchema.safeParse(raw ?? {});
    const sessionId = parsed.success ? parsed.data.sessionId : undefined;

    if (sessionId) {
      const db = getDb(this.env.DB);
      const [session] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).limit(1);
      if (session && session.boothId === ownBoothId && session.status !== "done") {
        await db.update(schema.sessions).set({ status: "expired" }).where(eq(schema.sessions.id, sessionId));
        await this.clearScheduledWork(sessionId);
        // Admin dashboard broadcast point (ADMIN_SESSION_UPDATE) — session
        // expired (cancelled by kiosk).
        await adminBroadcast(this.env, SocketEvents.ADMIN_SESSION_UPDATE, {
          boothId: ownBoothId,
          sessionId,
          status: "expired",
          amount: session.amount,
        });
      }
    }

    this.pushToKiosk(SocketEvents.RESET, { sessionId });
    return { ok: true };
  }

  // -------------------------------------------------------------------
  // Bridge handlers
  // -------------------------------------------------------------------

  private async handleBridgeHello(boothId: string, raw: unknown): Promise<HandlerResult> {
    logger.info("bridge_hello", { boothId, raw });
    return { ok: true };
  }

  // Ported from apps/cloud/lib/socket/handlers/bridge.ts PRINT_COMPLETED.
  private async handlePrintCompleted(ownBoothId: string, raw: unknown): Promise<HandlerResult> {
    const parsed = printCompletedSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: "invalid payload" };
    const { sessionId } = parsed.data;

    const db = getDb(this.env.DB);
    const [session] = await db
      .select({ boothId: schema.sessions.boothId, amount: schema.sessions.amount })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .limit(1);
    if (!session || session.boothId !== ownBoothId) return { ok: false, error: "session not found" };

    await db
      .update(schema.sessions)
      .set({ status: "done", printCompletedAt: new Date() })
      .where(eq(schema.sessions.id, sessionId));

    this.pushToKiosk(SocketEvents.PRINT_DONE, { sessionId });
    await this.clearScheduledWork(sessionId);
    // Admin dashboard broadcast point (ADMIN_SESSION_UPDATE) — session done
    // (real-bridge print completed).
    await adminBroadcast(this.env, SocketEvents.ADMIN_SESSION_UPDATE, {
      boothId: ownBoothId,
      sessionId,
      status: "done",
      amount: session.amount,
    });
    return { ok: true };
  }

  private async handleBridgeError(boothId: string, raw: unknown): Promise<HandlerResult> {
    logger.warn("bridge_error", { boothId, payload: raw });
    this.pushToKiosk(SocketEvents.ERROR, {
      code: "BRIDGE_ERROR",
      message: "Hardware booth bermasalah, mohon hubungi operator.",
    });
    return { ok: true };
  }

  // -------------------------------------------------------------------
  // RPC methods — called by the Worker via src/do/rpc.ts, never directly by
  // routes. `boothId` is passed explicitly by the caller (it already knows
  // it — that's how it built the DO stub) rather than trusted from storage.
  // -------------------------------------------------------------------

  async markPaid(boothId: string, sessionId: string, meta?: Record<string, unknown>): Promise<void> {
    const db = getDb(this.env.DB);
    const [session] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).limit(1);
    if (!session || session.boothId !== boothId) {
      logger.warn("booth_do_mark_paid_session_mismatch", { boothId, sessionId });
      return;
    }
    if (session.status !== "payment") {
      logger.info("booth_do_mark_paid_noop", { boothId, sessionId, status: session.status });
      return;
    }

    await db.update(schema.sessions).set({ status: "paid", paidAt: new Date() }).where(eq(schema.sessions.id, sessionId));
    await this.clearScheduledWork(sessionId);
    this.pushToKiosk(SocketEvents.PAYMENT_PAID, {
      sessionId,
      amount: session.amount,
      paidAt: new Date().toISOString(),
    });
    // Admin dashboard broadcast point (ADMIN_SESSION_UPDATE) — session paid.
    await adminBroadcast(this.env, SocketEvents.ADMIN_SESSION_UPDATE, {
      boothId,
      sessionId,
      status: "paid",
      amount: session.amount,
    });
    logger.info("booth_do_mark_paid", { boothId, sessionId, meta });
  }

  async markExpired(boothId: string, sessionId: string): Promise<void> {
    const db = getDb(this.env.DB);
    const [session] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).limit(1);
    if (!session || session.boothId !== boothId) return;
    if (session.status !== "payment") return;

    await db.update(schema.sessions).set({ status: "expired" }).where(eq(schema.sessions.id, sessionId));
    await this.clearScheduledWork(sessionId);
    this.pushToKiosk(SocketEvents.PAYMENT_EXPIRED, { sessionId });
    // Admin dashboard broadcast point (ADMIN_SESSION_UPDATE) — session
    // expired (marked by the webhook path, e.g. payment provider callback).
    await adminBroadcast(this.env, SocketEvents.ADMIN_SESSION_UPDATE, {
      boothId,
      sessionId,
      status: "expired",
      amount: session.amount,
    });
    logger.info("booth_do_mark_expired", { boothId, sessionId });
  }

  // T2.10: admin "force reset" action, called via src/do/rpc.ts#forceReset
  // (never directly by a route). Ported from
  // apps/cloud/app/api/session/[id]/reset/route.ts, which wrote
  // `sessions.status='failed'` and `emitToBooth(...RESET...)` directly — the
  // status write and kiosk broadcast now happen here since BoothDO is the
  // sole writer of `sessions`. A `done` session is left untouched (matches
  // the old route's `if (session.status !== "done")` guard) but the kiosk
  // still gets the RESET push either way, same as before.
  async forceReset(boothId: string, sessionId: string, byEmail: string): Promise<void> {
    const db = getDb(this.env.DB);
    const [session] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).limit(1);
    if (!session || session.boothId !== boothId) {
      logger.warn("booth_do_force_reset_session_mismatch", { boothId, sessionId });
      return;
    }

    if (session.status !== "done") {
      await db.update(schema.sessions).set({ status: "failed" }).where(eq(schema.sessions.id, sessionId));
    }
    await this.clearScheduledWork(sessionId);

    this.pushToKiosk(SocketEvents.RESET, {
      sessionId,
      reason: `force-reset by ${byEmail}`,
    });
    // Admin dashboard broadcast point (ADMIN_SESSION_UPDATE) — session
    // force-reset by admin.
    await adminBroadcast(this.env, SocketEvents.ADMIN_SESSION_UPDATE, {
      boothId,
      sessionId,
      status: session.status !== "done" ? "failed" : session.status,
      amount: session.amount,
    });
    logger.info("booth_do_force_reset", { boothId, sessionId, byEmail });
  }

  // T2.10: admin manual-refund action, called via src/do/rpc.ts#refundSession
  // (never directly by a route). Ported from
  // apps/cloud/app/api/session/[id]/refund/route.ts, which wrote
  // `sessions.status='failed'` plus a refund-metadata blob directly — that
  // write now happens here since BoothDO is the sole writer of `sessions`.
  // Sprint-2 behavior only: records the refund intent, no real payment
  // provider refund call yet, no kiosk broadcast (the old route didn't emit
  // one either). Silently no-ops (matching markPaid/markExpired's pattern)
  // if the session isn't in a refundable state — the route already checked
  // this before calling in, so this is only a defense against a race.
  async refundSession(boothId: string, sessionId: string, input: { reason: string; byEmail: string }): Promise<void> {
    const db = getDb(this.env.DB);
    const [session] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).limit(1);
    if (!session || session.boothId !== boothId) {
      logger.warn("booth_do_refund_session_mismatch", { boothId, sessionId });
      return;
    }
    if (session.status !== "paid" && session.status !== "capturing" && session.status !== "processing") {
      logger.info("booth_do_refund_noop", { boothId, sessionId, status: session.status });
      return;
    }

    await db
      .update(schema.sessions)
      .set({
        status: "failed",
        metadata: {
          ...(session.metadata as object),
          refundReason: input.reason,
          refundedAt: new Date().toISOString(),
          refundedBy: input.byEmail,
        },
      })
      .where(eq(schema.sessions.id, sessionId));
    await this.clearScheduledWork(sessionId);

    // Admin dashboard broadcast point (ADMIN_SESSION_UPDATE) — session
    // refunded. Not present in the old route (no Socket.io emit at all
    // there); added for parity with every other status transition in this
    // file so the admin dashboard doesn't miss it.
    await adminBroadcast(this.env, SocketEvents.ADMIN_SESSION_UPDATE, {
      boothId,
      sessionId,
      status: "failed",
      amount: session.amount,
    });
    logger.info("booth_do_refund_session", { boothId, sessionId, byEmail: input.byEmail });
  }

  // Real-bridge flow only. Progress (`photosKey`) lives in DO storage, so a
  // kiosk disconnect/reconnect (or DO eviction) mid-capture never resets it.
  async onPhotoUploaded(boothId: string, input: { sessionId: string; index: number; r2Key: string }): Promise<void> {
    const { sessionId, index, r2Key } = input;
    const db = getDb(this.env.DB);
    const [session] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).limit(1);
    if (!session || session.boothId !== boothId) {
      logger.warn("booth_do_photo_uploaded_session_mismatch", { boothId, sessionId });
      return;
    }

    await db.insert(schema.photos).values({ id: crypto.randomUUID(), sessionId, r2Key, isFinal: false, sortOrder: index });
    await db.update(schema.sessions).set({ photoCount: index, status: "capturing" }).where(eq(schema.sessions.id, sessionId));

    const cdn = getEnv(this.env).PUBLIC_CDN_URL;
    this.pushToKiosk(SocketEvents.PHOTO_TAKEN, { sessionId, index, url: getPublicUrl(cdn, r2Key) });

    const key = photosKey(sessionId);
    const received = new Set<number>((await this.ctx.storage.get<number[]>(key)) ?? []);
    received.add(index);
    await this.ctx.storage.put(key, Array.from(received));

    // Not done yet: stop here and let the kiosk ask for the next photo when it
    // reaches that photo's CHEESE (see handleStartCapture). Firing the next
    // BRIDGE_CAPTURE from here is what made all three shots land in the same
    // instant on the UVC driver, with the countdown animating over a shutter
    // that had already gone off. A kiosk that dies mid-session now stalls
    // instead of blind-capturing and printing a strip nobody is standing for.
    if (received.size < TOTAL_PHOTOS) return;

    await db.update(schema.sessions).set({ status: "processing" }).where(eq(schema.sessions.id, sessionId));
    const composite = await this.buildCompositePayload(sessionId);
    if (!composite) {
      logger.warn("booth_do_composite_payload_unavailable", { sessionId });
      return;
    }
    this.pushToBridge(SocketEvents.BRIDGE_COMPOSITE, composite);
  }

  async onCompositeUploaded(boothId: string, input: { sessionId: string; r2Key: string }): Promise<void> {
    const { sessionId, r2Key } = input;
    const db = getDb(this.env.DB);
    const [session] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).limit(1);
    if (!session || session.boothId !== boothId) return;

    await db.insert(schema.photos).values({ id: crypto.randomUUID(), sessionId, r2Key, isFinal: true, sortOrder: 99 });

    const cdn = getEnv(this.env).PUBLIC_CDN_URL;
    const url = getPublicUrl(cdn, r2Key);
    this.pushToKiosk(SocketEvents.COMPOSITE_READY, { sessionId, url, downloadToken: session.downloadToken ?? "" });
    this.pushToBridge(SocketEvents.BRIDGE_PRINT, { sessionId, compositeUrl: url });
    await this.ctx.storage.delete(photosKey(sessionId));
  }

  async setContact(boothId: string, input: { sessionId: string; phone: string; email?: string }): Promise<void> {
    const db = getDb(this.env.DB);
    const [session] = await db
      .select({ id: schema.sessions.id, boothId: schema.sessions.boothId })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, input.sessionId))
      .limit(1);
    if (!session || session.boothId !== boothId) return;

    await db
      .update(schema.sessions)
      .set({ customerPhone: input.phone, customerEmail: input.email || null })
      .where(eq(schema.sessions.id, input.sessionId));
  }

  // Used by AdminDO (src/do/admin.ts) to build the admin dashboard's
  // connect-time snapshot — see sendSnapshot() there.
  async getStatus(
    boothId: string,
  ): Promise<{ bridgeOnline: boolean; kioskOnline: boolean; currentSessionId: string | null; status: string | null }> {
    const db = getDb(this.env.DB);
    const [session] = await db
      .select({ id: schema.sessions.id, status: schema.sessions.status })
      .from(schema.sessions)
      .where(and(eq(schema.sessions.boothId, boothId), sql`${schema.sessions.status} not in ('done','expired','failed')`))
      .orderBy(desc(schema.sessions.createdAt))
      .limit(1);

    return {
      bridgeOnline: this.ctx.getWebSockets("bridge").length > 0,
      kioskOnline: this.ctx.getWebSockets("kiosk").length > 0,
      currentSessionId: session?.id ?? null,
      status: session?.status ?? null,
    };
  }

  // -------------------------------------------------------------------
  // alarm() — the only entrypoint for scheduled work. Dispatches on the
  // `alarm:task` storage key, which is what makes the chain resumable after
  // hibernation/eviction (a bare in-memory JS timer would not survive it).
  // -------------------------------------------------------------------
  async alarm(): Promise<void> {
    const task = await this.ctx.storage.get<AlarmTask>("alarm:task");
    if (!task) return;

    switch (task.type) {
      case "qr_expiry":
        await this.runQrExpiry(task.sessionId);
        break;
      case "mock_capture":
        await this.runMockCapture(task.sessionId, task.index);
        break;
      case "mock_composite":
        await this.runMockComposite(task.sessionId);
        break;
      case "mock_print":
        await this.runMockPrint(task.sessionId);
        break;
    }
  }

  private async runQrExpiry(sessionId: string): Promise<void> {
    await this.ctx.storage.delete("alarm:task");

    const db = getDb(this.env.DB);
    const [session] = await db
      .select({ boothId: schema.sessions.boothId, status: schema.sessions.status, amount: schema.sessions.amount })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .limit(1);
    if (!session || session.status !== "payment") return; // already paid/cancelled — nothing to do

    await db.update(schema.sessions).set({ status: "expired" }).where(eq(schema.sessions.id, sessionId));
    this.pushToKiosk(SocketEvents.PAYMENT_EXPIRED, { sessionId });
    // Admin dashboard broadcast point (ADMIN_SESSION_UPDATE) — session
    // expired (QR timed out).
    await adminBroadcast(this.env, SocketEvents.ADMIN_SESSION_UPDATE, {
      boothId: session.boothId,
      sessionId,
      status: "expired",
      amount: session.amount,
    });
    logger.info("booth_do_qr_expired", { boothId: session.boothId, sessionId });
  }

  private async runMockCapture(sessionId: string, index: number): Promise<void> {
    const db = getDb(this.env.DB);
    const [session] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).limit(1);
    if (!session || session.status !== "capturing") {
      await this.ctx.storage.delete("alarm:task");
      return; // session cancelled/expired mid-chain
    }

    const boothId = session.boothId;
    const svg = generatePlaceholderPhotoSvg(index, sessionId);
    const key = sessionAssetKey(boothId, sessionId, `photo-${index}.svg`);
    await uploadObject(this.env.BUCKET, { key, body: new TextEncoder().encode(svg), contentType: "image/svg+xml" });
    await db.insert(schema.photos).values({ id: crypto.randomUUID(), sessionId, r2Key: key, isFinal: false, sortOrder: index });
    await db.update(schema.sessions).set({ photoCount: index }).where(eq(schema.sessions.id, sessionId));

    const cdn = getEnv(this.env).PUBLIC_CDN_URL;
    this.pushToKiosk(SocketEvents.PHOTO_TAKEN, { sessionId, index, url: getPublicUrl(cdn, key) });

    if (index < TOTAL_PHOTOS) {
      await this.ctx.storage.put<AlarmTask>("alarm:task", { type: "mock_capture", sessionId, index: index + 1 });
      await this.ctx.storage.setAlarm(Date.now() + MOCK_BRIDGE.CAPTURE_DELAY_MS);
      return;
    }

    await db.update(schema.sessions).set({ status: "processing" }).where(eq(schema.sessions.id, sessionId));
    this.pushToKiosk(SocketEvents.STATE_CHANGE, { sessionId, state: "PROCESSING" });
    await this.ctx.storage.put<AlarmTask>("alarm:task", { type: "mock_composite", sessionId });
    await this.ctx.storage.setAlarm(Date.now() + MOCK_BRIDGE.COMPOSITE_DELAY_MS);
  }

  private async runMockComposite(sessionId: string): Promise<void> {
    const db = getDb(this.env.DB);
    const [session] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).limit(1);
    if (!session) {
      await this.ctx.storage.delete("alarm:task");
      return;
    }

    const [booth] = await db.select({ name: schema.booths.name }).from(schema.booths).where(eq(schema.booths.id, session.boothId)).limit(1);
    const svg = generatePlaceholderCompositeSvg(sessionId, booth?.name ?? "Mote Capture");
    const key = sessionAssetKey(session.boothId, sessionId, "composite.svg");
    await uploadObject(this.env.BUCKET, { key, body: new TextEncoder().encode(svg), contentType: "image/svg+xml" });
    await db.insert(schema.photos).values({ id: crypto.randomUUID(), sessionId, r2Key: key, isFinal: true, sortOrder: 99 });

    const cdn = getEnv(this.env).PUBLIC_CDN_URL;
    this.pushToKiosk(SocketEvents.COMPOSITE_READY, {
      sessionId,
      url: getPublicUrl(cdn, key),
      downloadToken: session.downloadToken ?? "",
    });

    await this.ctx.storage.put<AlarmTask>("alarm:task", { type: "mock_print", sessionId });
    await this.ctx.storage.setAlarm(Date.now() + MOCK_BRIDGE.PRINT_DELAY_MS);
  }

  private async runMockPrint(sessionId: string): Promise<void> {
    await this.ctx.storage.delete("alarm:task");

    const db = getDb(this.env.DB);
    // boothId + amount are only read here for the admin broadcast below —
    // the actual status transition (next line) doesn't need them.
    const [session] = await db
      .select({ boothId: schema.sessions.boothId, amount: schema.sessions.amount })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .limit(1);
    await db.update(schema.sessions).set({ status: "done", printCompletedAt: new Date() }).where(eq(schema.sessions.id, sessionId));
    this.pushToKiosk(SocketEvents.PRINT_DONE, { sessionId });
    logger.info("booth_do_mock_print_done", { sessionId });

    if (session) {
      // Admin dashboard broadcast point (ADMIN_SESSION_UPDATE) — session
      // done (mock-bridge print completed).
      await adminBroadcast(this.env, SocketEvents.ADMIN_SESSION_UPDATE, {
        boothId: session.boothId,
        sessionId,
        status: "done",
        amount: session.amount,
      });
    }

    // Best-effort, matches apps/cloud/lib/kiosk/mock-bridge.ts.
    try {
      await notifySession(this.env, sessionId);
    } catch (err) {
      logger.warn("booth_do_mock_notify_failed", { sessionId, err: err instanceof Error ? err.message : String(err) });
    }
  }

  // -------------------------------------------------------------------
  // Shared helpers
  // -------------------------------------------------------------------

  private async clearScheduledWork(sessionId: string): Promise<void> {
    const task = await this.ctx.storage.get<AlarmTask>("alarm:task");
    if (task && task.sessionId === sessionId) {
      await this.ctx.storage.delete("alarm:task");
      await this.ctx.storage.deleteAlarm();
    }
    await this.ctx.storage.delete(photosKey(sessionId));
  }

  private pushToKiosk(ev: string, data: unknown): void {
    for (const ws of this.ctx.getWebSockets("kiosk")) {
      try {
        ws.send(encode({ ev, data }));
      } catch (err) {
        logger.warn("booth_do_push_kiosk_failed", { ev, err: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  private pushToBridge(ev: string, data: unknown): void {
    for (const ws of this.ctx.getWebSockets("bridge")) {
      try {
        ws.send(encode({ ev, data }));
      } catch (err) {
        logger.warn("booth_do_push_bridge_failed", { ev, err: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  // Ported from apps/cloud/lib/socket/handlers/bridge.ts#buildCompositePayload.
  private async buildCompositePayload(sessionId: string): Promise<
    | {
        sessionId: string;
        frameId?: string;
        framePngUrl?: string;
        layoutJson: FrameLayout;
        photos: Array<{ index: number; url: string }>;
      }
    | null
  > {
    const db = getDb(this.env.DB);
    const [session] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).limit(1);
    if (!session) return null;

    const cdn = getEnv(this.env).PUBLIC_CDN_URL;
    let frameId: string | undefined;
    let framePngUrl: string | undefined;
    let layout: FrameLayout = DEFAULT_LAYOUT_B;

    if (session.frameId) {
      const [frame] = await db.select().from(schema.frames).where(eq(schema.frames.id, session.frameId)).limit(1);
      if (frame) {
        frameId = frame.id;
        framePngUrl = frame.backgroundKey ? getPublicUrl(cdn, frame.backgroundKey) : undefined;
        const lj = frame.layoutJson as FrameLayout | null;
        if (lj && typeof lj === "object" && Array.isArray(lj.photoSlots) && lj.photoSlots.length > 0) {
          layout = lj;
        }
      }
    }

    const rows = await db
      .select({ r2Key: schema.photos.r2Key, sortOrder: schema.photos.sortOrder })
      .from(schema.photos)
      .where(eq(schema.photos.sessionId, sessionId));

    const photoList = rows
      .filter((p) => p.sortOrder >= 1 && p.sortOrder <= 3)
      .map((p) => ({ index: p.sortOrder, url: getPublicUrl(cdn, p.r2Key) }))
      .sort((a, b) => a.index - b.index);

    return { sessionId, frameId, framePngUrl, layoutJson: layout, photos: photoList };
  }
}
