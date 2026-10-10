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
import {
  BUSY_SESSION_STATUSES,
  type RefundReason,
  decode,
  encode,
  isPush,
  isRequest,
  REDEEM_LIMITS,
  SESSION_TIMING,
  SocketEvents,
  TERMINAL_SESSION_STATUSES,
  type ActiveSessionSnapshot,
  type KioskReadyPayload,
  type SessionStatus,
} from "@capture/shared";
import type { Bindings } from "@/lib/env";
import { getEnv } from "@/lib/env";
import { getDb, schema } from "@/db";
import { XenditProvider, type PaymentProvider } from "@/lib/payment";
import { isLocalDev, loadAccount } from "@/lib/payment-accounts";
import { generateDownloadToken, generateSessionId } from "@/lib/id";
import { notifySession } from "@/lib/notify";
import { logger } from "@/lib/logger";
import { adminBroadcast } from "@/do/rpc";
import { issueAutoVoucher, type AutoVoucherSource } from "@/lib/auto-voucher";

// Agent menganggap online kalau heartbeat HTTP terakhir < 2 menit.
const AGENT_ONLINE_MS = 2 * 60 * 1000;

// SQL fragment: daftar status terminal, dipakai `not in` untuk cari sesi hidup.
const TERMINAL_STATUS_SQL = sql.raw(
  `(${TERMINAL_SESSION_STATUSES.map((st) => `'${st}'`).join(",")})`,
);

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

