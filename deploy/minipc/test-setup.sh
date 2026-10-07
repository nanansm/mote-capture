#!/usr/bin/env bash
# Tes setup.sh di Debian 13 dengan systemd asli (container --privileged, init = systemd).
# Pakai: ARCH=arm64|amd64 ./test-setup.sh
# Agent memakai driver mock (tidak ada kamera/printer di container) dan API_ORIGIN palsu.
set -euo pipefail
ARCH=${ARCH:-arm64}
HERE=$(cd "$(dirname "$0")" && pwd)
NAME=booth-test-$ARCH
IMG=booth-systemd:trixie-$ARCH
REL=$HERE/out/booth-agent-$ARCH.tar.gz
DEBS=$HERE/out/$ARCH
[ -f "$REL" ] || { echo "release tidak ada: $REL"; exit 1; }
ls "$DEBS"/printer-driver-gutenprint_5.3.6*.deb >/dev/null || { echo "deb gutenprint tidak ada: $DEBS"; exit 1; }

docker build -q --platform "linux/$ARCH" -t "$IMG" - >/dev/null <<'EOF'
FROM debian:trixie
RUN apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends systemd systemd-sysv dbus curl ca-certificates >/dev/null \
 && rm -f /lib/systemd/system/multi-user.target.wants/getty* \
 && systemctl mask systemd-logind.service getty.target console-getty.service systemd-binfmt.service proc-sys-fs-binfmt_misc.automount proc-sys-fs-binfmt_misc.mount
STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
EOF

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" --platform "linux/$ARCH" --privileged --cgroupns=host \
  -v /sys/fs/cgroup:/sys/fs/cgroup:rw --tmpfs /run --tmpfs /run/lock \
  -v "$HERE:/src:ro" -v "$REL:/rel.tar.gz:ro" -v "$DEBS:/debs:ro" "$IMG" >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
for i in $(seq 1 60); do docker exec "$NAME" systemctl is-system-running 2>/dev/null | grep -qE "running|degraded" && break; sleep 1; done

ex() { docker exec "$NAME" bash -c "$*"; }
pass=0; fail=0
ok() { echo "LULUS  $1"; pass=$((pass+1)); }
bad() { echo "GAGAL  $1"; fail=$((fail+1)); }

TOKEN=tes-rahasia-$RANDOM$RANDOM
echo "--- instal pertama"
if ex "cd /src && BOOTH_ID=BOOTH-TEST BRIDGE_TOKEN=$TOKEN API_ORIGIN=http://127.0.0.1:9 DEBS=/debs ./setup.sh /rel.tar.gz" > "$HERE/out/setup-$ARCH-1.log" 2>&1; then ok "setup.sh exit 0"; else bad "setup.sh gagal (lihat out/setup-$ARCH-1.log)"; tail -20 "$HERE/out/setup-$ARCH-1.log"; exit 1; fi

# mode uji: driver mock (tanpa hardware), sisanya sama dengan produksi
ex "printf 'CAMERA_DRIVER=mock\nPRINTER_DRIVER=mock\n' >> /etc/booth-agent/env && systemctl restart booth-agent"
sleep 3
ex "curl -fsS --max-time 3 http://127.0.0.1:7777/health" >/dev/null && ok "/health 200" || bad "/health"
ex "curl -fsS --max-time 3 http://127.0.0.1:7777/kiosk/BOOTH-TEST | grep -q '<div id=\"root\"'" && ok "kiosk web disajikan" || bad "kiosk web"
ex "/usr/lib/cups/driver/gutenprint.5.3 list | grep -q canon-cp1500" && ok "driver CP1500 terpasang" || bad "driver CP1500"
ex "command -v gphoto2 >/dev/null" && ok "gphoto2 ada" || bad "gphoto2"
ex "! dpkg -l gvfs-backends 2>/dev/null | grep -q ^ii" && ok "gvfs tidak terpasang" || bad "gvfs terpasang"
ex "stat -c '%a %U:%G' /etc/booth-agent/env" | grep -q "640 root:booth" && ok "env 0640 root:booth" || bad "izin env"
ex "ps -o user= -C node | grep -qx booth" && ok "agent jalan sebagai user booth" || bad "user agent"

