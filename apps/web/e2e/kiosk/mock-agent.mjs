// Mock booth-agent untuk e2e kiosk (PRD bagian 9). Meniru kontrak HTTP + ws
// `/agent/ws` milik agent mini PC, dan memanggil bridge cloud SUNGGUHAN
// (`/api/bridge/session/:id/done`, `/cancel-voucher`) di wrangler dev lokal.
// Kamera/printer palsu; semua lainnya (DO, D1, pembayaran mock) asli.
//
// Kontrol uji (bukan bagian kontrak agent):
//   POST /__mock/reset              -> state bersih, kamera nyala
//   POST /__mock/camera {connected} -> ubah status kamera + broadcast
//   POST /__mock/fail-next-capture  -> capture berikutnya memancarkan photo.failed
//   GET  /__mock/log                -> daftar panggilan (untuk asersi)
import http from "node:http";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.MOCK_AGENT_PORT ?? 9877);
const CLOUD = (process.env.MOCK_CLOUD_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const BRIDGE_TOKEN = process.env.MOCK_BRIDGE_TOKEN ?? "e2e-bridge-token";
const STAFF_PIN = process.env.MOCK_STAFF_PIN ?? "1234";
const STAFF_HEADER = "x-staff-token";
const PIN_MAX = 5;

// PNG 1x1 oranye (#FE7B00) untuk thumb/composite.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4V8/AAAT2Aeh8x5d0AAAAAElFTkSuQmCC",
  "base64",
);

let st;
function fresh() {
  st = {
    camera: { connected: true, model: "Canon EOS 2000D (mock)", lastError: null },
    counters: { paper: 36, ink: 36, lowPaper: false, lowInk: false },
    sessions: new Map(),
    active: null,
    failNextCapture: false,
    pinWrong: 0,
    lockedUntil: 0,
    tokens: new Set(),
    log: [],
  };
}
fresh();

const clients = new Set();
function broadcast(ev) {
  const s = JSON.stringify(ev);
  for (const ws of clients) {
    try {
      ws.send(s);
    } catch {
      /* klien putus */
    }
  }
}

