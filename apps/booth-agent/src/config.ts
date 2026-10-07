// Konfigurasi booth-agent dari env (PRD bagian 9). Nol rahasia di repo:
// BRIDGE_TOKEN dibaca dari /etc/booth-agent/env (systemd EnvironmentFile).
import path from "node:path";

export type CameraDriverName = "mock" | "gphoto2";
export type PrinterDriverName = "mock" | "cups";

export type AgentConfig = {
  host: string;
  port: number;
  apiOrigin: string;
  /** Basis URL publik R2 untuk artwork frame (`layoutJson.artworkKey`). */
  cdnBase: string;
  boothId: string;
  bridgeToken: string;
  dataDir: string;
  webDist: string | null;
  cameraDriver: CameraDriverName;
  printerDriver: PrinterDriverName;
  lpPrinter: string;
  /** Opsi `lp` dari `lpoptions -p selphy -l` saat T1, mis. "-o PageSize=Postcard -o Borderless=True". */
  lpOptions: string[];
  /** Kontrol uji `/__mock/*` + CORS. HANYA untuk rig e2e, ditolak bila driver asli. */
  testControls: boolean;
  version: string;
  heartbeatMs: number;
  frameRefreshMs: number;
};

function req(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key]?.trim();
  if (!v) throw new Error(`env ${key} wajib diisi`);
  return v;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const cameraDriver = (env.CAMERA_DRIVER ?? "gphoto2") as CameraDriverName;
  const printerDriver = (env.PRINTER_DRIVER ?? "cups") as PrinterDriverName;
  if (!["mock", "gphoto2"].includes(cameraDriver)) throw new Error(`CAMERA_DRIVER tidak dikenal: ${cameraDriver}`);
  if (!["mock", "cups"].includes(printerDriver)) throw new Error(`PRINTER_DRIVER tidak dikenal: ${printerDriver}`);
  const testControls = env.AGENT_TEST_CONTROLS === "1";
  if (testControls && (cameraDriver !== "mock" || printerDriver !== "mock")) {
    throw new Error("AGENT_TEST_CONTROLS=1 hanya boleh dengan CAMERA_DRIVER=mock dan PRINTER_DRIVER=mock");
  }
  const port = Number(env.AGENT_PORT ?? 7777);
  if (!Number.isInteger(port) || port <= 0) throw new Error("AGENT_PORT tidak valid");

  return {
    host: env.AGENT_HOST ?? "127.0.0.1",
    port,
    apiOrigin: req(env, "API_ORIGIN").replace(/\/$/, ""),
    cdnBase: (env.CDN_BASE ?? "https://cdn.motekreatif.com").replace(/\/$/, ""),
    boothId: req(env, "BOOTH_ID"),
    bridgeToken: req(env, "BRIDGE_TOKEN"),
    dataDir: path.resolve(env.DATA_DIR ?? "/var/lib/booth-agent"),
    webDist: env.WEB_DIST ? path.resolve(env.WEB_DIST) : null,
    cameraDriver,
    printerDriver,
    lpPrinter: env.LP_PRINTER ?? "selphy",
    lpOptions: (env.LP_OPTIONS ?? "").split(/\s+/).filter(Boolean),
    testControls,
    version: env.AGENT_VERSION ?? "0.1.0",
    heartbeatMs: Number(env.HEARTBEAT_MS ?? 60_000),
    frameRefreshMs: Number(env.FRAME_REFRESH_MS ?? 5 * 60_000),
  };
}
