#!/usr/bin/env bash
# Provisioning mini PC booth Mote Capture — Debian 13 (trixie) SAJA.
# Idempotent: aman dijalankan ulang. Jalankan sebagai root di Debian 13 minimal.
#
# Pakai:
#   sudo BOOTH_ID=BOOTH-XXXX BRIDGE_TOKEN=... ./setup.sh <release.tar.gz>
#   (BRIDGE_TOKEN boleh dikosongkan bila /etc/booth-agent/env sudah ada)
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
RELEASE=${1:-}
DEBS=${DEBS:-}
NODE_VERSION=${NODE_VERSION:-22.22.1}
API_ORIGIN=${API_ORIGIN:-https://capture.motekreatif.com}
BOOTH_USER=booth
PREFIX=/opt/booth-agent
ENV_FILE=/etc/booth-agent/env

die() { echo "GAGAL: $*" >&2; exit 1; }
step() { echo "==> $*"; }

# ── preflight: berhenti di awal, bukan gagal di tengah ──
[ "$(id -u)" = 0 ] || die "jalankan sebagai root (sudo)"
. /etc/os-release
[ "${ID:-}" = debian ] && [ "${VERSION_ID:-}" = 13 ] || die "hanya Debian 13 (terdeteksi: ${PRETTY_NAME:-?})"
[ -d /run/systemd/system ] || die "systemd tidak aktif"
case "$(dpkg --print-architecture)" in amd64|arm64) ;; *) die "arsitektur tidak didukung";; esac
ARCH=$(dpkg --print-architecture)
DEBS=${DEBS:-$HERE/debs/$ARCH}
[ -n "$RELEASE" ] && [ -f "$RELEASE" ] || die "berkas release booth-agent tidak ada: ${RELEASE:-<kosong>}"
ls "$DEBS"/printer-driver-gutenprint_5.3.6*.deb >/dev/null 2>&1 || die "deb Gutenprint 5.3.6 untuk $ARCH tidak ada di $DEBS"
if [ ! -f "$ENV_FILE" ]; then
  [ -n "${BOOTH_ID:-}" ] || die "BOOTH_ID wajib (instal pertama)"
  [ -n "${BRIDGE_TOKEN:-}" ] || die "BRIDGE_TOKEN wajib (instal pertama)"
fi
avail_kb=$(df --output=avail / | tail -1)
[ "$avail_kb" -gt $((8 * 1024 * 1024)) ] || die "disk kosong < 8 GB"

export DEBIAN_FRONTEND=noninteractive

step "paket dasar"
apt-get update -qq
apt-get install -y -qq --no-install-recommends \
  ca-certificates curl xz-utils jq \
  cups cups-client cups-filters gphoto2 libgphoto2-6t64 \
  cage chromium fonts-noto-color-emoji \
  unattended-upgrades systemd-timesyncd >/dev/null

step "Gutenprint 5.3.6 (backport, driver Canon SELPHY CP1500)"
apt-get install -y -qq "$DEBS"/libgutenprint-common_*.deb \
  "$DEBS"/libgutenprint9_[0-9]*.deb "$DEBS"/printer-driver-gutenprint_[0-9]*.deb >/dev/null
apt-mark hold printer-driver-gutenprint libgutenprint9 libgutenprint-common >/dev/null

step "cegah layanan yang merebut kamera/printer USB"
# gvfs-gphoto2 mengklaim kamera duluan -> gphoto2 "Could not claim the USB device".
apt-get purge -y -qq gvfs-backends gvfs-gphoto2-volume-monitor ipp-usb >/dev/null 2>&1 || true
systemctl mask --now ipp-usb.service >/dev/null 2>&1 || true

step "jaringan: tunggu online sebelum agent/kiosk start"
# Installer Debian memasang LAN sebagai allow-hotplug: network-online.target
# lolos sebelum DHCP/DNS siap -> agent EAI_AGAIN + kiosk "Booth tidak bisa
# dibuka (INTERNAL)" saat boot. auto + ifupdown-wait-online menahan sampai siap.
if [ -f /etc/network/interfaces ]; then
  sed -i -E 's/^allow-hotplug (en[a-z0-9]+|eth[0-9]+)$/auto \1/' /etc/network/interfaces
  systemctl enable ifupdown-wait-online.service >/dev/null 2>&1 || true
fi

step "Node.js $NODE_VERSION"
NODE_ARCH=$([ "$ARCH" = amd64 ] && echo x64 || echo arm64)
if [ "$(/opt/node/bin/node -v 2>/dev/null)" != "v$NODE_VERSION" ]; then
  tmp=$(mktemp -d)
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-$NODE_ARCH.tar.xz" -o "$tmp/node.tar.xz"
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
  (cd "$tmp" && grep " node-v$NODE_VERSION-linux-$NODE_ARCH.tar.xz\$" SHASUMS256.txt | sed "s#node-v.*#node.tar.xz#" | sha256sum -c --quiet) \
    || die "checksum Node tidak cocok"
  rm -rf /opt/node.new && mkdir -p /opt/node.new
  tar -xJf "$tmp/node.tar.xz" -C /opt/node.new --strip-components=1
  rm -rf /opt/node && mv /opt/node.new /opt/node && rm -rf "$tmp"
