// Real replacement for the T4.1 stub. Connects to the AdminDO's WebSocket
// (`GET /ws/admin`, see apps/api/src/index.ts) using the shared envelope
// protocol client (`createWsClient` from `@capture/shared`), and folds the
// `ADMIN_BOOTH_STATUS` / `ADMIN_SESSION_UPDATE` push events it receives into
// a `{ [boothId]: LiveBoothStatus }` map — the same shape `BoothList` and
// `BoothLiveStatus` already expect from this hook.
//
// The socket is a ref-counted module-level singleton rather than one
// connection per hook call: both `BoothList` (booths table) and
// `BoothLiveStatus` (booth detail page) call this hook, and while an admin
// is on `/admin/booths/:id` both are mounted simultaneously. Sharing one
// `/ws/admin` connection avoids opening a duplicate socket (and duplicate
// auth-cookie upgrade) per component. The connection opens on the first
// mount and closes once the last subscriber unmounts (e.g. navigating away
// from the whole /admin section, such as after logout).
import { useEffect, useState } from "react";
import { createWsClient, SocketEvents } from "@capture/shared";
import type {
  AdminBoothStatusPayload,
  AdminSessionUpdatePayload,
  WsClient,
} from "@capture/shared";

export type LiveBoothStatus = {
  online: boolean;
  inSession: boolean;
  bridgeOnline: boolean;
  lastSeenAt: string | null;
  activeSessionId?: string;
  activeSessionStatus?: string;
};

type StatusMap = Record<string, LiveBoothStatus>;

const TERMINAL_SESSION_STATUSES = new Set(["done", "expired", "failed"]);

function wsUrl(path: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path}`;
}

let sharedClient: WsClient | null = null;
let sharedState: StatusMap = {};
let refCount = 0;
const subscribers = new Set<(state: StatusMap) => void>();

function notify(): void {
  for (const fn of subscribers) fn(sharedState);
}

function handleBoothStatus(data: unknown): void {
  const p = data as AdminBoothStatusPayload;
  if (!p?.boothId) return;
  sharedState = {
    ...sharedState,
    [p.boothId]: {
      ...sharedState[p.boothId],
      online: p.online,
      inSession: p.inSession,
      bridgeOnline: p.bridgeOnline,
      lastSeenAt: p.lastSeenAt,
    },
  };
  notify();
}

function handleSessionUpdate(data: unknown): void {
  const p = data as AdminSessionUpdatePayload;
  if (!p?.boothId) return;
  const existing = sharedState[p.boothId];
  const isTerminal = TERMINAL_SESSION_STATUSES.has(p.status);
  sharedState = {
    ...sharedState,
    [p.boothId]: {
      online: existing?.online ?? true,
      inSession: !isTerminal,
      bridgeOnline: existing?.bridgeOnline ?? true,
      lastSeenAt: existing?.lastSeenAt ?? new Date().toISOString(),
      activeSessionId: isTerminal ? undefined : p.sessionId,
      activeSessionStatus: isTerminal ? undefined : p.status,
    },
  };
  notify();
}

function ensureClient(): void {
  if (sharedClient) return;
  sharedClient = createWsClient({ url: () => wsUrl("/ws/admin") });
  sharedClient.on(SocketEvents.ADMIN_BOOTH_STATUS, handleBoothStatus);
  sharedClient.on(SocketEvents.ADMIN_SESSION_UPDATE, handleSessionUpdate);
}

function teardownClient(): void {
  sharedClient?.off(SocketEvents.ADMIN_BOOTH_STATUS, handleBoothStatus);
  sharedClient?.off(SocketEvents.ADMIN_SESSION_UPDATE, handleSessionUpdate);
  sharedClient?.close();
  sharedClient = null;
  sharedState = {};
}

export function useAdminBoothStatuses(): Record<string, LiveBoothStatus> {
  const [state, setState] = useState<StatusMap>(sharedState);

  useEffect(() => {
    refCount += 1;
    ensureClient();
    subscribers.add(setState);
    // Pick up whatever the shared client already knows about (e.g. a second
    // component mounting after the snapshot already arrived).
    setState(sharedState);

    return () => {
      subscribers.delete(setState);
      refCount -= 1;
      if (refCount <= 0) {
        refCount = 0;
        teardownClient();
      }
    };
  }, []);

  return state;
}
