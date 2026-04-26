# Mote Capture Bridge

Cross-platform Electron desktop app that connects a photobooth's local hardware
(camera + printer) to the Mote Capture cloud. Runs in the system tray, connects
to the cloud via Socket.io, and handles `BRIDGE_CAPTURE / BRIDGE_COMPOSITE /
BRIDGE_PRINT` events end-to-end.

## Camera modes

- `webcam-mac` — macOS built-in camera via `imagesnap` CLI (dev mode).
  Install: `brew install imagesnap`
- `digicamcontrol` — Canon DSLR via [digiCamControl](https://digicamcontrol.com)
  on Windows (production)
- `gphoto2` — Canon DSLR via gphoto2 (Mac/Linux)
- `mock` — generates SVG → JPG placeholder (offline tests, no hardware)

## Printer modes

- `win32` — Windows silent print via `mspaint /pt`
- `cups` — macOS / Linux via `lp` command
- `mock` — saves PNG to `~/Downloads/mote-capture-print-*.png`, auto-opens

## Dev quickstart (macOS)

```sh
brew install imagesnap   # for webcam-mac mode
pnpm install
node apps/bridge/assets/generate-icons.cjs   # one-time, creates tray icons
pnpm dev:cloud           # in one terminal — Next.js cloud on :5000
pnpm dev:bridge          # in another — Vite + Electron
```

The bridge config window opens on first launch. Paste the `bridge_token` from
`/admin/booths/[id]` in the cloud admin and click **Save & Connect**.

## Build installers

```sh
pnpm package:bridge:mac    # → apps/bridge/dist-installer/*.dmg
pnpm package:bridge:win    # → apps/bridge/dist-installer/*.exe (cross-build)
```

## Files

- `src/main/index.ts` — Electron lifecycle entry
- `src/main/socket-client.ts` — Socket.io connect + handlers wiring
- `src/main/handlers/index.ts` — capture/composite/print drivers
- `src/main/camera/` — webcam-mac, digicamcontrol-win, gphoto2-unix, mock
- `src/main/printer/` — win32-print, cups-print, mock
- `src/main/image/composer.ts` — Sharp 4R 1800×1200 layout B
- `src/renderer/config/` — React config UI (Setup/Camera/Printer/Logs tabs)

## Storage paths

- Config: `~/Library/Application Support/mote-capture-bridge/config.json` (mac),
  `%APPDATA%\mote-capture-bridge\config.json` (win)
- Logs: `~/Library/Logs/Mote Capture Bridge/` (mac),
  `%APPDATA%\Mote Capture Bridge\logs\` (win) — rotated daily, 7 day retention
- Captures (temp): `~/.mote-capture/temp/`
- Frame cache: `~/.mote-capture/frames/`
- Composites: `~/.mote-capture/composites/`
