// System tray icon + menu. Status colors:
//   green  = connected
//   yellow = busy (in session)
//   red    = offline
import { Tray, Menu, nativeImage, app, shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import { showConfigWindow, setAppQuitting } from "./window";
import { getLogDir } from "./logger";

let tray: Tray | null = null;
let currentState: "online" | "offline" | "busy" = "offline";

function iconPath(state: "online" | "offline" | "busy"): string {
  // Resolve relative to packaged app: assets/ folder ships next to dist.
  const candidates = [
    path.join(__dirname, "..", "..", "assets", `tray-icon-${state}.png`),
    path.join(process.resourcesPath ?? "", "assets", `tray-icon-${state}.png`),
    path.join(app.getAppPath(), "assets", `tray-icon-${state}.png`),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0]!;
}

export function createTray(opts: {
  onShowConfig: () => void;
  onTestCamera: () => Promise<void> | void;
  onTestPrint: () => Promise<void> | void;
  onOpenCloud: () => void;
}): Tray {
  if (tray) return tray;
  const img = nativeImage.createFromPath(iconPath("offline"));
  if (process.platform === "darwin") {
    img.setTemplateImage(false);
  }
  tray = new Tray(img);
  tray.setToolTip("Mote Capture Bridge — Offline");

  const menu = Menu.buildFromTemplate([
    { label: "Mote Capture Bridge", enabled: false },
    { type: "separator" },
    { label: "Show Config Window", click: () => opts.onShowConfig() },
    { type: "separator" },
    { label: "Test Capture", click: () => void opts.onTestCamera() },
    { label: "Test Print", click: () => void opts.onTestPrint() },
    { type: "separator" },
    {
      label: "View Logs Folder",
      click: () => {
        void shell.openPath(getLogDir());
      },
    },
    { label: "Open Cloud Dashboard", click: () => opts.onOpenCloud() },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        setAppQuitting();
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.on("click", () => showConfigWindow());
  return tray;
}

export function setTrayState(state: "online" | "offline" | "busy", tooltip?: string): void {
  if (!tray) return;
  if (state === currentState) {
    if (tooltip) tray.setToolTip(tooltip);
    return;
  }
  currentState = state;
  const img = nativeImage.createFromPath(iconPath(state));
  if (process.platform === "darwin") {
    img.setTemplateImage(false);
  }
  tray.setImage(img);
  tray.setToolTip(tooltip ?? `Mote Capture Bridge — ${state[0]?.toUpperCase()}${state.slice(1)}`);
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
