import type { Server as HttpServer } from "node:http";
import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";
import { Server as IOServer } from "socket.io";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { registerKioskHandlers } from "./handlers/kiosk";
import { registerBridgeHandlers } from "./handlers/bridge";
import { registerAdminHandlers } from "./handlers/admin";
import { SocketEvents } from "@capture/shared";

type ConnectionType = "kiosk" | "bridge" | "admin";

type CaptureSocketData = {
  type?: ConnectionType;
  boothId?: string;
  adminEmail?: string;
};

function getData(socket: { data: unknown }): CaptureSocketData {
  return (socket.data ??= {} as CaptureSocketData) as CaptureSocketData;
}

let io: IOServer | null = null;

export async function initSocket(httpServer: HttpServer): Promise<IOServer> {
  if (io) return io;

  io = new IOServer(httpServer, {
    cors: { origin: true, credentials: true },
    transports: ["websocket", "polling"],
    path: "/socket.io",
  });

  // Redis adapter — best-effort; if Redis is unreachable, fall back to in-memory
  // pubsub (single-instance only).
  if (env.REDIS_URL) {
    try {
      const pubClient = new Redis(env.REDIS_URL, {
        keyPrefix: env.REDIS_PREFIX + "socket:",
        lazyConnect: false,
        maxRetriesPerRequest: 2,
      });
      const subClient = pubClient.duplicate();
      io.adapter(createAdapter(pubClient, subClient));
      logger.info("socket_redis_adapter_ready", { url: env.REDIS_URL });
    } catch (err) {
      logger.warn("socket_redis_adapter_fallback", {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    logger.warn("socket_no_redis", { msg: "REDIS_URL not set, single-instance only" });
  }

  // Auth middleware: each connection declares type + credentials in handshake
  io.use(async (socket, next) => {
    const auth = (socket.handshake.auth ?? {}) as Record<string, unknown>;
    const type = typeof auth.type === "string" ? (auth.type as ConnectionType) : undefined;

    const data = getData(socket);
    if (type === "kiosk") {
      const boothId = typeof auth.boothId === "string" ? auth.boothId : "";
      if (!boothId) return next(new Error("missing boothId"));
      const [booth] = await db
        .select()
        .from(schema.booths)
        .where(eq(schema.booths.id, boothId))
        .limit(1);
      if (!booth) return next(new Error("booth not found"));
      if (!booth.isActive) return next(new Error("booth inactive"));
      data.type = "kiosk";
      data.boothId = boothId;
      return next();
    }

    if (type === "bridge") {
      const token = typeof auth.token === "string" ? auth.token : "";
      const boothId = typeof auth.boothId === "string" ? auth.boothId : "";
      if (!token || !boothId) return next(new Error("missing bridge credentials"));
      const [booth] = await db
        .select()
        .from(schema.booths)
        .where(eq(schema.booths.id, boothId))
        .limit(1);
      if (!booth || booth.bridgeToken !== token) {
        return next(new Error("invalid bridge token"));
      }
      data.type = "bridge";
      data.boothId = boothId;
      return next();
    }

    if (type === "admin") {
      // Cookie auth for admin. Read cookie from handshake headers.
      const cookieHeader = socket.handshake.headers.cookie ?? "";
      const cookies: Record<string, string> = {};
      for (const part of cookieHeader.split(";")) {
        const [k, ...rest] = part.trim().split("=");
        if (k) cookies[k] = decodeURIComponent(rest.join("=") ?? "");
      }
      const token = cookies[SESSION_COOKIE_NAME];
      const session = verifySessionToken(token);
      if (!session) return next(new Error("admin not authenticated"));
      data.type = "admin";
      data.adminEmail = session.email;
      return next();
    }

    return next(new Error("unknown connection type"));
  });

  io.on("connection", (socket) => {
    const { type, boothId } = getData(socket);
    logger.info("socket_connected", { type, boothId, socketId: socket.id });

    if (type === "kiosk" && boothId) {
      socket.join(`booth:${boothId}`);
      registerKioskHandlers(io!, socket, boothId);
      // Notify admin overview that booth is in use (kiosk online)
      io!
        .to("admin:overview")
        .emit(SocketEvents.ADMIN_BOOTH_STATUS, {
          boothId,
          online: true,
          inSession: false,
          lastSeenAt: new Date().toISOString(),
          bridgeOnline: false,
        });
    } else if (type === "bridge" && boothId) {
      socket.join(`booth:${boothId}`);
      socket.join(`bridge:${boothId}`);
      registerBridgeHandlers(io!, socket, boothId);
    } else if (type === "admin") {
      socket.join("admin:overview");
      registerAdminHandlers(io!, socket);
    }

    socket.on("disconnect", (reason) => {
      logger.info("socket_disconnected", { type, boothId, reason });
      if (type === "kiosk" && boothId) {
        io!
          .to("admin:overview")
          .emit(SocketEvents.ADMIN_BOOTH_STATUS, {
            boothId,
            online: false,
            inSession: false,
            lastSeenAt: new Date().toISOString(),
            bridgeOnline: false,
          });
      }
    });
  });

  // Stash on globalThis so route handlers can access without re-init
  (globalThis as unknown as { __captureIo?: IOServer }).__captureIo = io;
  return io;
}

export function getIo(): IOServer | null {
  if (io) return io;
  const stashed = (globalThis as unknown as { __captureIo?: IOServer }).__captureIo;
  if (stashed) {
    io = stashed;
    return io;
  }
  return null;
}

export function emitToBooth(
  boothId: string,
  event: string,
  payload: unknown,
): void {
  const server = getIo();
  if (!server) {
    logger.warn("socket_emit_no_server", { event, boothId });
    return;
  }
  server.to(`booth:${boothId}`).emit(event, payload);
}

export function emitToAdmin(event: string, payload: unknown): void {
  const server = getIo();
  if (!server) return;
  server.to("admin:overview").emit(event, payload);
}
