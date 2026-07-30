# Mote Capture Bridge — Installer (electron-builder NSIS)

Single self-contained `.exe` for a new booth PC. **No Node, git, clone, or
internet required at install time** (digiCamControl is bundled). The booth UI
stays in the cloud (`mote-capture.smnanan.workers.dev`) and is opened via Edge kiosk.

> This is the active installer path. The older `installer/` folder (Inno Setup,
> git-clone-at-install approach) is **deprecated** — ignore it.

## What the installer does on the booth PC

1. Installs the bridge (Electron tray app) to `%LOCALAPPDATA%\Programs\...` (per-user, no admin for the bridge itself).
2. Silently installs **digiCamControl** if not already present (bundled; raises one UAC prompt).
3. Adds **digiCamControl GUI** to Startup (camera webserver must be running).
4. Creates **kiosk Edge** shortcuts (Desktop + Startup) →
   `msedge --kiosk https://mote-capture.smnanan.workers.dev --edge-kiosk-type=fullscreen`.
5. Bridge auto-starts at login (login item, set from the config toggle) and
   auto-restarts itself on crash (throttled watchdog).

Result at every login: digiCamControl + bridge (tray) + Edge kiosk all start
hands-off.

## Shortcut kiosk otomatis diperbaiki setelah konfigurasi

Saat instalasi, booth ID belum diketahui — jadi shortcut kiosk (Desktop +
Startup) yang dibuat installer sementara mengarah ke akar domain
(`mote-capture.smnanan.workers.dev`), yang cuma redirect ke `/admin`, bukan
layar kiosk. Begitu operator mengisi **Cloud URL** + **Bridge Token** di
config window dan token itu berhasil diresolve jadi **Booth ID**, bridge
langsung menulis ulang kedua shortcut tersebut supaya menunjuk
`<cloudUrl>/kiosk/<boothId>`. Operator **tidak perlu** mengedit properti
shortcut secara manual per booth — cukup Save sekali, lalu buka ulang
shortcut (atau reboot) untuk melihat layar kiosk yang benar.

## Build (must run on Windows x64)

Prerequisites: Node 18+, pnpm, repo cloned.

1. Drop the digiCamControl installer at
   `apps/bridge/installer-deps/digiCamControl-setup.exe`
   (see `installer-deps/README.md`). **Build fails without it.**
2. From repo root:
   ```cmd
   pnpm install
   pnpm --filter bridge package:win
   ```
3. Output: `apps/bridge/dist-installer/Mote Capture Bridge Setup 0.2.0.exe`

Version comes from `apps/bridge/package.json` (`0.2.0`). Bump there to rev the
installer.

> Cross-building from macOS/Linux is possible with Wine but unreliable for the
> bundled-exe sub-install + NSIS custom script — build on Windows.

## First run on a new booth

1. Run the `.exe` → Next/Next/Install (one UAC for digiCamControl).
2. Bridge tray app opens its config window automatically (no token yet):
   paste the **bridge token**, set Cloud URL, tick **Launch on system startup**,
   Save. Booth ID auto-fills from the token.
3. **One-time digiCamControl config** (cannot be pre-seeded safely):
   - Settings → Webserver → Enable (port 5513)
   - Open/confirm a capture session named **Session1**
4. Reboot to verify: kiosk + bridge + digiCamControl all auto-start.

## Code-signing note

Unsigned → Windows SmartScreen shows "Windows protected your PC" on first run.
Click "More info" → "Run anyway". Add an EV/OV cert later to remove the warning.
