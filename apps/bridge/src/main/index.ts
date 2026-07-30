// Electron main entry — owns the app lifecycle and wires services together.
import { app, dialog } from "electron";
import path from "node:path";
import { logger } from "./logger";
import { ensureDirs } from "./paths";
import { getStore } from "./config/store";
import { makeCloudClient, errMsg } from "./cloud-api";
import { SocketClient } from "./socket-client";
import { BridgeHandlers } from "./handlers";
import { HeartbeatLoop } from "./handlers/heartbeat";
import { createTray, setTrayState, destroyTray } from "./tray";
import { showConfigWindow, getOrCreateConfigWindow, setAppQuitting } from "./window";
import { registerIpc } from "./ipc";
import { startLocalServer, type LocalServer } from "./local-server";
import { installCrashWatchdog, applyLoginItem } from "./watchdog";
import { updateKioskShortcuts } from "./kiosk-shortcut";
import type { BridgeConfig } from "../shared/types";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require("../../package.json") as { version: string };
const BRIDGE_VERSION = pkg.version;

let client: SocketClient | null = null;
let handlers: BridgeHandlers | null = null;
let heartbeat: HeartbeatLoop | null = null;
let localServer: LocalServer | null = null;

async function bootstrap(): Promise<void> {
  ensureDirs();
  logger.info("bridge_start", { version: BRIDGE_VERSION, platform: process.platform });

  // Install crash handlers before anything else can throw, so a failure during
  // the rest of bootstrap triggers a throttled relaunch instead of a dead app.
  installCrashWatchdog();

  // Start the local HTTP proxy early so the kiosk can hit /live-preview
  // even if cloud auth fails or the bridge token isn't set yet. The preview
  // source is read lazily on every request because `handlers` does not exist
  // yet at this point, and the camera instance is swapped out whenever the
  // user saves a new mode in the config UI.
  try {
    localServer = await startLocalServer(undefined, () => {
      const camera = handlers?.cameraInstance();
      return camera?.getPreviewFrame?.() ?? null;
    });
  } catch (err) {
    logger.warn("local_server_start_failed", { err: errMsg(err) });
  }

  const store = await getStore();
  let config: BridgeConfig = store.store;
  logger.info("bridge_config_loaded", {
    storePath: store.path,
    cameraMode: config.cameraMode,
    printerMode: config.printerMode,
    hasToken: !!config.bridgeToken,
    boothId: config.boothId,
  });

  // Sync the OS login item to the persisted preference on every boot, so the
  // setting self-heals if the registry entry was removed out-of-band.
  applyLoginItem(config.autoStart);

  // If boothId is missing but token is present, try to resolve from cloud.
  if (config.bridgeToken && !config.boothId) {
    const cloud = makeCloudClient({ baseUrl: config.cloudUrl, token: config.bridgeToken });
    const resolved = await cloud.resolveBoothByToken().catch(() => null);
    if (resolved) {
      store.set({ boothId: resolved.boothId });
      config = store.store;
    }
  }

  client = new SocketClient({
    cloudUrl: config.cloudUrl,
    bridgeToken: config.bridgeToken,
    boothId: config.boothId,
    bridgeVersion: BRIDGE_VERSION,
  });

  const cloud = makeCloudClient({ baseUrl: config.cloudUrl, token: config.bridgeToken });
  handlers = new BridgeHandlers({ client, cloud, config });
  await handlers.init();
  handlers.attach();

  heartbeat = new HeartbeatLoop({
    cloud,
    client,
    boothId: config.boothId,
    camera: () => handlers!.cameraInstance(),
    printer: () => handlers!.printerInstance(),
    bridgeVersion: BRIDGE_VERSION,
  });
  heartbeat.start();

  client.on("status", (status) => {
    if (status.connected) {
      setTrayState("online", `Mote Capture Bridge — Online (${config.boothId || "no-booth"})`);
    } else if (status.connecting) {
      setTrayState("busy", `Mote Capture Bridge — Connecting…`);
    } else {
      setTrayState("offline", status.lastError ? `Offline: ${status.lastError}` : "Offline");
    }
  });

  registerIpc({
    client,
    handlers,
    heartbeat,
    reconnectWithConfig: async (newConfig) => {
      // Rebuild cloud client with new token/url
      const newCloud = makeCloudClient({
        baseUrl: newConfig.cloudUrl,
        token: newConfig.bridgeToken,
      });

      // If boothId still missing but token present, resolve from cloud.
      if (newConfig.bridgeToken && !newConfig.boothId) {
        const resolved = await newCloud.resolveBoothByToken().catch(() => null);
        if (resolved) {
          store.set({ boothId: resolved.boothId });
          newConfig = store.store;
        }
      }

      // Now that boothId (and cloudUrl) are final for this save, rewrite the
      // installer's kiosk Edge shortcuts to the actual kiosk screen instead
      // of the domain root. No-op off Windows or while boothId/cloudUrl are
      // still unset.
      updateKioskShortcuts(newConfig.cloudUrl, newConfig.boothId);

      // Replace handlers' cloud + config + devices.
      await handlers!.rebuildDevices(newConfig);
      // Patch heartbeat opts (boothId/cloud).
      const newHeartbeat = new HeartbeatLoop({
        cloud: newCloud,
        client: client!,
        boothId: newConfig.boothId,
        camera: () => handlers!.cameraInstance(),
        printer: () => handlers!.printerInstance(),
        bridgeVersion: BRIDGE_VERSION,
      });
      heartbeat?.stop();
      heartbeat = newHeartbeat;
      heartbeat.start();
      // Re-create handlers' cloud reference.
      (handlers as unknown as { deps: { cloud: ReturnType<typeof makeCloudClient> } }).deps.cloud = newCloud;

      client!.reconnect({
        cloudUrl: newConfig.cloudUrl,
        bridgeToken: newConfig.bridgeToken,
        boothId: newConfig.boothId,
      });
    },
  });

  createTray({
    onShowConfig: () => showConfigWindow(),
    onTestCamera: async () => {
      try {
        const result = await handlers!.cameraInstance().testConnection();
        if (!result.ok) {
          dialog.showErrorBox("Test Capture", result.error ?? "Unknown error");
        }
      } catch (err) {
        dialog.showErrorBox("Test Capture", errMsg(err));
      }
    },
    onTestPrint: async () => {
      try {
        const cap = await handlers!.cameraInstance().capture();
        const result = await handlers!.printerInstance().print(cap.filePath);
        if (!result.ok) {
          dialog.showErrorBox("Test Print", result.error ?? "Unknown error");
        }
      } catch (err) {
        dialog.showErrorBox("Test Print", errMsg(err));
      }
    },
    onOpenCloud: () => {
      void import("electron").then(({ shell }) => {
        const url = config.cloudUrl.replace(/\/$/, "") + "/admin";
        shell.openExternal(url);
      });
    },
  });

  // Open the config window on first run (no token yet) so the user can paste
  // it without hunting for the tray.
  if (!config.bridgeToken) {
    getOrCreateConfigWindow();
  } else {
    // Also open on first launch so user sees status — they can hide via close.
    getOrCreateConfigWindow();
    client.connect();
  }
}

app.whenReady().then(() => {
  bootstrap().catch((err) => {
    logger.error("bridge_bootstrap_failed", { err: errMsg(err) });
    dialog.showErrorBox("Mote Capture Bridge", errMsg(err));
  });
});

app.on("window-all-closed", () => {
  // No-op — keep the bridge alive in the tray. Quit only via tray menu.
});

app.on("before-quit", () => {
  setAppQuitting();
  heartbeat?.stop();
  client?.disconnect();
  void localServer?.close();
  destroyTray();
});

// Squelch unused param warning for path
void path;
