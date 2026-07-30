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

## ffmpeg.exe (required for Windows build)

Backs `cameraMode: "webcam-win"`, which is what the Sony ZV-E10 booth uses. The
ZV-E10 gen-1 cannot be tethered: Sony's Camera Remote SDK covers the ZV-E1 and
ZV-E10 II but not this body, digiCamControl only reaches Sony over WiFi, and the
camera's `USB Connection` menu offers just Auto / Mass Storage / MTP — there is
no PC Remote entry to enable (verified on the booth PC, 30 Jul 2026). What does
work is the camera's USB Streaming mode, which enumerates as a normal dshow UVC
device, so the bridge drives it through ffmpeg.

1. Download a Windows build from <https://www.gyan.dev/ffmpeg/builds/> — the
   `ffmpeg-release-essentials.zip` is enough (dshow is compiled in).
2. Extract and take **only** `bin\ffmpeg.exe`.
3. Place it here:

   ```
   apps/bridge/installer-deps/ffmpeg.exe
   ```

`preflight-win.cjs` rejects the build if the file is missing, and also if it is
suspiciously small (< 20 MB) — that catches the case where a CDN interstitial
page got saved under the binary's name.

## One-time per-booth manual step (after install)

**If the booth camera is a Canon (digiCamControl path):** the installer
auto-launches the digiCamControl GUI at login, but two settings cannot be safely
pre-seeded (they live in digiCamControl's own version-specific config). Do this
once on each new booth PC:

1. Open digiCamControl, connect the Canon, then **Settings → Webserver → Enable**
   (default port 5513).
2. Open/confirm a capture session named **Session1** (the bridge default).

**If the booth camera is a Sony ZV-E10 (webcam-win path):** no digiCamControl
setup at all. Instead, on the camera:

1. **MENU → Setup → USB Streaming = On.**
2. Leave `USB Connection` alone — but do **not** put it in MTP or Mass Storage
   while streaming, since those modes take the camera off the dshow device list
   (in MTP it enumerates as `VID_054C&PID_0D96`, class WPD; in streaming mode it
   shows up as `PID_0DE3`, class Camera).
3. Replug the USB cable after changing the mode and wait ~10 s.
4. In the bridge config UI, Camera tab → mode **Webcam / Sony UVC (Windows —
   ffmpeg)**, leave Device name empty to auto-pick, then **Test Capture**.

The stream is 720p, which is deliberately fine: each photo slot on the 4R print
is 790×320 px (`src/main/image/composer.ts`, `DEFAULT_LAYOUT_B`), so a 1280×720
source is already oversampled. No HDMI capture card is needed.

After that, every subsequent login is hands-off: kiosk + bridge (+ digiCamControl
on Canon booths) all start automatically.
