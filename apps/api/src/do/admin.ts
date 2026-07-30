// AdminDO — singleton Durable Object backing the realtime admin dashboard.
//
// Replaces the old apps/cloud Socket.io "admin:overview" room (see
// apps/cloud/lib/socket/handlers/admin.ts + apps/cloud/lib/socket/server.ts).
// There is exactly one instance of this DO, always addressed via
// `env.ADMIN_DO.idFromName("overview")` (see src/do/rpc.ts and the
// `GET /ws/admin` route in src/index.ts) — it is a fan-out relay for
// booth/session status, not a per-entity coordinator like BoothDO.
//
// Architecture rules this file exists to satisfy (see task spec):
//   1. WebSocket Hibernation API only (`ctx.acceptWebSocket` +
//      `webSocketMessage`/`webSocketClose`/`webSocketError`) — an admin
//      dashboard tab can sit open for hours; without hibernation that idle
//      connection would burn Durable Object wall-clock quota the whole time.
//   2. No JS timers — nothing here is a duration-based flow (no alarms
//      needed either: this DO holds no scheduled work).
//   3. Auth already happened in the Worker (src/index.ts) before this DO
//      ever sees the request — this file trusts every fetch() call it gets.
//   4. AdminDO never writes `sessions`/`photos` — it only reads `booths` (for
//      the initial snapshot) and relays whatever BoothDO tells it to.
import { DurableObject } from "cloudflare:workers";
import { eq, inArray } from "drizzle-orm";
import {
  decode,
  encode,
  isPush,
  isRequest,
  SocketEvents,
  type AdminBoothStatusPayload,
  type AdminSessionUpdatePayload,
  type SessionStatus,
} from "@capture/shared";
import type { Bindings } from "@/lib/env";
import { getDb, schema } from "@/db";
import { logger } from "@/lib/logger";

// Workers Free caps CPU at 10ms/invocation. Fanning out `getStatus()` RPC
// calls to every active booth's BoothDO on every admin connect doesn't cost
// CPU time while awaiting (that's the callee's clock, not ours), but it does
// add wall-clock latency and D1 read volume — so the live portion of the
// snapshot is capped. Booths beyond the cap still appear in the snapshot,
// just without live bridge/kiosk/session data (D1's `lastSeenAt` only).
const MAX_LIVE_STATUS_BOOTHS = 20;

// A booth's `lastSeenAt` (D1, updated on bridge connect/heartbeat) is treated
// as "online" for this long — matches the threshold apps/cloud used
// (apps/cloud/lib/socket/handlers/admin.ts:9). Only used as a fallback for
// booths past the live-status cap, where we have no BoothDO getStatus() call
// to trust instead.
const OFFLINE_THRESHOLD_MS = 5 * 60 * 1000;

function isRecentlySeen(lastSeenAt: Date | null): boolean {
  return lastSeenAt !== null && Date.now() - lastSeenAt.getTime() < OFFLINE_THRESHOLD_MS;
}

type BoothLiveStatus = {
  bridgeOnline: boolean;
  kioskOnline: boolean;
  currentSessionId: string | null;
  status: string | null;
};

