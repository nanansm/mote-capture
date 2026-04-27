// Tiny HTTP server bound to 127.0.0.1 that the kiosk browser polls for the
// camera live preview. Bridge runs on the same Mini PC as the kiosk browser,
// so localhost is reachable without DNS / TLS / cloud round-trips.
//
// Endpoints:
//   GET /healthz       -> "ok" (sanity probe)
//   GET /live-preview  -> proxies digiCamControl webserver /liveview.jpg
//
// The proxy adds permissive CORS headers so the cloud-served kiosk page
// (capture.motekreatif.com) can <img src="http://localhost:LOCAL_PORT/...">
// without browser CORS blocking. Binding to 127.0.0.1 keeps it private to
// the booth machine — nothing on the LAN can reach it.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { logger } from "./logger";

export const DEFAULT_LOCAL_PORT = 9876;
const DIGICAM_LIVE_VIEW_URL = "http://127.0.0.1:5513/liveview.jpg";

// Match the cloud's deployed domains plus localhost so the kiosk can run
// either against prod or a dev server.
const CORS_ORIGIN_ALLOWLIST = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https?:\/\/(.+\.)?motekreatif\.com$/,
];

function corsHeadersFor(origin: string | undefined): Record<string, string> {
  const allowOrigin =
    origin && CORS_ORIGIN_ALLOWLIST.some((re) => re.test(origin)) ? origin : "*";
  return {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
    vary: "origin",
  };
}

export type LocalServer = {
  port: number;
  close: () => Promise<void>;
};

export async function startLocalServer(
  port = DEFAULT_LOCAL_PORT,
): Promise<LocalServer> {
  const server = http.createServer((req, res) => {
    const cors = corsHeadersFor(req.headers.origin);

    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      res.end();
      return;
    }

    const url = req.url ?? "/";

    if (url === "/healthz") {
      res.writeHead(200, { ...cors, "content-type": "text/plain" });
      res.end("ok");
      return;
    }

    if (url.startsWith("/live-preview")) {
      void proxyLivePreview(res, cors).catch((err) => {
        logger.warn("live_preview_proxy_error", {
          err: err instanceof Error ? err.message : String(err),
        });
        if (!res.headersSent) {
          res.writeHead(502, { ...cors, "content-type": "text/plain" });
          res.end("upstream error");
        }
      });
      return;
    }

    res.writeHead(404, { ...cors, "content-type": "text/plain" });
    res.end("not found");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const addr = server.address() as AddressInfo;
  const boundPort = addr.port;
  logger.info("local_server_listening", { port: boundPort });

  return {
    port: boundPort,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

async function proxyLivePreview(
  res: http.ServerResponse,
  cors: Record<string, string>,
): Promise<void> {
  // 2.5s budget — the kiosk polls every ~150ms, no value in waiting longer.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  let upstream: Response;
  try {
    upstream = await fetch(DIGICAM_LIVE_VIEW_URL, { signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    res.writeHead(503, { ...cors, "content-type": "text/plain" });
    res.end("live view unavailable");
    logger.debug("live_preview_unreachable", {
      err: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  clearTimeout(timer);

  if (!upstream.ok) {
    res.writeHead(upstream.status, { ...cors, "content-type": "text/plain" });
    res.end(`upstream ${upstream.status}`);
    return;
  }

  const buf = Buffer.from(await upstream.arrayBuffer());
  res.writeHead(200, {
    ...cors,
    "content-type": upstream.headers.get("content-type") ?? "image/jpeg",
    "cache-control": "no-store, no-cache, must-revalidate",
    "content-length": String(buf.byteLength),
  });
  res.end(buf);
}