function cors(res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", `content-type, ${STAFF_HEADER}`);
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
}
function json(res, code, body) {
  cors(res);
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
async function bridge(path, body) {
  const res = await fetch(`${CLOUD}/api/bridge${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${BRIDGE_TOKEN}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }
  return { status: res.status, body: parsed };
}

const later = (ms, fn) => setTimeout(fn, ms);

function sessionOf(id) {
  return st.sessions.get(id) ?? null;
}

function activeSnapshot() {
  const s = st.active ? sessionOf(st.active) : null;
  if (!s || s.phase === "finished") return null;
  const firstEmpty = s.thumbs.findIndex((x) => x === null);
  return {
    id: s.id,
    nextSlot: firstEmpty === -1 ? 4 : firstEmpty + 1,
    retakeUsed: s.retakeUsed,
    thumbs: s.thumbs,
    phase: s.phase,
  };
}

function shoot(s, slot, retake) {
  later(150, () => {
    if (!st.camera.connected || st.failNextCapture) {
      st.failNextCapture = false;
      broadcast({ type: "photo.failed", sessionId: s.id, slot, error: "gphoto2: I/O error (mock)" });
      return;
    }
    broadcast({ type: "shutter_fired", sessionId: s.id, slot });
    later(250, () => {
      s.thumbs[slot - 1] = `/files/${s.id}/thumb-${slot}${retake ? "-r" : ""}.png`;
      if (retake) s.retakeUsed[slot - 1] = true;
      s.phase = "reviewing";
      broadcast({
        type: "photo.ready",
        sessionId: s.id,
        slot,
        thumbUrl: s.thumbs[slot - 1],
        retakeUsed: s.retakeUsed[slot - 1],
      });
    });
  });
}

function staffOk(req) {
  const t = req.headers[STAFF_HEADER];
  return typeof t === "string" && st.tokens.has(t);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const p = url.pathname;
  if (req.method === "OPTIONS") {
    cors(res);
    res.writeHead(204);
    return res.end();
  }
  if (!p.startsWith("/__mock") && !p.startsWith("/files")) st.log.push({ method: req.method, path: p, at: Date.now() });

  try {
    // ── kontrol uji ──
    if (p === "/__mock/reset" && req.method === "POST") {
      fresh();
      return json(res, 200, { ok: true });
    }
    if (p === "/__mock/camera" && req.method === "POST") {
      const b = await readBody(req);
      st.camera = { ...st.camera, connected: !!b.connected, lastError: b.connected ? null : "USB: device not found (mock)" };
      broadcast({ type: "camera.status", ...st.camera });
      return json(res, 200, st.camera);
    }
    if (p === "/__mock/fail-next-capture" && req.method === "POST") {
      st.failNextCapture = true;
      return json(res, 200, { ok: true });
    }
    if (p === "/__mock/log") return json(res, 200, st.log);

    // ── aset ──
    if (p.startsWith("/files/")) {
      cors(res);
      res.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" });
      return res.end(PNG);
    }
    if (p === "/preview.mjpeg") {
      // Stream tidak ada di mock: kiosk wajib tetap jalan tanpa preview.
      cors(res);
      res.writeHead(404);
      return res.end();
    }

    // ── kontrak agent ──
    if (p === "/health" && req.method === "GET") {
      return json(res, 200, {
        camera: st.camera,
        printer: { state: "idle", reason: null },
        queue: { pending: 0, failed: 0 },
        counters: st.counters,
        activeSession: activeSnapshot(),
      });
    }
    if (p === "/session/start" && req.method === "POST") {
      const b = await readBody(req);
      if (!b.sessionId) return json(res, 400, { error: "BAD_BODY" });
      if (!sessionOf(b.sessionId)) {
        st.sessions.set(b.sessionId, {
          id: b.sessionId,
          frameId: b.frameId ?? null,
          thumbs: [null, null, null, null],
          retakeUsed: [false, false, false, false],
          phase: "capturing",
        });
      }
      st.active = b.sessionId;
      return json(res, 200, { ok: true });
    }
    let m = p.match(/^\/session\/([^/]+)\/(capture|retake|compose)$/);
    if (m && req.method === "POST") {
      const s = sessionOf(decodeURIComponent(m[1]));
      if (!s) return json(res, 404, { error: "NO_SESSION" });
      if (m[2] === "compose") {
        s.phase = "composing";
        const done = await bridge(`/session/${encodeURIComponent(s.id)}/done`);
        st.log.push({ method: "BRIDGE", path: "done", status: done.status, at: Date.now() });
        if (done.status !== 200) {
          broadcast({ type: "compose.failed", sessionId: s.id, error: `bridge done ${done.status}` });
          return json(res, 502, { error: "BRIDGE_DONE_FAILED", status: done.status });
        }
        s.phase = "finished";
        const compositeUrl = `/files/${s.id}/composite.png`;
        later(50, () => broadcast({ type: "compose.done", sessionId: s.id, compositeUrl }));
        later(100, () => broadcast({ type: "print.status", sessionId: s.id, sheet: 1, state: "printing", cupsJobId: 1 }));
        return json(res, 200, { compositePath: compositeUrl });
      }
      const b = await readBody(req);
      const slot = Number(b.slot);
      if (![1, 2, 3, 4].includes(slot)) return json(res, 400, { error: "BAD_SLOT" });
      if (m[2] === "retake") {
        if (s.retakeUsed[slot - 1]) return json(res, 409, { error: "RETAKE_USED" });
        if (!s.thumbs[slot - 1]) return json(res, 409, { error: "NO_PHOTO" });
      }
      s.phase = "capturing";
      shoot(s, slot, m[2] === "retake");
      return json(res, 200, { accepted: true });
    }

    if (p === "/staff/login" && req.method === "POST") {
      const now = Date.now();
      if (st.lockedUntil > now) return json(res, 423, { error: "LOCKED", lockedUntil: new Date(st.lockedUntil).toISOString() });
      const b = await readBody(req);
      if (String(b.pin ?? "") !== STAFF_PIN) {
        st.pinWrong += 1;
        if (st.pinWrong >= PIN_MAX) {
          st.lockedUntil = now + 5 * 60_000;
          st.pinWrong = 0;
          return json(res, 423, { error: "LOCKED", lockedUntil: new Date(st.lockedUntil).toISOString() });
        }
        return json(res, 401, { error: "WRONG_PIN", attemptsLeft: PIN_MAX - st.pinWrong });
      }
      st.pinWrong = 0;
      const token = `staff-${Math.random().toString(36).slice(2)}`;
      st.tokens.add(token);
      return json(res, 200, { token, expiresAt: new Date(now + 15 * 60_000).toISOString() });
    }
    if (p.startsWith("/staff/") || p === "/print/reprint") {
      if (!staffOk(req)) return json(res, 401, { error: "STAFF_AUTH" });
      if (p === "/staff/camera-reset") {
        st.camera = { ...st.camera, connected: true, lastError: null };
        broadcast({ type: "camera.status", ...st.camera });
        return json(res, 200, { ok: true, camera: st.camera });
      }
      if (p === "/staff/cancel-voucher") {
        const b = await readBody(req);
        const r = await bridge(`/session/${encodeURIComponent(b.sessionId)}/cancel-voucher`, { staff: "e2e" });
        st.log.push({ method: "BRIDGE", path: "cancel-voucher", status: r.status, at: Date.now() });
        if (r.status !== 200) return json(res, r.status, r.body);
        const s = sessionOf(b.sessionId);
        if (s) s.phase = "finished";
        return json(res, 200, { code: r.body.data.code, voucherId: r.body.data.voucherId });
      }
      if (p === "/staff/counters") {
        const b = await readBody(req);
        if (b.paperAdd) st.counters.paper += Number(b.paperAdd);
        if (b.inkSet !== undefined) st.counters.ink = Number(b.inkSet);
        st.counters.lowPaper = st.counters.paper < 6;
        st.counters.lowInk = st.counters.ink < 6;
        broadcast({ type: "counters.updated", ...st.counters });
        return json(res, 200, st.counters);
      }
      if (p === "/staff/sessions") {
        const list = [...st.sessions.values()]
          .filter((s) => s.phase === "finished")
          .map((s) => ({ id: s.id, compositeUrl: `/files/${s.id}/composite.png`, createdAt: new Date().toISOString() }));
        return json(res, 200, list);
      }
      if (p === "/print/reprint") return json(res, 200, { jobId: 2 });
    }
    return json(res, 404, { error: "NOT_FOUND", path: p });
  } catch (err) {
    return json(res, 500, { error: String(err) });
  }
});

const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  if (!req.url?.startsWith("/agent/ws")) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => {
    clients.add(ws);
    ws.send(JSON.stringify({ type: "camera.status", ...st.camera }));
    ws.on("close", () => clients.delete(ws));
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock-agent listening on http://127.0.0.1:${PORT}`);
});
