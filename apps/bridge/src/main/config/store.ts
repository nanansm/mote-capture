// Persistent config wrapper. Uses electron-store when running inside Electron;
// falls back to a plain JSON file when invoked via tsx (e.g. unit tests).
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import type { BridgeConfig } from "../../shared/types";

const DEFAULTS: BridgeConfig = {
  cloudUrl: "http://localhost:5000",
  bridgeToken: "",
  boothId: "",
  cameraMode: process.platform === "darwin" ? "webcam-mac" : "mock",
  cameraDeviceName: "",
  printerMode: "mock",
  printerName: "",
  digiCamControlPath:
    process.platform === "win32"
      ? "C:\\Program Files (x86)\\digiCamControl\\CameraControlRemoteCmd.exe"
      : "",
  digiCamSessionFolder:
    process.platform === "win32"
      ? path.join(os.homedir(), "Pictures", "digiCamControl", "Session1")
      : "",
  autoStart: false,
};

type StoreLike = {
  get<K extends keyof BridgeConfig>(key: K): BridgeConfig[K] | undefined;
  set(values: Partial<BridgeConfig>): void;
  store: BridgeConfig;
  path: string;
};

let storeInstance: StoreLike | null = null;

function userDataPath(): string {
  // electron app.getPath('userData') equivalent for non-Electron contexts.
  switch (process.platform) {
    case "darwin":
      return path.join(os.homedir(), "Library", "Application Support", "mote-capture-bridge");
    case "win32":
      return path.join(process.env.APPDATA ?? os.homedir(), "mote-capture-bridge");
    default:
      return path.join(
        process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"),
        "mote-capture-bridge",
      );
  }
}

function jsonFallback(filePath: string): StoreLike {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let cache: BridgeConfig = { ...DEFAULTS };
  if (fs.existsSync(filePath)) {
    try {
      cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(filePath, "utf8")) };
    } catch {
      cache = { ...DEFAULTS };
    }
  } else {
    fs.writeFileSync(filePath, JSON.stringify(cache, null, 2), "utf8");
  }
  return {
    get: (key) => cache[key],
    set: (values) => {
      cache = { ...cache, ...values };
      fs.writeFileSync(filePath, JSON.stringify(cache, null, 2), "utf8");
    },
    get store() {
      return cache;
    },
    path: filePath,
  };
}

export async function getStore(): Promise<StoreLike> {
  if (storeInstance) return storeInstance;
  // Try electron-store first (only works inside Electron because it requires app.getPath)
  let inElectron = false;
  try {
    const electron = require("electron");
    if (electron && electron.app && typeof electron.app.getPath === "function") {
      inElectron = true;
    }
  } catch {
    inElectron = false;
  }

  if (inElectron) {
    // Always pin cwd to our user-data path so the file location is stable
    // regardless of how Electron was launched (npx, dmg, dev, etc).
    const electron = require("electron");
    const cwd: string = electron.app.getPath("userData");
    const ElectronStore = require("electron-store");
    const Store = ElectronStore.default ?? ElectronStore;
    const s = new Store({ name: "config", defaults: DEFAULTS, cwd });
    storeInstance = s as StoreLike;
    return storeInstance;
  }

  const fallbackPath = path.join(userDataPath(), "config.json");
  storeInstance = jsonFallback(fallbackPath);
  return storeInstance;
}

export function defaultConfig(): BridgeConfig {
  return { ...DEFAULTS };
}
