// Entry booth-agent: rakit driver + DB + server, tangani SIGTERM dengan rapi.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { loadConfig, type AgentConfig } from "./config.js";
import { openDb, closeDb } from "./db.js";
import { createLogger } from "./log.js";
import { Cloud } from "./cloud.js";
import { FrameCache } from "./frames.js";
import { Hub } from "./hub.js";
import { BoothAgent } from "./agent.js";
import { Gphoto2Camera, MockCamera, type CameraDriver } from "./drivers/camera.js";
import { CupsPrinter, MockPrinter, type PrinterDriver } from "./drivers/printer.js";
import { buildServer } from "./server.js";

export async function startAgent(cfg: AgentConfig, opts: { silent?: boolean } = {}) {
  const log = createLogger(opts.silent);
  const db = openDb(cfg.dataDir);
  const cloud = new Cloud(cfg);
  const hub = new Hub();
  const frames = new FrameCache(cfg.dataDir, cloud, cfg.cdnBase, log);
  await frames.init();
  const camera: CameraDriver = cfg.cameraDriver === "mock" ? new MockCamera() : new Gphoto2Camera();
  const printer: PrinterDriver = cfg.printerDriver === "mock" ? new MockPrinter() : new CupsPrinter();
  const agent = new BoothAgent(cfg, db, camera, printer, cloud, frames, hub, log);
  await agent.start();
  void frames.refresh();

  const app = await buildServer(agent, hub, frames);
  await app.listen({ host: cfg.host, port: cfg.port });
  log.info("agent_listening", { host: cfg.host, port: cfg.port, camera: camera.name, printer: printer.name, booth: cfg.boothId });

  const timers = [
    setInterval(() => void agent.heartbeat().catch(() => undefined), cfg.heartbeatMs),
    setInterval(() => void frames.refresh().catch(() => undefined), cfg.frameRefreshMs),
    setInterval(() => void agent.cleanup().catch(() => undefined), 6 * 60 * 60_000),
  ];
  void agent.heartbeat().catch(() => undefined);
  void agent.cleanup().catch(() => undefined);

  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    timers.forEach(clearInterval);
    await app.close().catch(() => undefined);
    await agent.stop();
    closeDb(db);
    log.info("agent_stopped");
  };
  return { app, agent, hub, frames, db, close };
}

// realpath: di mini PC agent dijalankan lewat symlink /opt/booth-agent/current, sedangkan
// import.meta.url berisi path asli. Tanpa realpath agent keluar diam-diam (exit 0) tanpa listen.
function isEntry(): boolean {
  const arg = process.argv[1];
  if (!arg) return false;
  try {
    return fs.realpathSync(arg) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
if (isEntry()) {
  const cfg = loadConfig();
  const h = await startAgent(cfg).catch((err: unknown) => {
    console.error(JSON.stringify({ t: new Date().toISOString(), level: "error", msg: "agent_start_failed", error: err instanceof Error ? err.message : String(err) }));
    process.exit(1);
  });
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.on(sig, () => {
      void h.close().finally(() => process.exit(0));
    });
  }
}
