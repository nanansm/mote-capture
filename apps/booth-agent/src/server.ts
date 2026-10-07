// HTTP + ws server booth-agent (PRD bagian 9). Listen 127.0.0.1:7777.
//   /                      -> build statis kiosk (apps/web/dist), fallback SPA
//   /api/*, /ws/*          -> proxy ke Workers (API_ORIGIN)
//   /agent/ws              -> event agent -> kiosk
//   /health, /session/*, /print/*, /staff/*, /files/*, /preview.mjpeg
import fs from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import fastifyHttpProxy from "@fastify/http-proxy";
import { STAFF_TOKEN_HEADER } from "@capture/shared";
import { AgentError, type BoothAgent } from "./agent.js";
import type { Hub } from "./hub.js";
import type { FrameCache } from "./frames.js";
import { MockCamera } from "./drivers/camera.js";
import { MockPrinter } from "./drivers/printer.js";

type Body = Record<string, unknown>;

export async function buildServer(agent: BoothAgent, hub: Hub, frames: FrameCache): Promise<FastifyInstance> {
  const cfg = agent.cfg;
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 });

  // Body JSON kosong ({} atau tanpa body) tetap diterima.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    if (!body) return done(null, {});
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(null, {});
    }
  });

  // CORS hanya untuk rig uji (kiosk dan agent beda origin). Produksi: same-origin.
  if (cfg.testControls) {
    app.addHook("onRequest", async (req, reply) => {
      reply.header("access-control-allow-origin", "*");
      reply.header("access-control-allow-headers", `content-type, ${STAFF_TOKEN_HEADER}`);
      reply.header("access-control-allow-methods", "GET, POST, OPTIONS");
      if (req.method === "OPTIONS") return reply.code(204).send();
    });
  }

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AgentError) return sendAgentError(reply, err);
    reply.code(500).send({ error: "INTERNAL", message: err instanceof Error ? err.message : String(err) });
  });

  // ── ws agent ──
  await app.register(fastifyWebsocket);
  app.register(async (scope) => {
    scope.get("/agent/ws", { websocket: true }, (socket) => {
      hub.add(socket);
      socket.send(JSON.stringify({ type: "camera.status", ...agent.camera.status() }));
      socket.send(JSON.stringify({ type: "counters.updated", ...agent.counters() }));
      socket.on("close", () => hub.remove(socket));
      socket.on("error", () => hub.remove(socket));
    });
  });

  // ── proxy ke Workers ──
  // Scope terpisah: proxy memasang parser body passthrough sendiri, bentrok
  // dengan parser JSON agent kalau satu scope.
  for (const prefix of ["/api", "/ws"]) {
    await app.register(async (scope) => {
      scope.removeAllContentTypeParsers();
      await scope.register(fastifyHttpProxy, {
        upstream: cfg.apiOrigin,
        prefix,
        rewritePrefix: prefix,
        websocket: prefix === "/ws",
        http2: false,
      });
    });
  }

  // ── status ──
  app.get("/health", async () => agent.health());

  app.get("/preview.mjpeg", async (_req, reply) => {
    // Stream Brio diisi M4 (butuh /dev/v4l). Kiosk tetap jalan tanpa preview.
    return reply.code(404).send({ error: "PREVIEW_UNAVAILABLE" });
  });

  app.get<{ Params: { id: string; name: string } }>("/files/sessions/:id/:name", async (req, reply) => {
    const p = agent.resolveFile(req.params.id, req.params.name);
    if (!p) return reply.code(404).send({ error: "NOT_FOUND" });
    reply.header("content-type", "image/jpeg").header("cache-control", "no-store");
    return reply.send(fs.createReadStream(p));
  });

  // ── sesi ──
  app.post<{ Body: Body }>("/session/start", async (req) => {
    const { sessionId, frameId } = req.body ?? {};
    if (typeof sessionId !== "string") throw new AgentError(400, "BAD_BODY");
    await agent.startSession(sessionId, typeof frameId === "string" ? frameId : null);
    return { ok: true };
  });
  app.post<{ Params: { id: string }; Body: Body }>("/session/:id/capture", async (req) => {
    agent.shoot(req.params.id, Number(req.body?.slot), false);
    return { accepted: true };
  });
  app.post<{ Params: { id: string }; Body: Body }>("/session/:id/retake", async (req) => {
    agent.shoot(req.params.id, Number(req.body?.slot), true);
    return { accepted: true };
  });
  app.post<{ Params: { id: string } }>("/session/:id/compose", async (req) => {
    return { compositePath: await agent.compose(req.params.id) };
  });

  // ── staf ──
  app.post<{ Body: Body }>("/staff/login", async (req, reply) => {
    try {
      return await agent.staffLogin(String(req.body?.pin ?? ""));
    } catch (err) {
      if (err instanceof AgentError && err.code === "WRONG_PIN") {
        return reply.code(401).send({ error: "WRONG_PIN", attemptsLeft: Number(err.message) });
      }
      if (err instanceof AgentError && err.code === "LOCKED") {
        return reply.code(423).send({ error: "LOCKED", lockedUntil: err.message });
      }
      throw err;
    }
  });

  app.register(async (staff) => {
    staff.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
      if (!agent.staffOk(req.headers[STAFF_TOKEN_HEADER])) return reply.code(401).send({ error: "STAFF_AUTH" });
    });
    staff.post("/staff/camera-reset", async () => {
      const camera = await agent.cameraReset();
      return { ok: camera.connected, camera };
    });
    staff.post<{ Body: Body }>("/staff/cancel-voucher", async (req) => {
      return agent.cancelVoucher(String(req.body?.sessionId ?? ""));
    });
    staff.post<{ Body: Body }>("/staff/counters", async (req) => agent.setCounters(req.body ?? {}));
    staff.get("/staff/sessions", async () => agent.recentSessions());
    staff.get("/staff/queue", async () => ({ counts: agent.queue.counts(), jobs: agent.queue.list() }));
    staff.post("/staff/queue/retry", async () => ({ retried: agent.queue.retryFailed() }));
    staff.post<{ Body: Body }>("/print/reprint", async (req) => ({
      jobId: await agent.reprint(String(req.body?.sessionId ?? ""), Number(req.body?.sheet)),
    }));
    staff.post<{ Body: Body }>("/print", async (req) => ({
      jobIds: await agent.printCopies(String(req.body?.sessionId ?? ""), Number(req.body?.copies ?? 2)),
    }));
  });

  // ── kontrol uji (rig e2e saja; config menolak bila driver asli) ──
  if (cfg.testControls) {
    app.addHook("onResponse", async (req, reply) => {
      const p = req.url.split("?")[0]!;
      if (req.method !== "OPTIONS" && /^\/(session|staff|print)(\/|$)/.test(p)) agent.cloudLog.push({ method: req.method, path: p, status: reply.statusCode, at: Date.now() });
    });
    const cam = agent.camera as MockCamera;
    const prn = agent.printer as MockPrinter;
    app.post("/__mock/reset", async () => {
      cam.resetMock();
      prn.resetMock();
      agent.resetForTest();
      hub.emit({ type: "camera.status", ...cam.status() });
      return { ok: true };
    });
    app.post<{ Body: Body }>("/__mock/camera", async (req) => {
      const st = cam.setConnected(!!req.body?.connected);
      hub.emit({ type: "camera.status", ...st });
      return st;
    });
    app.post("/__mock/fail-next-capture", async () => {
      cam.failNextCapture();
      return { ok: true };
    });
    app.post<{ Body: Body }>("/__mock/printer", async (req) => {
      prn.setStopped(typeof req.body?.stopped === "string" ? req.body.stopped : null);
      return { ok: true };
    });
    app.get("/__mock/log", async () => agent.cloudLog);
    app.get("/__mock/prints", async () => prn.submitted);
    app.post("/__mock/refresh-frames", async () => ({ ok: await frames.refresh() }));
  }

  // ── kiosk statis + fallback SPA ──
  if (cfg.webDist && fs.existsSync(path.join(cfg.webDist, "index.html"))) {
    await app.register(fastifyStatic, { root: cfg.webDist, wildcard: false, index: false });
    const indexHtml = fs.readFileSync(path.join(cfg.webDist, "index.html"));
    app.setNotFoundHandler((req, reply) => {
      const p = req.url.split("?")[0]!;
      if (req.method === "GET" && !/^\/(api|ws|agent|staff|session|files|__mock)(\/|$)/.test(p)) {
        if (/\.[a-z0-9]+$/i.test(p)) {
          const f = path.join(cfg.webDist!, path.normalize(p).replace(/^(\.\.[/\\])+/, ""));
          if (f.startsWith(cfg.webDist!) && fs.existsSync(f)) return reply.sendFile(path.relative(cfg.webDist!, f));
          return reply.code(404).send({ error: "NOT_FOUND" });
        }
        return reply.type("text/html").header("cache-control", "no-store").send(indexHtml);
      }
      reply.code(404).send({ error: "NOT_FOUND", path: p });
    });
  } else {
    app.setNotFoundHandler((req, reply) => reply.code(404).send({ error: "NOT_FOUND", path: req.url }));
  }

  return app;
}

function sendAgentError(reply: FastifyReply, err: AgentError) {
  return reply.code(err.status).send({ error: err.code, ...(err.message !== err.code ? { message: err.message } : {}) });
}