export class AdminDO extends DurableObject<Bindings> {
  // -------------------------------------------------------------------
  // fetch() — WebSocket upgrade entrypoint only. The Worker has already
  // verified the `capture-session` cookie before forwarding here.
  // -------------------------------------------------------------------
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server, ["admin"]);

    // Sent in-line with the upgrade, same reasoning as BoothDO's
    // KIOSK_READY: the dashboard should never render an empty screen while
    // waiting for the next live event to happen to arrive.
    try {
      await this.sendSnapshot(server);
    } catch (err) {
      logger.error("admin_do_snapshot_failed", {
        err: err instanceof Error ? err.message : String(err),
      });
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  // -------------------------------------------------------------------
  // Hibernatable WebSocket handlers — the only supported connection model.
  // -------------------------------------------------------------------
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const raw = typeof message === "string" ? message : new TextDecoder().decode(message);
    const envelope = decode(raw);
    if (!envelope) return; // malformed frame — drop, never throw

    // The admin dashboard has no client->server commands in the app this
    // replaces (apps/cloud/lib/socket/handlers/admin.ts only ever pushes a
    // connect-time snapshot). Any Request still gets a clean reply so a
    // future dashboard feature can rely on request/reply semantics instead
    // of silently timing out; any Push is just dropped.
    if (isRequest(envelope)) {
      ws.send(encode({ id: envelope.id, ok: false, error: `Unknown admin event: ${envelope.ev}` }));
      return;
    }
    if (isPush(envelope)) {
      logger.info("admin_do_unknown_push_ignored", { ev: envelope.ev });
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    logger.info("admin_do_ws_close", { code, reason, wasClean, tags: this.ctx.getTags(ws) });
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    logger.warn("admin_do_ws_error", {
      tags: this.ctx.getTags(ws),
      err: error instanceof Error ? error.message : String(error),
    });
  }

  // -------------------------------------------------------------------
  // RPC — called from BoothDO (via src/do/rpc.ts#adminBroadcast) whenever a
  // booth's bridge/kiosk connection or a session's status changes. A no-op
  // when nobody is watching the dashboard right now.
  // -------------------------------------------------------------------
  async broadcast(event: string, payload: unknown): Promise<void> {
    const sockets = this.ctx.getWebSockets("admin");
    if (sockets.length === 0) return;

    const frame = encode({ ev: event, data: payload });
    for (const ws of sockets) {
      try {
        ws.send(frame);
      } catch (err) {
        logger.warn("admin_do_broadcast_send_failed", {
          event,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // -------------------------------------------------------------------
  // Snapshot — sent once, right after an admin dashboard connects.
  // -------------------------------------------------------------------
  private async sendSnapshot(ws: WebSocket): Promise<void> {
    const db = getDb(this.env.DB);
    const activeBooths = await db
      .select({ id: schema.booths.id, name: schema.booths.name, lastSeenAt: schema.booths.lastSeenAt })
      .from(schema.booths)
      .where(eq(schema.booths.isActive, true))
      .orderBy(schema.booths.name);

    const capped = activeBooths.slice(0, MAX_LIVE_STATUS_BOOTHS);
    const truncated = activeBooths.length > MAX_LIVE_STATUS_BOOTHS;
    if (truncated) {
      logger.warn("admin_do_snapshot_truncated", {
        activeBooths: activeBooths.length,
        cap: MAX_LIVE_STATUS_BOOTHS,
      });
    }

    const liveEntries = await Promise.all(
      capped.map(async (b): Promise<[string, BoothLiveStatus] | null> => {
        try {
          const stub = this.env.BOOTH_DO.get(this.env.BOOTH_DO.idFromName(b.id));
          const status = await stub.getStatus(b.id);
          return [b.id, status];
        } catch (err) {
          logger.warn("admin_do_snapshot_getstatus_failed", {
            boothId: b.id,
            err: err instanceof Error ? err.message : String(err),
          });
          return null;
        }
      }),
    );
    const liveByBoothId = new Map(liveEntries.filter((e): e is [string, BoothLiveStatus] => e !== null));

    const sessionIds = [...liveByBoothId.values()]
      .map((l) => l.currentSessionId)
      .filter((id): id is string => id !== null);

    let amountBySessionId = new Map<string, number>();
    if (sessionIds.length > 0) {
      const sessionRows = await db
        .select({ id: schema.sessions.id, amount: schema.sessions.amount })
        .from(schema.sessions)
        .where(inArray(schema.sessions.id, sessionIds));
      amountBySessionId = new Map(sessionRows.map((s) => [s.id, s.amount]));
    }

    for (const b of activeBooths) {
      const live = liveByBoothId.get(b.id);
      const boothStatus: AdminBoothStatusPayload = {
        boothId: b.id,
        online: live ? live.kioskOnline : isRecentlySeen(b.lastSeenAt),
        inSession: Boolean(live?.currentSessionId),
        lastSeenAt: b.lastSeenAt ? b.lastSeenAt.toISOString() : null,
        bridgeOnline: live ? live.bridgeOnline : false,
      };
      this.safeSend(ws, SocketEvents.ADMIN_BOOTH_STATUS, boothStatus);

      if (live?.currentSessionId && live.status) {
        const sessionUpdate: AdminSessionUpdatePayload = {
          boothId: b.id,
          sessionId: live.currentSessionId,
          status: live.status as SessionStatus,
          amount: amountBySessionId.get(live.currentSessionId) ?? 0,
        };
        this.safeSend(ws, SocketEvents.ADMIN_SESSION_UPDATE, sessionUpdate);
      }
    }
  }

  private safeSend(ws: WebSocket, ev: string, data: unknown): void {
    try {
      ws.send(encode({ ev, data }));
    } catch (err) {
      logger.warn("admin_do_snapshot_send_failed", { ev, err: err instanceof Error ? err.message : String(err) });
    }
  }
}