// PRD bagian 8 #2: capture:start dikirim SEKALI per sesi. Progres per foto
// (termasuk retake) milik agent, bukan DO. Field lain (photoIndex dari kiosk
// lama) dibuang zod.
const startCaptureSchema = z.object({
  sessionId: z.string().min(1),
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

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

type HandlerResult =
  | { ok: true; data?: unknown }
  | { ok: false; error: string; code?: string; releasesAt?: string | null };

// Satu alarm per DO (satu sesi aktif per booth). PRD bagian 7.
type AlarmTask =
  | { type: "qr_expiry"; sessionId: string }
  | { type: "paid_timeout"; sessionId: string }
  | { type: "capture_timeout"; sessionId: string };

export type MarkDoneResult =
  | { ok: true; status: "done"; disabledVoucherId?: string }
  | { ok: false; code: "SESSION_STALE" | "INVALID_STATE" | "NOT_FOUND"; status?: string };

export type CancelVoucherResult =
  | { ok: true; voucherId: string; code: string; created: boolean }
  | { ok: false; code: "INVALID_STATE" | "NOT_FOUND"; status?: string };

export type RefundInput = { reasonCode: RefundReason; reason: string; byEmail: string };

export type RefundResult =
  | { ok: true; status: "done" | "failed" }
  | { ok: false; code: "ALREADY_REFUNDED" | "INVALID_STATE" | "NOT_FOUND"; status?: string };

export type PrintStatusInput = {
  sessionId: string;
  sheet: number;
  state: "queued" | "printing" | "done" | "failed";
  cupsJobId?: number | string | null;
  error?: string | null;
};

// Ported from apps/cloud/lib/session-helpers.ts#resolvePrice. `tier` is unused
// by the actual logic there (frame.price is always the source of truth when
// set), so the local port only needs `price`.
function resolvePrice(frame: { price: number } | null, boothDefaultPrice: number): number {
  if (!frame) return boothDefaultPrice;
  return frame.price > 0 ? frame.price : boothDefaultPrice;
}

// ---------------------------------------------------------------------------
// BoothDO
// ---------------------------------------------------------------------------

export class BoothDO extends DurableObject<Bindings> {
  // -------------------------------------------------------------------
  // fetch() — upgrade WebSocket kiosk saja. Worker (src/index.ts) sudah
  // memvalidasi booth aktif sebelum meneruskan ke `/kiosk/:boothId`.
  // Jalur ws bridge dibuang (PRD bagian 8 #15): agent bicara ke cloud lewat
  // HTTP `/api/bridge/*` dengan bearer `booths.bridge_token`.
  // -------------------------------------------------------------------
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const role = parts[0];
    const boothId = parts[1];
    if (role !== "kiosk" || !boothId) {
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
    this.ctx.acceptWebSocket(server, ["kiosk"]);

    const ready: KioskReadyPayload = {
      boothId,
      boothName: booth.name,
      defaultPrice: booth.defaultPrice,
      activeSession: await this.activeSessionSnapshot(boothId),
    };
    server.send(encode({ ev: SocketEvents.KIOSK_READY, data: ready }));
    // Awaited: promise yang tidak di-await sebelum Response 101 bisa
    // dibatalkan runtime. adminBroadcast() tidak pernah throw.
    await adminBroadcast(this.env, SocketEvents.ADMIN_BOOTH_STATUS, {
      boothId,
      online: true,
      inSession: ready.activeSession !== null,
      lastSeenAt: new Date().toISOString(),
      bridgeOnline: agentOnline(booth.lastSeenAt),
    });

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

    if (!this.ctx.getTags(ws).includes("kiosk")) return;

    const boothId = (await this.ctx.storage.get<string>("boothId")) ?? "";

    let result: HandlerResult;
    try {
      result = await this.dispatchKiosk(boothId, ev, data);
    } catch (err) {
      const message2 = err instanceof Error ? err.message : "internal error";
      logger.error("booth_do_handler_failed", { boothId, ev, err: message2 });
      result = { ok: false, error: message2 };
    }

    if (replyId !== undefined) {
      ws.send(
        result.ok
          ? encode({ id: replyId, ok: true, data: result.data })
          : encode({
              id: replyId,
              ok: false,
              error: result.error,
              ...(result.code ? { code: result.code } : {}),
              // `releasesAt` top-level dipertahankan untuk klien lama; klien
              // shared (`WsRequestError.details`) membaca dari `details`.
              ...(result.releasesAt !== undefined
                ? { releasesAt: result.releasesAt, details: { releasesAt: result.releasesAt } }
                : {}),
            }),
      );
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    logger.info("booth_do_ws_close", { code, reason, wasClean, tags: this.ctx.getTags(ws) });
    await this.broadcastDisconnect();
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    logger.warn("booth_do_ws_error", {
      tags: this.ctx.getTags(ws),
      err: error instanceof Error ? error.message : String(error),
    });
    await this.broadcastDisconnect();
  }

  // Cloudflare hanya menjamin salah satu dari close/error terpanggil per
  // socket, jadi keduanya memakai helper ini.
  private async broadcastDisconnect(): Promise<void> {
    const boothId = (await this.ctx.storage.get<string>("boothId")) ?? "";
    if (!boothId) return;
    const db = getDb(this.env.DB);
    const [booth] = await db
      .select({ lastSeenAt: schema.booths.lastSeenAt })
      .from(schema.booths)
      .where(eq(schema.booths.id, boothId))
      .limit(1);
    await adminBroadcast(this.env, SocketEvents.ADMIN_BOOTH_STATUS, {
      boothId,
      online: this.ctx.getWebSockets("kiosk").length > 0,
      inSession: false,
      lastSeenAt: new Date().toISOString(),
      bridgeOnline: agentOnline(booth?.lastSeenAt ?? null),
    });
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

    // Satu sesi hidup per booth — itu yang membuat satu alarm per DO cukup.
    //
    // Sesi `paid/capturing/processing` = uang sudah masuk, pelanggan sedang
    // di booth: tolak dengan BOOTH_BUSY + releasesAt (alarm tahap yang akan
    // membebaskan, PRD bagian 7). Sesi `payment`/`idle` = checkout yang
    // ditinggal: pensiunkan lalu lanjut, supaya booth tidak menganggur
    // sampai QR kedaluwarsa.
    const [existingActive] = await db
      .select({ id: schema.sessions.id, status: schema.sessions.status })
      .from(schema.sessions)
      .where(and(eq(schema.sessions.boothId, ownBoothId), sql`${schema.sessions.status} not in ${TERMINAL_STATUS_SQL}`))
      .limit(1);
    if (existingActive) {
      if ((BUSY_SESSION_STATUSES as readonly string[]).includes(existingActive.status)) {
        const releasesAt = await this.alarmAtFor(existingActive.id);
        return {
          ok: false,
          code: "BOOTH_BUSY",
          error: "Booth sedang dipakai",
          releasesAt: releasesAt ? new Date(releasesAt).toISOString() : null,
        };
      }
      await db
        .update(schema.sessions)
        .set({ status: "expired" })
        .where(eq(schema.sessions.id, existingActive.id));
      await this.clearScheduledWork(existingActive.id);
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
    let sessionProvider: string = booth.paymentProvider;
    let sessionAccountId: string | null = null;

    if (parsed.data.method === "voucher") {
      // No QR — the kiosk collects a voucher code and redeems it via the
      // public HTTP endpoint (/api/voucher/redeem), which calls markPaid.
      // Still bounded by a timeout so an abandoned VOUCHER_INPUT session
      // doesn't linger forever — reuses the same qr_expiry alarm path.
      expiresAt = new Date(Date.now() + SESSION_TIMING.VOUCHER_INPUT_EXPIRY_MS);
    } else {
      // Kredensial milik booth ini saja. Tanpa akun = tolak dengan jelas, tidak
      // ada QR palsu dan tidak ada jatuh ke akun lain. Mock hanya di dev lokal.
      const account = await loadAccount(db, this.env, booth.paymentAccountId);
      let provider: PaymentProvider;
      if (account) {
        provider = account.provider;
        sessionProvider = account.row.provider;
        sessionAccountId = account.row.id;
      } else if (isLocalDev(this.env)) {
        provider = new XenditProvider({});
        sessionProvider = "xendit";
      } else {
        logger.warn("booth_payment_not_configured", { boothId: ownBoothId, accountId: booth.paymentAccountId });
        return {
          ok: false,
          code: "PAYMENT_NOT_CONFIGURED",
          error: "QRIS belum diatur untuk booth ini. Pakai voucher atau panggil operator.",
        };
      }
      // PRD bagian 8 #4: QR hidup 1 menit, sama dengan PAYMENT_TIMEOUT kiosk.
      const qr = await provider.createQR({ sessionId, amount, expiresInMinutes: SESSION_TIMING.QR_EXPIRY_MINUTES });
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
      paymentProvider: parsed.data.method === "voucher" ? booth.paymentProvider : sessionProvider,
      paymentAccountId: sessionAccountId,
      paymentRef,
      qrString,
      downloadToken,
      downloadExpiresAt,
      expiredAt: expiresAt,
    });

    await db.insert(schema.paymentLogs).values({
      sessionId,
      provider: parsed.data.method === "voucher" ? "voucher" : sessionProvider,
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

  // PRD bagian 8 #2: `capture:start` sekali per sesi. DO hanya mengubah
  // `paid` -> `capturing` dan memasang alarm capture_timeout 10 menit.
  // Tangkapan per foto berjalan kiosk -> agent, tidak lewat DO.
  // Panggilan ulang untuk sesi yang sudah `capturing` (kiosk reload, tap
  // ganda) dibalas ok tanpa mereset alarm, supaya batas 10 menit tidak bisa
  // diperpanjang tanpa akhir.
  private async handleStartCapture(ownBoothId: string, raw: unknown): Promise<HandlerResult> {
    const parsed = startCaptureSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: "invalid payload" };
    const { sessionId } = parsed.data;

    const db = getDb(this.env.DB);
    const [session] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).limit(1);
    if (!session || session.boothId !== ownBoothId) return { ok: false, error: "session not found" };

    if (session.status === "capturing") {
      return { ok: true, data: { sessionId, status: "capturing", repeated: true } };
    }
    if (session.status !== "paid") {
      return { ok: false, code: "INVALID_STATE", error: `session not paid (current: ${session.status})` };
    }

    await db.update(schema.sessions).set({ status: "capturing" }).where(eq(schema.sessions.id, sessionId));
    await this.scheduleTask({ type: "capture_timeout", sessionId }, Date.now() + SESSION_TIMING.CAPTURE_TIMEOUT_MS);
    await adminBroadcast(this.env, SocketEvents.ADMIN_SESSION_UPDATE, {
      boothId: ownBoothId,
      sessionId,
      status: "capturing",
      amount: session.amount,
    });
    return { ok: true, data: { sessionId, status: "capturing" } };
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

  // Kiosk hanya boleh membatalkan sesi yang belum dibayar. Sesi berbayar
  // dibatalkan lewat staf (`/api/bridge/session/:id/cancel-voucher`) supaya
  // uang selalu berujung voucher, tidak hilang karena tap "batal".
  private async handleCancel(ownBoothId: string, raw: unknown): Promise<HandlerResult> {
    const parsed = cancelSchema.safeParse(raw ?? {});
    const sessionId = parsed.success ? parsed.data.sessionId : undefined;

    if (sessionId) {
      const db = getDb(this.env.DB);
      const [session] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).limit(1);
      if (session && session.boothId === ownBoothId) {
        if ((BUSY_SESSION_STATUSES as readonly string[]).includes(session.status)) {
          return { ok: false, code: "BOOTH_BUSY", error: "Sesi sudah dibayar, panggil barista" };
        }
        if (session.status === "payment" || session.status === "idle") {
          await db.update(schema.sessions).set({ status: "expired" }).where(eq(schema.sessions.id, sessionId));
          await this.clearScheduledWork(sessionId);
          await adminBroadcast(this.env, SocketEvents.ADMIN_SESSION_UPDATE, {
            boothId: ownBoothId,
            sessionId,
            status: "expired",
            amount: session.amount,
          });
        }
      }
    }

    this.pushToKiosk(SocketEvents.RESET, { sessionId });
    return { ok: true };
  }

  // -------------------------------------------------------------------
  // RPC methods — called by the Worker via src/do/rpc.ts, never directly by
  // routes. `boothId` is passed explicitly by the caller (it already knows
  // it — that's how it built the DO stub) rather than trusted from storage.
  // -------------------------------------------------------------------

  // Balas true kalau sesi benar-benar berpindah payment -> paid. Pemanggil
  // (voucher) memakai ini untuk mengembalikan kuota kalau transisi tidak
  // terjadi, supaya voucher tidak hangus tanpa sesi.
  async markPaid(boothId: string, sessionId: string, meta?: Record<string, unknown>): Promise<boolean> {
    const db = getDb(this.env.DB);
    const [session] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).limit(1);
    if (!session || session.boothId !== boothId) {
      logger.warn("booth_do_mark_paid_session_mismatch", { boothId, sessionId });
      return false;
    }
    if (session.status !== "payment") {
      logger.info("booth_do_mark_paid_noop", { boothId, sessionId, status: session.status });
      return false;
    }

    const paidAt = new Date();
    await db.update(schema.sessions).set({ status: "paid", paidAt }).where(eq(schema.sessions.id, sessionId));
    // PRD bagian 7: `paid` tanpa capture:start 3 menit -> abandoned_paid + voucher.
    await this.scheduleTask({ type: "paid_timeout", sessionId }, paidAt.getTime() + SESSION_TIMING.PAID_START_TIMEOUT_MS);
    // PRD bagian 8 #17: downloadToken ikut PAYMENT_PAID (QRIS dan voucher),
    // jadi QR share bisa tampil tanpa menunggu composite.
    this.pushToKiosk(SocketEvents.PAYMENT_PAID, {
      sessionId,
      amount: session.amount,
      paidAt: paidAt.toISOString(),
      downloadToken: session.downloadToken ?? null,
    });
    // Admin dashboard broadcast point (ADMIN_SESSION_UPDATE) — session paid.
    await adminBroadcast(this.env, SocketEvents.ADMIN_SESSION_UPDATE, {
      boothId,
      sessionId,
      status: "paid",
      amount: session.amount,
    });
    logger.info("booth_do_mark_paid", { boothId, sessionId, meta });
    return true;
  }

  // PRD bagian 8 #9: rate limit /api/voucher/redeem. Jendela geser
  // REDEEM_LIMITS.WINDOW_MS, maks PER_SESSION per sesi dan PER_BOOTH per booth.
  // Dicek SEBELUM kode voucher dicari, jadi tebakan kode salah ikut terhitung
  // (itu tujuannya: rem brute force kode 8 karakter). DO single-threaded, jadi
  // baca-ubah-tulis di sini tidak race walau dua tap datang bersamaan.
  // Kunci sesi yang sudah lewat jendela dibersihkan tiap panggilan supaya
  // storage tidak tumbuh tanpa batas.
  async checkRedeemAttempt(
    boothId: string,
    sessionId: string,
    now: number = Date.now(),
  ): Promise<{ ok: true } | { ok: false; scope: "session" | "booth"; retryAfterMs: number }> {
    const { PER_SESSION, PER_BOOTH, WINDOW_MS } = REDEEM_LIMITS;
    const cutoff = now - WINDOW_MS;
    const fresh = (xs: number[] | undefined) => (xs ?? []).filter((t) => t > cutoff);

    const boothKey = "redeem:booth";
    const sessionKey = `redeem:session:${sessionId}`;
    const boothHits = fresh(await this.ctx.storage.get<number[]>(boothKey));
    const sessionHits = fresh(await this.ctx.storage.get<number[]>(sessionKey));

    // Sapu kunci sesi lain yang sudah basi.
    const all = await this.ctx.storage.list<number[]>({ prefix: "redeem:session:" });
    const stale: string[] = [];
    for (const [k, v] of all) if (k !== sessionKey && fresh(v).length === 0) stale.push(k);
    if (stale.length) await this.ctx.storage.delete(stale);

    if (sessionHits.length >= PER_SESSION) {
      logger.warn("redeem_rate_limited", { boothId, sessionId, scope: "session" });
      return { ok: false, scope: "session", retryAfterMs: Math.max(0, sessionHits[0]! + WINDOW_MS - now) };
    }
    if (boothHits.length >= PER_BOOTH) {
      logger.warn("redeem_rate_limited", { boothId, sessionId, scope: "booth" });
      return { ok: false, scope: "booth", retryAfterMs: Math.max(0, boothHits[0]! + WINDOW_MS - now) };
    }
    await this.ctx.storage.put(sessionKey, [...sessionHits, now]);
    await this.ctx.storage.put(boothKey, [...boothHits, now]);
    return { ok: true };
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

    // Status terminal (done, stale, abandoned_paid, ...) tidak ditimpa: sesi
    // itu sudah punya nasib uang (voucher/cetak). Kiosk tetap dapat RESET.
    const terminal = (TERMINAL_SESSION_STATUSES as readonly string[]).includes(session.status);
    if (!terminal) {
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
      status: terminal ? session.status : "failed",
      amount: session.amount,
    });
    logger.info("booth_do_force_reset", { boothId, sessionId, byEmail });
  }

  // Refund manual admin (PRD bagian 8 #7, bagian 10). Tanpa panggilan refund
  // Xendit; uang dikembalikan tunai/voucher di kasir, di sini hanya dicatat.
  //  - paid/capturing/processing -> failed (sesi tidak selesai), alarm dibersihkan.
  //  - done -> status TETAP done, cukup metadata; link share tetap hidup.
  //  - sekali saja per sesi (metadata.refund ada -> ALREADY_REFUNDED) supaya
  //    uang tidak keluar dua kali karena admin klik ganda.
  async refundSession(boothId: string, sessionId: string, input: RefundInput): Promise<RefundResult> {
    const db = getDb(this.env.DB);
    const [session] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).limit(1);
    if (!session || session.boothId !== boothId) {
      logger.warn("booth_do_refund_session_mismatch", { boothId, sessionId });
      return { ok: false, code: "NOT_FOUND" };
    }
    const meta = (session.metadata as Record<string, unknown> | null) ?? {};
    if (meta.refund || meta.refundedAt) return { ok: false, code: "ALREADY_REFUNDED" };

    const busy = (BUSY_SESSION_STATUSES as readonly string[]).includes(session.status);
    if (!busy && session.status !== "done") {
      return { ok: false, code: "INVALID_STATE", status: session.status };
    }
    const nextStatus = session.status === "done" ? "done" : "failed";
    const refund = {
      reasonCode: input.reasonCode,
      note: input.reason,
      by: input.byEmail,
      at: new Date().toISOString(),
      fromStatus: session.status,
    };
    await db
      .update(schema.sessions)
      .set({ status: nextStatus, metadata: { ...meta, refund } })
      .where(eq(schema.sessions.id, sessionId));
    if (busy) await this.clearScheduledWork(sessionId);

    await adminBroadcast(this.env, SocketEvents.ADMIN_SESSION_UPDATE, {
      boothId,
      sessionId,
      status: nextStatus,
      amount: session.amount,
    });
    logger.info("booth_do_refund_session", { boothId, sessionId, byEmail: input.byEmail, from: session.status });
    return { ok: true, status: nextStatus };
  }

  // PRD bagian 8 #15/#3: unggahan foto hanya menambah baris `photos`.
  // Progres tangkapan milik agent; status sesi tidak disentuh. Upload bisa
  // datang jauh setelah sesi `done` (antrean agent), jadi tidak ada cek status.
  // Idempoten per (sessionId, sortOrder): antrean agent bisa mengulang job.
  async onPhotoUploaded(boothId: string, input: { sessionId: string; index: number; r2Key: string }): Promise<void> {
    const { sessionId, index, r2Key } = input;
    const db = getDb(this.env.DB);
    const [session] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).limit(1);
    if (!session || session.boothId !== boothId) {
      logger.warn("booth_do_photo_uploaded_session_mismatch", { boothId, sessionId });
      return;
    }
    await this.upsertPhoto(sessionId, { r2Key, isFinal: false, sortOrder: index });
  }

  async onCompositeUploaded(boothId: string, input: { sessionId: string; r2Key: string }): Promise<void> {
    const { sessionId, r2Key } = input;
    const db = getDb(this.env.DB);
    const [session] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).limit(1);
    if (!session || session.boothId !== boothId) return;
    await this.upsertPhoto(sessionId, { r2Key, isFinal: true, sortOrder: 99 });
  }

  // PRD bagian 8 #16 + bagian 7: satu-satunya jalan ke `done`. Dari
  // `capturing` (normal) atau `stale` (wifi putus lama lalu pulih).
  //  - stale + voucher auto-abandoned belum terpakai -> voucher disabled
  //    (metadata.disabledReason = "late-done"), sesi done.
  //  - stale + voucher sudah terpakai -> SESSION_STALE (409), status tetap,
  //    agent tidak mencetak. Pelanggan tidak dapat cetakan dan voucher sekaligus.
  //  - sudah done -> ok (idempoten; antrean agent bisa mengulang).
  async markDone(boothId: string, sessionId: string): Promise<MarkDoneResult> {
    const db = getDb(this.env.DB);
    const [session] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).limit(1);
    if (!session || session.boothId !== boothId) return { ok: false, code: "NOT_FOUND" };
    if (session.status === "done") return { ok: true, status: "done" };

    let disabledVoucherId: string | undefined;
    if (session.status === "stale") {
      const [voucher] = await db
        .select()
        .from(schema.vouchers)
        .where(and(eq(schema.vouchers.sourceSessionId, sessionId), eq(schema.vouchers.source, "auto-abandoned")))
        .limit(1);
      if (voucher) {
        // Kondisional: menang atas redeem yang datang bersamaan. Kalau redeem
        // sudah menaikkan usedCount, UPDATE ini tidak mengenai baris.
        const res = await db
          .update(schema.vouchers)
          .set({
            status: "disabled",
            updatedAt: new Date(),
            metadata: { ...((voucher.metadata as object | null) ?? {}), disabledReason: "late-done" },
          })
          .where(
            and(
              eq(schema.vouchers.id, voucher.id),
              eq(schema.vouchers.usedCount, 0),
              eq(schema.vouchers.status, "active"),
            ),
          );
        if (res.meta.changes === 0) {
          logger.warn("booth_do_mark_done_stale_voucher_used", { boothId, sessionId, voucherId: voucher.id });
          return { ok: false, code: "SESSION_STALE", status: session.status };
        }
        disabledVoucherId = voucher.id;
      }
    } else if (session.status !== "capturing" && session.status !== "processing") {
      return { ok: false, code: "INVALID_STATE", status: session.status };
    }

    await db
      .update(schema.sessions)
      .set({ status: "done" })
      .where(eq(schema.sessions.id, sessionId));
    await this.clearScheduledWork(sessionId);
    await adminBroadcast(this.env, SocketEvents.ADMIN_SESSION_UPDATE, {
      boothId,
      sessionId,
      status: "done",
      amount: session.amount,
    });
    logger.info("booth_do_mark_done", { boothId, sessionId, from: session.status, disabledVoucherId });

    // Best-effort; tanpa kontak (WhatsApp di luar scope) ini no-op.
    try {
      await notifySession(this.env, sessionId);
    } catch (err) {
      logger.warn("booth_do_notify_failed", { sessionId, err: err instanceof Error ? err.message : String(err) });
    }
    return disabledVoucherId ? { ok: true, status: "done", disabledVoucherId } : { ok: true, status: "done" };
  }

  // PRD bagian 6: staf membatalkan sesi berbayar -> `cancelled` + voucher
  // staff-cancel senilai sesi. Idempoten: panggilan ulang mengembalikan
  // voucher yang sama (unique index (source_session_id, source)).
  async cancelWithVoucher(boothId: string, sessionId: string, byStaff?: string): Promise<CancelVoucherResult> {
    const db = getDb(this.env.DB);
    const [session] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).limit(1);
    if (!session || session.boothId !== boothId) return { ok: false, code: "NOT_FOUND" };

    if (session.status !== "cancelled" && !(BUSY_SESSION_STATUSES as readonly string[]).includes(session.status)) {
      return { ok: false, code: "INVALID_STATE", status: session.status };
    }

    const voucher = await issueAutoVoucher(db, {
      sessionId,
      source: "staff-cancel",
      amount: session.amount,
      reason: byStaff ? `staff:${byStaff}` : "staff",
    });
    if (session.status !== "cancelled") {
      await db.update(schema.sessions).set({ status: "cancelled" }).where(eq(schema.sessions.id, sessionId));
      await this.clearScheduledWork(sessionId);
      this.pushToKiosk(SocketEvents.RESET, { sessionId, reason: "staff-cancel" });
      await adminBroadcast(this.env, SocketEvents.ADMIN_SESSION_UPDATE, {
        boothId,
        sessionId,
        status: "cancelled",
        amount: session.amount,
      });
    }
    logger.info("booth_do_cancel_voucher", { boothId, sessionId, voucherId: voucher.id, created: voucher.created });
    return { ok: true, voucherId: voucher.id, code: voucher.code, created: voucher.created };
  }

  // PRD bagian 8 #13: status cetak per lembar disimpan di
  // `sessions.metadata.print` (tanpa migrasi). Tidak mengubah status sesi.
  async setPrintStatus(boothId: string, input: PrintStatusInput): Promise<boolean> {
    const db = getDb(this.env.DB);
    const [session] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, input.sessionId)).limit(1);
    if (!session || session.boothId !== boothId) return false;

    const meta = ((session.metadata as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
    const print = ((meta.print as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;
    const sheets = { ...((print.sheets as Record<string, unknown> | undefined) ?? {}) };
    sheets[String(input.sheet)] = {
      state: input.state,
      cupsJobId: input.cupsJobId ?? null,
      error: input.error ?? null,
      at: new Date().toISOString(),
    };
    const states = Object.values(sheets).map((v) => (v as { state: string }).state);
    const overall = states.includes("failed")
      ? "failed"
      : states.length > 0 && states.every((x) => x === "done")
        ? "done"
        : "printing";
    const patch: Partial<typeof schema.sessions.$inferInsert> = {
      metadata: { ...meta, print: { ...print, sheets, state: overall } },
    };
    if (overall === "done" && !session.printCompletedAt) patch.printCompletedAt = new Date();
    await db.update(schema.sessions).set(patch).where(eq(schema.sessions.id, input.sessionId));

    if (input.state === "failed") {
      logger.warn("booth_do_print_failed", { boothId, sessionId: input.sessionId, sheet: input.sheet, error: input.error });
    }
    return true;
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
      .where(and(eq(schema.sessions.boothId, boothId), sql`${schema.sessions.status} not in ${TERMINAL_STATUS_SQL}`))
      .orderBy(desc(schema.sessions.createdAt))
      .limit(1);

    const [booth] = await db
      .select({ lastSeenAt: schema.booths.lastSeenAt })
      .from(schema.booths)
      .where(eq(schema.booths.id, boothId))
      .limit(1);

    return {
      // "bridge" = booth-agent; online dari heartbeat HTTP terakhir.
      bridgeOnline: agentOnline(booth?.lastSeenAt ?? null),
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
    // Hapus dulu: kalau handler di bawah melempar, runtime mengulang alarm()
    // dan kita tidak mau loop selamanya. Semua handler idempoten terhadap
    // status sesi, jadi aman dijalankan ulang secara manual.
    await this.ctx.storage.delete("alarm:task");

    switch (task.type) {
      case "qr_expiry":
        await this.runQrExpiry(task.sessionId);
        break;
      case "paid_timeout":
        await this.runStageTimeout(task.sessionId, "paid", "abandoned_paid");
        break;
      case "capture_timeout":
        await this.runStageTimeout(task.sessionId, "capturing", "stale");
        break;
    }
  }

  private async runQrExpiry(sessionId: string): Promise<void> {
    const db = getDb(this.env.DB);
    const [session] = await db
      .select({ boothId: schema.sessions.boothId, status: schema.sessions.status, amount: schema.sessions.amount })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .limit(1);
    if (!session || session.status !== "payment") return; // already paid/cancelled — nothing to do

    await db.update(schema.sessions).set({ status: "expired" }).where(eq(schema.sessions.id, sessionId));
    this.pushToKiosk(SocketEvents.PAYMENT_EXPIRED, { sessionId });
    await adminBroadcast(this.env, SocketEvents.ADMIN_SESSION_UPDATE, {
      boothId: session.boothId,
      sessionId,
      status: "expired",
      amount: session.amount,
    });
    logger.info("booth_do_qr_expired", { boothId: session.boothId, sessionId });
  }

  // PRD bagian 7: `paid` 3 menit tanpa capture:start -> abandoned_paid;
  // `capturing` 10 menit tanpa markDone -> stale. Keduanya menerbitkan
  // voucher auto-abandoned senilai sesi dan membebaskan booth.
  // Voucher diterbitkan SEBELUM status diubah: kalau insert gagal, alarm
  // diulang runtime dan sesi tetap mengunci booth, bukan uang hilang.
  private async runStageTimeout(
    sessionId: string,
    expected: "paid" | "capturing",
    next: "abandoned_paid" | "stale",
  ): Promise<void> {
    const db = getDb(this.env.DB);
    const [session] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).limit(1);
    if (!session || session.status !== expected) return;

    const source: AutoVoucherSource = "auto-abandoned";
    try {
      const voucher = await issueAutoVoucher(db, {
        sessionId,
        source,
        amount: session.amount,
        reason: next,
      });
      await db
        .update(schema.sessions)
        .set({ status: next })
        .where(and(eq(schema.sessions.id, sessionId), eq(schema.sessions.status, expected)));
      this.pushToKiosk(SocketEvents.RESET, { sessionId, reason: next });
      await adminBroadcast(this.env, SocketEvents.ADMIN_SESSION_UPDATE, {
        boothId: session.boothId,
        sessionId,
        status: next,
        amount: session.amount,
      });
      logger.warn("booth_do_stage_timeout", { boothId: session.boothId, sessionId, from: expected, to: next, voucherId: voucher.id });
    } catch (err) {
      // Pasang ulang alarm supaya dicoba lagi; booth tetap terkunci.
      logger.error("booth_do_stage_timeout_failed", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      await this.scheduleTask(
        { type: expected === "paid" ? "paid_timeout" : "capture_timeout", sessionId },
        Date.now() + 30_000,
      );
    }
  }

  // -------------------------------------------------------------------
  // Shared helpers
  // -------------------------------------------------------------------

  private async scheduleTask(task: AlarmTask, at: number): Promise<void> {
    await this.ctx.storage.put<AlarmTask>("alarm:task", task);
    await this.ctx.storage.setAlarm(at);
  }

  private async clearScheduledWork(sessionId: string): Promise<void> {
    const task = await this.ctx.storage.get<AlarmTask>("alarm:task");
    if (task && task.sessionId === sessionId) {
      await this.ctx.storage.delete("alarm:task");
      await this.ctx.storage.deleteAlarm();
    }
  }

  /** Waktu alarm (ms) kalau alarm aktif milik sesi ini, selain itu null. */
  private async alarmAtFor(sessionId: string): Promise<number | null> {
    const task = await this.ctx.storage.get<AlarmTask>("alarm:task");
    if (!task || task.sessionId !== sessionId) return null;
    return (await this.ctx.storage.getAlarm()) ?? null;
  }

  private async upsertPhoto(
    sessionId: string,
    row: { r2Key: string; isFinal: boolean; sortOrder: number },
  ): Promise<void> {
    const db = getDb(this.env.DB);
    const [existing] = await db
      .select({ id: schema.photos.id })
      .from(schema.photos)
      .where(and(eq(schema.photos.sessionId, sessionId), eq(schema.photos.sortOrder, row.sortOrder)))
      .limit(1);
    if (existing) {
      await db.update(schema.photos).set({ r2Key: row.r2Key, isFinal: row.isFinal }).where(eq(schema.photos.id, existing.id));
      return;
    }
    await db.insert(schema.photos).values({ id: crypto.randomUUID(), sessionId, ...row });
  }

  /**
   * Sesi terbaru booth ini yang masih mengunci booth (paid/capturing) atau
   * masih menunggu bayar. Dikirim di KIOSK_READY agar kiosk yang reload bisa
   * melanjutkan sesi, bukan kembali ke idle sementara uang sudah masuk.
   */
  private async activeSessionSnapshot(boothId: string): Promise<ActiveSessionSnapshot | null> {
    const db = getDb(this.env.DB);
    const [row] = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.boothId, boothId))
      .orderBy(desc(schema.sessions.createdAt))
      .limit(1);
    if (!row) return null;
    const status = row.status as SessionStatus;
    const live = status === "payment" || (BUSY_SESSION_STATUSES as readonly string[]).includes(status);
    if (!live) return null;
    const alarmAt = await this.alarmAtFor(row.id);
    return {
      id: row.id,
      status,
      expiresAt: alarmAt ? new Date(alarmAt).toISOString() : null,
      downloadToken: row.downloadToken ?? null,
    };
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
}

function agentOnline(lastSeenAt: Date | null): boolean {
  return lastSeenAt !== null && Date.now() - lastSeenAt.getTime() < AGENT_ONLINE_MS;
}
