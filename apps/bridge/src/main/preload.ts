// Preload script — exposes a typed `bridgeAPI` on window for the renderer.
import { contextBridge, ipcRenderer } from "electron";
import { IpcChannels } from "../shared/types";
import type {
  BridgeConfig,
  BridgeStatus,
  DeviceTestResult,
  LogEntry,
} from "../shared/types";

const api = {
  getConfig: (): Promise<BridgeConfig> => ipcRenderer.invoke(IpcChannels.CONFIG_GET),
  saveConfig: (patch: Partial<BridgeConfig>): Promise<BridgeConfig> =>
    ipcRenderer.invoke(IpcChannels.CONFIG_SAVE, patch),
  getStatus: (): Promise<BridgeStatus> => ipcRenderer.invoke(IpcChannels.STATUS_GET),
  onStatusChanged: (cb: (status: BridgeStatus) => void): (() => void) => {
    const handler = (_e: unknown, s: BridgeStatus) => cb(s);
    ipcRenderer.on(IpcChannels.STATUS_CHANGED, handler);
    return () => {
      ipcRenderer.removeListener(IpcChannels.STATUS_CHANGED, handler);
    };
  },
  testCamera: (): Promise<DeviceTestResult> => ipcRenderer.invoke(IpcChannels.CAMERA_TEST),
  testPrinter: (): Promise<DeviceTestResult> => ipcRenderer.invoke(IpcChannels.PRINTER_TEST),
  listPrinters: (): Promise<string[]> => ipcRenderer.invoke(IpcChannels.PRINTER_LIST),
  getLogs: (): Promise<LogEntry[]> => ipcRenderer.invoke(IpcChannels.LOGS_GET),
  clearLogs: (): Promise<void> => ipcRenderer.invoke(IpcChannels.LOGS_CLEAR),
  openLogFolder: (): Promise<void> => ipcRenderer.invoke(IpcChannels.LOGS_OPEN_FOLDER),
  onLogAppended: (cb: (entry: LogEntry) => void): (() => void) => {
    const handler = (_e: unknown, entry: LogEntry) => cb(entry);
    ipcRenderer.on(IpcChannels.LOG_APPENDED, handler);
    return () => {
      ipcRenderer.removeListener(IpcChannels.LOG_APPENDED, handler);
    };
  },
  connectNow: (): Promise<void> => ipcRenderer.invoke(IpcChannels.CONNECT_NOW),
  disconnectNow: (): Promise<void> => ipcRenderer.invoke(IpcChannels.DISCONNECT_NOW),
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.OPEN_EXTERNAL, url),
};

contextBridge.exposeInMainWorld("bridgeAPI", api);

export type BridgeAPI = typeof api;