fi

step "user $BOOTH_USER"
id "$BOOTH_USER" >/dev/null 2>&1 || useradd -m -s /bin/bash "$BOOTH_USER"
# Grup bisa belum ada di image minimal (input/render dibuat udev saat ada perangkat): buat dulu.
for g in lpadmin plugdev video input render; do getent group "$g" >/dev/null || groupadd -r "$g"; done
usermod -aG lpadmin,plugdev,video,input,render "$BOOTH_USER"
passwd -l "$BOOTH_USER" >/dev/null   # tidak bisa login pakai sandi; hanya autologin kiosk

step "booth-agent (release)"
mkdir -p "$PREFIX/releases" /var/lib/booth-agent
rel_dir="$PREFIX/releases/$(date +%Y%m%d%H%M%S)"
mkdir -p "$rel_dir" && tar -xzf "$RELEASE" -C "$rel_dir"
[ -f "$rel_dir/dist/main.js" ] && [ -d "$rel_dir/web" ] || die "isi release tidak lengkap (dist/main.js, web/)"
/opt/node/bin/node -e "require('$rel_dir/node_modules/better-sqlite3');require('$rel_dir/node_modules/sharp')" \
  || die "native module release tidak cocok dengan mesin ini (arsitektur/glibc)"
ln -sfn "$rel_dir" "$PREFIX/current"
# simpan 3 release terakhir untuk rollback
ls -1dt "$PREFIX"/releases/* | tail -n +4 | xargs -r rm -rf
chown -R "$BOOTH_USER:$BOOTH_USER" /var/lib/booth-agent

step "env + secret"
install -d -m 0750 -o root -g "$BOOTH_USER" /etc/booth-agent
if [ ! -f "$ENV_FILE" ]; then
  umask 077
  cat > "$ENV_FILE" <<EOF
API_ORIGIN=$API_ORIGIN
BOOTH_ID=$BOOTH_ID
BRIDGE_TOKEN=$BRIDGE_TOKEN
DATA_DIR=/var/lib/booth-agent
WEB_DIST=$PREFIX/current/web
CAMERA_DRIVER=gphoto2
PRINTER_DRIVER=cups
LP_PRINTER=selphy
EOF
  chown root:"$BOOTH_USER" "$ENV_FILE" && chmod 0640 "$ENV_FILE"
fi
unset BRIDGE_TOKEN

step "perintah staf"
cat > /usr/local/sbin/booth-agent-set-pin <<'EOF'
#!/bin/sh
# Set PIN staf 4 digit (ditanya, tidak muncul di layar/riwayat shell).
set -e
if [ -t 0 ]; then printf "PIN staf baru (4 digit): "; stty -echo; read PIN; stty echo; echo; else read PIN; fi
case "$PIN" in [0-9][0-9][0-9][0-9]) ;; *) echo "PIN harus 4 digit"; exit 1;; esac
systemctl stop booth-agent
runuser -u booth -- env DATA_DIR=/var/lib/booth-agent /opt/node/bin/node /opt/booth-agent/current/dist/cli.js set-pin "$PIN"
systemctl start booth-agent
for i in $(seq 1 30); do curl -fsS --max-time 2 http://127.0.0.1:7777/health >/dev/null 2>&1 && break; sleep 1; done
echo "PIN tersimpan."
EOF
chmod 0750 /usr/local/sbin/booth-agent-set-pin

step "systemd"
install -m 0644 "$HERE/files/booth-agent.service" /etc/systemd/system/booth-agent.service
install -m 0644 "$HERE/files/booth-kiosk.service" /etc/systemd/system/booth-kiosk.service
install -D -m 0644 "$HERE/files/99-booth-camera.rules" /etc/udev/rules.d/99-booth-camera.rules
install -D -m 0644 "$HERE/files/journald-booth.conf" /etc/systemd/journald.conf.d/booth.conf
install -D -m 0644 "$HERE/files/logind-booth.conf" /etc/systemd/logind.conf.d/booth.conf
install -D -m 0644 "$HERE/files/50unattended-booth" /etc/apt/apt.conf.d/50unattended-booth
udevadm control --reload 2>/dev/null || true
# Chromium + kernel dikunci: update manual setelah dites (update otomatis bisa merusak kiosk).
apt-mark hold chromium chromium-common "linux-image-$ARCH" >/dev/null 2>&1 || true
systemctl daemon-reload
systemctl enable cups.service booth-agent.service booth-kiosk.service >/dev/null
systemctl set-default graphical.target >/dev/null
systemctl restart systemd-journald
systemctl restart booth-agent.service

step "cek kesehatan"
for i in $(seq 1 30); do
  curl -fsS --max-time 2 http://127.0.0.1:7777/health >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS --max-time 2 http://127.0.0.1:7777/health >/dev/null || { journalctl -u booth-agent -n 30 --no-pager; die "booth-agent tidak sehat"; }
echo "OK: booth-agent sehat. Reboot untuk menyalakan kiosk."
