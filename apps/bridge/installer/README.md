# Mote Capture Bridge — All-in-One Windows Installer

Single `.exe` (Inno Setup) yang menginstall **semua** prerequisite + kode bridge
di Mini PC Windows untuk owner photobooth non-tech. Tidak butuh admin / UAC.

## Apa yang di-install

Saat user double-click `MoteCaptureBridge-Setup-0.1.0.exe`, installer akan:

1. **Smart-detect Node.js**
   - Kalau system sudah punya Node ≥ v18 → pakai itu
   - Kalau tidak → download Node.js v20.18.1 LTS portable (~30 MB) ke `%LOCALAPPDATA%\MoteCapture\node\`
2. **Download MinGit portable** (~50 MB) ke `%LOCALAPPDATA%\MoteCapture\git\`
3. **Install pnpm v9** (via npm) ke `%LOCALAPPDATA%\MoteCapture\npm-global\`
4. **Clone** `github.com/nanansm/mote-capture` ke `%LOCALAPPDATA%\MoteCapture\mote-capture\`
5. **`pnpm install`** semua dependencies (Electron, Sharp, dll) — 5–10 menit
6. **Generate** tray icons (`generate-icons.cjs`)
7. **Pre-build** bridge (vite + esbuild) supaya first launch cepat
8. **Buat shortcut** di Desktop + Start Menu
9. **Register auto-start** di `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`

Total install time: **10–20 menit** tergantung kecepatan internet.

Semua artefak terkurung di `%LOCALAPPDATA%\MoteCapture\` — uninstall lewat
"Apps & Features" akan menghapus semuanya termasuk node, git, pnpm store.

## Build installer

### Di Windows (recommended)

Prerequisite:
- Node.js 18+
- [Inno Setup 6](https://jrsoftware.org/isdl.php)

```cmd
cd apps\bridge\installer
build-installer.bat
```

Atau dari repo root:
```cmd
pnpm build:installer:windows
```

Output: `apps\bridge\installer\output\MoteCaptureBridge-Setup-0.1.0.exe` (~5 MB)

### Di macOS / Linux (via Wine)

Prerequisite:
- `brew install --cask wine-stable` (Mac) / `apt install wine64` (Linux)
- Inno Setup 6 di-install di Wine prefix:
  ```sh
  # Download dari https://jrsoftware.org/isdl.php
  wine ./innosetup-6.x.x.exe
  ```

```sh
cd apps/bridge/installer
./build-installer.sh
```

## Test installer

### 1. Test di Windows fresh (CRITICAL)

Pakai VM Windows 10/11 yang **belum punya Node.js** — atau Mini PC fresh.

1. Copy `MoteCaptureBridge-Setup-0.1.0.exe` ke VM
2. Double-click installer
3. **Verifikasi:** wizard muncul dengan teks Bahasa Indonesia, **tanpa UAC popup**
4. Klik **Lanjut → Install** → progress bar bergerak
5. Tunggu 10–20 menit
6. Verifikasi log: `%LOCALAPPDATA%\MoteCapture\install.log`
7. Wizard "Selesai" muncul → klik Selesai

### 2. Test launch

- Double-click shortcut Desktop "Mote Capture Bridge"
- **Verifikasi:** tidak ada terminal/PowerShell window muncul (hanya tray icon + bridge config window)
- Bridge config window muncul → input bridge token + cloud URL → save
- Tray icon harus turn green (online)

### 3. Test auto-start

- Restart Windows
- **Verifikasi:** bridge auto-start, tray icon muncul tanpa intervensi user
- Cek log: `%LOCALAPPDATA%\MoteCapture\runtime.log`

### 4. Test di Windows yang sudah punya Node v20

Install Node v20+ dulu lewat installer resmi nodejs.org, lalu jalankan installer.
Cek di `install.log` — harus muncul `"System Node.js terdeteksi"` dan **skip** download node.

### 5. Test uninstall

- Settings → Apps → "Mote Capture Bridge" → Uninstall
- **Verifikasi:**
  - Folder `%LOCALAPPDATA%\MoteCapture\` hilang
  - Registry `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\MoteCaptureBridge` hilang
  - Shortcut Desktop + Start Menu hilang
  - Restart Windows → bridge **tidak** muncul lagi

## File structure

```
apps/bridge/installer/
├── MoteCaptureBridge.iss          # Inno Setup compile config
├── README.md                       # This file
├── build-installer.bat             # Windows build wrapper
├── build-installer.sh              # macOS/Linux build wrapper (via Wine)
├── assets/
│   ├── generate-installer-assets.cjs  # ICO + BMP generator (run via build script)
│   ├── installer-icon.ico          # (generated, gitignored)
│   ├── installer-banner.bmp        # (generated, gitignored)
│   └── installer-small.bmp         # (generated, gitignored)
├── output/
│   └── MoteCaptureBridge-Setup-0.1.0.exe   # (generated, gitignored)
└── scripts/                        # PowerShell scripts shipped inside installer
    ├── bootstrap.ps1               # Orchestrator (called by Inno Setup [Run])
    ├── install-nodejs.ps1
    ├── install-git.ps1
    ├── install-pnpm.ps1
    ├── clone-repo.ps1
    ├── setup-project.ps1           # pnpm install + generate-icons + pre-build
    ├── create-shortcuts.ps1
    ├── register-autostart.ps1
    ├── launch-bridge.ps1           # Launcher used by shortcuts + auto-start (with git pull)
    └── uninstall-cleanup.ps1
```

## Auto-update behavior

`launch-bridge.ps1` runs `git fetch origin main` setiap kali bridge start. Kalau
ada commit baru, otomatis `reset --hard origin/main` + re-`pnpm install` +
re-build. **Jadi push ke `main` di GitHub = deploy ke semua mini PC** pada launch
berikutnya.

(Silent fail kalau tidak ada internet — bridge tetap launch dengan kode lokal
yang ada.)

## Known issues / catatan

- **Windows Defender SmartScreen warning**: installer tidak di-code-sign,
  pertama kali run akan muncul "Windows protected your PC" → klik
  "More info" → "Run anyway". Polish nanti pakai EV cert.
- **Internet wajib aktif** saat install pertama kali. Document ini di
  download page.
- **Repo private?** Kalau `nanansm/mote-capture` private, `git clone` akan
  prompt credentials → installer akan stuck. Pastikan repo public, atau
  inject PAT via env var di `clone-repo.ps1`.
- **Bridge runs in dev mode** (`pnpm dev:bridge`). Dev mode = vite serve +
  esbuild watch + electron — heavyweight tapi sesuai spec Sprint 5. Untuk
  production-grade gunakan `pnpm --filter bridge start` setelah build (Sprint
  selanjutnya).
- **Lokasi install fixed** di `%LOCALAPPDATA%\MoteCapture\` (DisableDirPage=yes).
  Kalau perlu ubah lokasi, edit `DefaultDirName` di `.iss`.
- **Disk space**: minimum ~2 GB free di drive `%LOCALAPPDATA%`. Installer cek
  ini di `InitializeSetup`.

## Distribusi ke owner

Karena installer ~5 MB, bisa via:

1. **GitHub Release** (private link) — gratis, paling simple
2. **Cloudflare R2 / S3** — kalau mau custom domain (`https://download.motekreatif.com/bridge/MoteCaptureBridge-Setup.exe`)
3. **Easypanel static** — host bareng `capture.motekreatif.com`

Sprint 5 **tidak** push installer .exe ke repo — file binary jangan masuk git.
Setelah test berhasil, upload ke salah satu di atas.
