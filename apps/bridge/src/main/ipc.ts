// IPC handlers - bridge between renderer config UI and main-process services.
import { ipcMain, shell } from "electron";
import { IpcChannels } from "../shared/types";
import type { BridgeConfig, BridgeStatus, DeviceTestResult, LogEntry, PrinterMode, CameraMode } from "../shared/types";
import { getStore } from "./config/store";
import { logger, getLogDir, getRecentLogs, clearRecentLogs, subscribeLogs } from "./logger";
import { createPrinter } from "./printer";
import type { BridgeHandlers } from "./handlers";
import type { SocketClient } from "./socket-client";
import type { HeartbeatLoop } from "./handlers/heartbeat";
import { getConfigWindow } from "./window";

export type IpcServices = {
  client: SocketClient;
  handlers: BridgeHandlers;
  heartbeat: HeartbeatLoop;
  reconnectWithConfig: (config: BridgeConfig) => Promise<void>;
};

// Strip undefined values from a partial config patch before persisting -
// electron-store cannot serialize undefined and will throw. Renderers should
// send "" for empty string fields, but defend against undefined here too.
function sanitizePatch(patch: Partial<BridgeConfig>): Partial<BridgeConfig> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    out[k] = v;
  }
  return out as Partial<BridgeConfig>;
}

export function registerIpc(services: IpcServices): void {
  ipcMain.handle(IpcChannels.CONFIG_GET, async () => {
    const store = await getStore();
    return store.store;
  });

  ipcMain.handle(IpcChannels.CONFIG_SAVE, async (_e, patch: Partial<BridgeConfig>) => {
    const safe = sanitizePatch(patch);
    const store = await getStore();
    store.set(safe);
    const newConfig = store.store;
    logger.info("config_saved", { changedKeys: Object.keys(safe) });
    await services.reconnectWithConfig(newConfig);
    return newConfig;
  });

  ipcMain.handle(IpcChannels.STATUS_GET, async (): Promise<BridgeStatus> => {
    return services.client.getStatus();
  });

  ipcMain.handle(IpcChannels.CAMERA_TEST, async (): Promise<DeviceTestResult> => {
    const cam = services.handlers.cameraInstance();
    const result = await cam.testConnection();
    services.heartbeat.setCameraStatus({
      connected: result.ok,
      deviceName: result.deviceName,
      error: result.error,
    });
    void services.heartbeat.tick();
    return result;
  });

  ipcMain.handle(IpcChannels.PRINTER_TEST, async (): Promise<DeviceTestResult> => {
    const prn = services.handlers.printerInstance();
    const result = await prn.testConnection();
    services.heartbeat.setPrinterStatus({
      connected: result.ok,
      deviceName: result.deviceName,
      error: result.error,
    });
    void services.heartbeat.tick();
    return result;
  });

  // Optional `mode` arg: probe a fresh printer driver of the requested mode
  // without disturbing the active handler. This lets the renderer populate
  // the dropdown for the mode the user is *about* to switch to, before they
  // hit Save. Falls back to the active printer if mode is omitted.
  ipcMain.handle(
    IpcChannels.PRINTER_LIST,
    async (_e, mode?: PrinterMode): Promise<string[]> => {
      try {
        if (mode) {
          const probe = createPrinter(mode, {});
          const list = await probe.listPrinters();
          logger.debug("printer_list_probe", { mode, count: list.length });
          return list;
        }
        return await services.handlers.printerInstance().listPrinters();
      } catch (err) {
        logger.warn("printer_list_handler_failed", {
          mode,
          err: err instanceof Error ? err.message : String(err),
        });
        return [];
      }
    },
  );

  // Camera devices don't expose a generic "list" the same way printers do
  // (each driver tests by spawning the underlying CLI). For now, return an
  // empty array so the renderer falls back to a free-text input - keeping
  // the IPC channel reserved for later expansion.
  ipcMain.handle(
    IpcChannels.CAMERA_LIST,
    async (_e, _mode?: CameraMode): Promise<string[]> => {
      return [];
    },
  );

  ipcMain.handle(IpcChannels.LOGS_GET, async (): Promise<LogEntry[]> => {
    return getRecentLogs();
  });

  ipcMain.handle(IpcChannels.LOGS_CLEAR, async () => {
    clearRecentLogs();
  });

  ipcMain.handle(IpcChannels.LOGS_OPEN_FOLDER, async () => {
    await shell.openPath(getLogDir());
  });

  ipcMain.handle(IpcChannels.CONNECT_NOW, async () => {
    services.client.connect();
  });

  ipcMain.handle(IpcChannels.DISCONNECT_NOW, async () => {
    services.client.disconnect();
  });

  ipcMain.handle(IpcChannels.OPEN_EXTERNAL, async (_e, url: string) => {
    await shell.openExternal(url);
  });

  // Broadcast status + log changes to renderer.
  services.client.on("status", (status) => {
    const win = getConfigWindow();
    win?.webContents.send(IpcChannels.STATUS_CHANGED, status);
  });

  subscribeLogs((entry) => {
    const win = getConfigWindow();
    win?.webContents.send(IpcChannels.LOG_APPENDED, entry);
  });
}