echo "--- crash: kill -9 -> systemd hidupkan lagi"
pid1=$(ex "systemctl show -p MainPID --value booth-agent")
ex "kill -9 $pid1"; sleep 5
pid2=$(ex "systemctl show -p MainPID --value booth-agent")
[ "$pid2" != 0 ] && [ "$pid2" != "$pid1" ] && ex "curl -fsS --max-time 3 http://127.0.0.1:7777/health" >/dev/null && ok "restart otomatis setelah crash" || bad "restart otomatis"

echo "--- SIGTERM rapi (stop < 20 detik, tanpa SIGKILL)"
t0=$(date +%s); ex "systemctl restart booth-agent"; t1=$(date +%s)
[ $((t1 - t0)) -lt 20 ] && ok "restart rapi ($((t1 - t0))s)" || bad "restart lambat"
ex "journalctl -u booth-agent --no-pager | grep -q 'SIGKILL'" && bad "agent kena SIGKILL" || ok "tanpa SIGKILL"

echo "--- PIN staf"
ex "echo 4321 | booth-agent-set-pin" >/dev/null 2>&1 && ok "set PIN staf" || bad "set PIN staf"
resp=$(ex "curl -sS -X POST -H 'content-type: application/json' -d '{\"pin\":\"4321\"}' http://127.0.0.1:7777/staff/login" 2>&1 || true)
grep -q token <<<"$resp" && ok "login staf pakai PIN baru" || { bad "login staf"; echo "  respons: ${resp:0:200}"; ex "journalctl -u booth-agent -n 5 --no-pager" | cut -c1-200; }
ex "journalctl --no-pager | grep -q 4321" && bad "PIN muncul di journal" || ok "PIN tidak ada di journal"

echo "--- token tidak bocor"
ex "journalctl --no-pager | grep -q '$TOKEN'" && bad "token muncul di journal" || ok "token tidak ada di journal"
grep -q "$TOKEN" "$HERE/out/setup-$ARCH-1.log" && bad "token muncul di output setup" || ok "token tidak ada di output setup"

echo "--- instal ulang (idempotent)"
if ex "cd /src && DEBS=/debs ./setup.sh /rel.tar.gz" > "$HERE/out/setup-$ARCH-2.log" 2>&1; then ok "setup.sh kedua exit 0"; else bad "setup.sh kedua gagal"; tail -20 "$HERE/out/setup-$ARCH-2.log"; fi
ex "grep -c '^BRIDGE_TOKEN=' /etc/booth-agent/env" | grep -qx 1 && ok "env tidak terduplikasi" || bad "env terduplikasi"
ex "ls -1d /opt/booth-agent/releases/* | wc -l" | grep -qx 2 && ok "release lama disimpan (rollback)" || bad "jumlah release"

echo "--- unit kiosk valid"
ex "systemd-analyze verify /etc/systemd/system/booth-kiosk.service /etc/systemd/system/booth-agent.service 2>&1 | grep -v 'Unit configured to use KillMode' ; true" | grep -iE "error|invalid|unknown" && bad "unit systemd ada error" || ok "unit systemd valid"
ex "systemctl is-enabled booth-kiosk booth-agent cups" | grep -vqx enabled && bad "service belum enabled" || ok "service enabled saat boot"

echo "--- distro salah ditolak"
msg=$(docker run --rm --platform "linux/$ARCH" -v "$HERE:/src:ro" ubuntu:24.04 bash -c "cd /src && ./setup.sh /x" 2>&1 || true)
grep -q "hanya Debian 13" <<<"$msg" && ok "Ubuntu ditolak dengan pesan jelas" || bad "Ubuntu tidak ditolak"

echo "=== $pass lulus, $fail gagal ($ARCH)"
[ "$fail" = 0 ]
