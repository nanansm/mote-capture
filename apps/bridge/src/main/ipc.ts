// IPC handlers — bridge between renderer config UI and main-process services.
import { ipcMain, shell } from "electron";
import { IpcChannels } from "../shared/types";
import type { BridgeConfig, BridgeStatus, DeviceTestResult, LogEntry } from "../shared/types";
import { getStore } from "./config/store";
import { logger, getLogDir, getRecentLogs, clearRecentLogs, subscribeLogs } from "./logger";
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

export function registerIpc(services: IpcServices): void {
  ipcMain.handle(IpcChannels.CONFIG_GET, async () => {
    const store = await getStore();
    return store.store;
  });

  ipcMain.handle(IpcChannels.CONFIG_SAVE, async (_e, patch: Partial<BridgeConfig>) => {
    const store = await getStore();
    store.set(patch);
    const newConfig = store.store;
    logger.info("config_saved", { changedKeys: Object.keys(patch) });
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

  ipcMain.handle(IpcChannels.PRINTER_LIST, async (): Promise<string[]> => {
    return services.handlers.printerInstance().listPrinters();
  });

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
