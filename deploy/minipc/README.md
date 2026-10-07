# Paket mini PC booth (Debian 13)

Satu distro: **Debian 13 (trixie)**, amd64 (Beelink) atau arm64. Distro lain ditolak di awal.
Strategi: pasang sekali → uji lapangan → clone SSD jadi golden image. Rusak = flash ulang, bukan debug.

## Isi folder
- `setup.sh`: provisioning (idempotent). Paket, Gutenprint 5.3.6, Node 22, user `booth`, systemd, kiosk.
- `build-gutenprint.sh`: backport Gutenprint 5.3.6 (sid) → .deb untuk trixie. Debian 13 bawaan = 5.3.4, **tanpa** driver CP1500.
- `build-release.sh`: paket `booth-agent-<arch>.tar.gz` (dist + node_modules native untuk Debian 13 + web kiosk). Versi dependency dikunci persis.
- `test-setup.sh`: 22 cek di Debian 13 + systemd asli (container).
- `files/`: unit systemd, udev, journald, logind, unattended-upgrades.

## Build (di server dev)
```
ARCH=amd64 ./build-gutenprint.sh     # -> out/amd64/*.deb
ARCH=amd64 ./build-release.sh        # -> out/booth-agent-amd64.tar.gz
ARCH=amd64 ./test-setup.sh           # wajib 22/22 sebelum dibawa ke mini PC
```

## Pasang di mini PC
1. Install Debian 13 netinst. Pilih **tanpa desktop**, centang hanya "SSH server" + "standard system utilities".
2. Salin folder ini + `out/amd64/` (sebagai `debs/amd64/`) + `out/booth-agent-amd64.tar.gz` ke mini PC.
3. Ambil `BRIDGE_TOKEN` dari admin (pairing booth). Jangan kirim lewat chat.
4. `sudo BOOTH_ID=BOOTH-XXXX BRIDGE_TOKEN=... ./setup.sh booth-agent-amd64.tar.gz`
5. `sudo booth-agent-set-pin` (PIN staf 4 digit), lalu reboot. Layar langsung masuk kiosk.

Update agent: `sudo ./setup.sh booth-agent-amd64.tar.gz` (env lama dipakai, 3 release disimpan).
Rollback: `ln -sfn /opt/booth-agent/releases/<lama> /opt/booth-agent/current && systemctl restart booth-agent`.

## Hardware wajib (hasil devil's advocate)
- Dummy battery Canon **ACK-E10** (2000D tidak mati karena baterai). Auto power-off kamera: OFF.
- **UPS** kecil untuk mini PC + printer.
- Tailscale untuk remote (belum di skrip: butuh akun/keputusan Nanan).

## Belum terbukti (butuh hardware)
- Kamera USB nyata (gphoto2), cetak nyata CP1500, layar sentuh PM161QT di cage/Wayland.
- Uji lapangan 1 minggu sebelum buka untuk umum.
