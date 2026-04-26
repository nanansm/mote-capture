# Bridge Assets

- `icon.png` — 512×512 app icon (used by electron-builder for Mac dmg + Windows nsis)
- `tray-icon-online.png` — 16×16 (32×32 @2x) green dot, status bar
- `tray-icon-offline.png` — 16×16 red dot, status bar
- `tray-icon-busy.png` — 16×16 yellow dot, status bar

PNGs are generated from SVG sources (also in this folder). To regenerate, run any SVG → PNG converter (the bridge bootstrap script also auto-generates them on first run if missing).
