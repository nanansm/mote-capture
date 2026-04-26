// Custom Next.js server with Socket.io attached. Runs Next via its handler so
// HMR + middleware + RSC all keep working, then upgrades the same HTTP server
// for socket.io connections.
import { createServer } from "node:http";
import { parse } from "node:url";
import path from "node:path";
import fs from "node:fs";
import next from "next";

// Load env from repo root before anything else (Next does this for us when
// it's the entrypoint, but this server runs first).
function loadRootEnv() {
  const root = path.join(__dirname, "../..");
  for (const file of [".env", ".env.local"]) {
    const p = path.join(root, file);
    if (!fs.existsSync(p)) continue;
    const content = fs.readFileSync(p, "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}
loadRootEnv();

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 5000);

async function main() {
  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();
  await app.prepare();

  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url ?? "/", true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error("[server] handler error", err);
      res.statusCode = 500;
      res.end("internal error");
    }
  });

  // Lazy-load to avoid circular import with the Next app
  const { initSocket } = await import("./lib/socket/server");
  await initSocket(server);

  server.listen(port, hostname, () => {
    console.log(`[server] ready on http://${hostname}:${port}`);
  });

  const shutdown = (signal: string) => {
    console.log(`[server] ${signal} received, closing...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[server] fatal", err);
  process.exit(1);
});
