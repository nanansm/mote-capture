# Mini PC booth: golden image Debian 13 (rencana konkret)

Dasar: devil's advocate Fable 5.1 (7 Okt 2026). Satu distro, satu image, rusak = flash ulang.

## Fakta yang sudah dicek
- Debian 13 bawa Gutenprint 5.3.4: driver CP1500 TIDAK ada (dicek di container trixie).
- Debian sid punya 5.3.6. Pasang langsung dari sid menyeret 130 paket + upgrade libc6 (berbahaya).
  Solusi: backport (build ulang source sid di trixie) jadi .deb sendiri, ikut di image.

## Isi image
1. Debian 13 minimal (tanpa desktop), user `booth` autologin.
2. Kiosk: compositor `cage` (Wayland, 1 aplikasi) + Chromium `--kiosk` ke http://127.0.0.1:7777/kiosk/<BOOTH_ID>.
   NAutoVTs=0, tanpa getty: Ctrl+Alt+F2 tidak membuka apa-apa. Keyboard USB tidak memberi jalan keluar.
3. booth-agent: Node 22, systemd `Restart=always` + `WatchdogSec`, `EnvironmentFile=/etc/booth-agent/env` (0600 root).
4. Kamera: gphoto2, gvfs-gphoto2 tidak dipasang + dimask, udev rule izin USB untuk `booth`.
5. Printer: CUPS + Gutenprint 5.3.6 backport, printer `selphy` dibuat otomatis saat colok.
6. Remote: Tailscale (SSH hanya lewat tailnet).
7. Update: unattended-upgrades security only; Chromium + kernel di-hold (diupdate manual setelah dites).
8. Disk/log: journald max 200 MB; agent hapus foto >14 hari; alarm disk <10%.
9. Token: per booth, bisa dicabut dari admin. Enkripsi disk TPM opsional (fase 2).

## Hardware tambahan (wajib)
- Dummy battery Canon ACK-E10 (kamera tidak mati karena baterai).
- UPS kecil (listrik padam tidak memutus sesi berbayar).
- Matikan auto power-off di menu kamera.

## Tes
- Sekarang (tanpa hardware): build backport Gutenprint (cek `lpinfo -m | grep -i cp1500`),
  install di VM QEMU x86_64 (lambat tapi boot nyata: systemd, autologin, cage), cek /health + e2e kiosk ke VM.
- Hardware datang: uji lapangan 1 minggu (bukan 15 menit) sebelum booth dibuka untuk umum.
- Setelah lulus: clone SSD jadi golden image (Clonezilla), simpan + 1 SSD cadangan.
