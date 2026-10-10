// iPaymu relay: Worker capture (IP Cloudflare acak) -> server ber-IP tetap
// 168.110.206.242 yang di-whitelist iPaymu. Hanya meneruskan, tidak menyimpan,
// tidak me-log body/header rahasia. Kredensial (va/signature) dibuat Worker.
import http from "node:http";
import crypto from "node:crypto";
const TOKEN = process.env.RELAY_TOKEN || "";
if (TOKEN.length < 32) { console.error("RELAY_TOKEN wajib >=32 char"); process.exit(1); }
const BASE = { production: "https://my.ipaymu.com/api/v2", sandbox: "https://sandbox.ipaymu.com/api/v2" };
const PATHS = new Set(["/payment/direct", "/transaction", "/balance"]);
const tokOk = (t) => { const a = Buffer.from(String(t || "")), b = Buffer.from(TOKEN); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const send = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") return send(res, 200, { ok: true });
  const path = (req.url || "").replace(/^\/v2/, "").split("?")[0];
  if (req.method !== "POST" || !req.url?.startsWith("/v2/") || !PATHS.has(path)) return send(res, 404, { error: "not found" });
  if (!tokOk(req.headers["x-relay-token"])) return send(res, 401, { error: "unauthorized" });
  const mode = req.headers["x-ipaymu-mode"] === "sandbox" ? "sandbox" : "production";
  const chunks = []; let size = 0;
  req.on("data", (c) => { size += c.length; if (size > 65536) { req.destroy(); } else chunks.push(c); });
  req.on("end", async () => {
    const t0 = Date.now();
    try {
      const up = await fetch(BASE[mode] + path, {
        method: "POST", body: Buffer.concat(chunks), signal: AbortSignal.timeout(20000),
        headers: { "content-type": "application/json", accept: "application/json", va: String(req.headers.va || ""), signature: String(req.headers.signature || ""), timestamp: String(req.headers.timestamp || "") },
      });
      const text = await up.text();
      console.log(JSON.stringify({ at: new Date().toISOString(), path, mode, status: up.status, ms: Date.now() - t0 }));
      res.writeHead(up.status, { "content-type": up.headers.get("content-type") || "application/json" }); res.end(text);
    } catch (e) {
      console.log(JSON.stringify({ at: new Date().toISOString(), path, mode, error: String(e?.name || e) }));
      send(res, 502, { error: "relay upstream error" });
    }
  });
}).listen(8787, () => console.log("ipaymu-relay :8787"));
