# installer-deps

Binaries bundled **into** the Windows `.exe` at build time. Not committed to git
(too large) — drop them here manually before running `pnpm package:win`.

## digiCamControl-setup.exe (required for Windows build)

The Mote installer bundles digiCamControl and silently installs it on the booth
PC if it isn't already present (see `assets/installer.nsh`).

1. Download the installer from <https://digicamcontrol.com/download> (the stable
   `digiCamControlSetup_x_x_x.exe`).
2. Rename it to exactly **`digiCamControl-setup.exe`** and place it in this
   folder:

   ```
   apps/bridge/installer-deps/digiCamControl-setup.exe
   ```

3. Build the installer (on Windows):

   ```
   pnpm --filter bridge package:win
   ```

If this file is missing, `electron-builder` will fail the Windows build because
`electron-builder.yml` references it under `win.extraResources`. The mac/linux
builds do not need it (the resource is win-scoped).

> Note: digiCamControl's own installer raises a UAC prompt during the silent
> install because it writes to `Program Files`. That is expected and is the only
> elevation the booth setup needs.

## One-time per-booth manual step (after install)

The installer auto-launches the digiCamControl GUI at login, but two settings
cannot be safely pre-seeded (they live in digiCamControl's own version-specific
config). Do this once on each new booth PC:

1. Open digiCamControl, connect the Canon, then **Settings → Webserver → Enable**
   (default port 5513).
2. Open/confirm a capture session named **Session1** (the bridge default).

After that, every subsequent login is hands-off: kiosk + bridge + digiCamControl
all start automatically.
