// Manages the singleton config BrowserWindow.
import { app, BrowserWindow } from "electron";
import path from "node:path";

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL ?? "http://localhost:5174";

let win: BrowserWindow | null = null;

export function getOrCreateConfigWindow(): BrowserWindow {
  if (win && !win.isDestroyed()) return win;
  win = new BrowserWindow({
    width: 700,
    height: 600,
    resizable: false,
    maximizable: false,
    minimizable: true,
    fullscreenable: false,
    title: "Mote Capture Bridge",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // A packaged build must always load the built renderer from disk. NODE_ENV is
  // not set to "production" in a packaged Electron app, so keying off it sent the
  // packaged app to the (dead) Vite dev server and left the window blank. Use
  // app.isPackaged, and only hit the dev server when one is actually configured.
  if (!app.isPackaged && process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    // Renderer is built to dist/renderer/index.html (Vite output).
    win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  }

  win.on("close", (event) => {
    // Hide instead of quit — quit only via tray menu.
    if (!appQuitting) {
      event.preventDefault();
      win?.hide();
    }
  });

  win.on("ready-to-show", () => {
    win?.show();
  });

  return win;
}

export function showConfigWindow(): void {
  const w = getOrCreateConfigWindow();
  if (!w.isVisible()) w.show();
  w.focus();
}

export function toggleConfigWindow(): void {
  const w = getOrCreateConfigWindow();
  if (w.isVisible() && w.isFocused()) {
    w.hide();
  } else {
    w.show();
    w.focus();
  }
}

let appQuitting = false;
export function setAppQuitting(): void {
  appQuitting = true;
}

export function isAppQuitting(): boolean {
  return appQuitting;
}

export function getConfigWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null;
}
