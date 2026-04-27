// Types shared between Electron main + renderer (config UI).

export type CameraMode = "webcam-mac" | "digicamcontrol" | "gphoto2" | "mock";
export type PrinterMode = "win32" | "cups" | "mock";

export type BridgeConfig = {
  cloudUrl: string;
  bridgeToken: string;
  boothId: string;
  cameraMode: CameraMode;
  cameraDeviceName?: string;
  printerMode: PrinterMode;
  printerName?: string;
  digiCamControlPath?: string;
  autoStart: boolean;
};

export type BridgeStatus = {
  connected: boolean;
  connecting: boolean;
  socketId: string | null;
  lastError?: string;
  lastHeartbeatAt?: string;
  bridgeVersion: string;
  platform: NodeJS.Platform;
  bootedAt: string;
};

export type DeviceTestResult = {
  ok: boolean;
  deviceName?: string;
  error?: string;
  previewDataUrl?: string;
};

export type LogEntry = {
  ts: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  meta?: Record<string, unknown>;
};

// IPC channel names - keep in sync with renderer + main
export const IpcChannels = {
  CONFIG_GET: "config:get",
  CONFIG_SAVE: "config:save",
  STATUS_GET: "status:get",
  STATUS_CHANGED: "status:changed", // main -> renderer (broadcast)
  CAMERA_TEST: "camera:test",
  CAMERA_LIST: "camera:list",
  PRINTER_TEST: "printer:test",
  PRINTER_LIST: "printer:list",
  LOGS_GET: "logs:get",
  LOGS_CLEAR: "logs:clear",
  LOGS_OPEN_FOLDER: "logs:openFolder",
  LOG_APPENDED: "logs:appended", // main -> renderer (broadcast)
  CONNECT_NOW: "bridge:connectNow",
  DISCONNECT_NOW: "bridge:disconnectNow",
  OPEN_EXTERNAL: "shell:openExternal",
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];
