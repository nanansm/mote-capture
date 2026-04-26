"use client";

import { useEffect, useState } from "react";
import { io as createSocket, type Socket } from "socket.io-client";
import { SocketEvents, type AdminBoothStatusPayload, type AdminSessionUpdatePayload } from "@capture/shared";

export type LiveBoothStatus = {
  online: boolean;
  inSession: boolean;
  bridgeOnline: boolean;
  lastSeenAt: string | null;
  activeSessionId?: string;
  activeSessionStatus?: string;
};

let sharedSocket: Socket | null = null;

function getAdminSocket(): Socket {
  if (sharedSocket && sharedSocket.connected) return sharedSocket;
  if (sharedSocket) return sharedSocket;
  sharedSocket = createSocket({
    auth: { type: "admin" },
    transports: ["websocket", "polling"],
    withCredentials: true,
  });
  return sharedSocket;
}

export function useAdminBoothStatuses(): Record<string, LiveBoothStatus> {
  const [statuses, setStatuses] = useState<Record<string, LiveBoothStatus>>({});

  useEffect(() => {
    const socket = getAdminSocket();
    const onBoothStatus = (payload: AdminBoothStatusPayload) => {
      setStatuses((prev) => ({
        ...prev,
        [payload.boothId]: {
          online: payload.online,
          inSession: payload.inSession,
          bridgeOnline: payload.bridgeOnline,
          lastSeenAt: payload.lastSeenAt,
          activeSessionId: prev[payload.boothId]?.activeSessionId,
          activeSessionStatus: prev[payload.boothId]?.activeSessionStatus,
        },
      }));
    };
    const onSessionUpdate = (payload: AdminSessionUpdatePayload) => {
      setStatuses((prev) => {
        const cur = prev[payload.boothId] ?? {
          online: false,
          inSession: false,
          bridgeOnline: false,
          lastSeenAt: null,
        };
        const inSession = payload.status !== "done" && payload.status !== "failed" && payload.status !== "expired";
        return {
          ...prev,
          [payload.boothId]: {
            ...cur,
            inSession,
            activeSessionId: inSession ? payload.sessionId : undefined,
            activeSessionStatus: inSession ? payload.status : undefined,
          },
        };
      });
    };
    socket.on(SocketEvents.ADMIN_BOOTH_STATUS, onBoothStatus);
    socket.on(SocketEvents.ADMIN_SESSION_UPDATE, onSessionUpdate);
    if (!socket.connected) socket.connect();

    return () => {
      socket.off(SocketEvents.ADMIN_BOOTH_STATUS, onBoothStatus);
      socket.off(SocketEvents.ADMIN_SESSION_UPDATE, onSessionUpdate);
    };
  }, []);

  return statuses;
}
