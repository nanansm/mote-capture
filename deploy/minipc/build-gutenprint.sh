#!/usr/bin/env bash
# Backport Gutenprint 5.3.6 (Debian sid) ke Debian 13 trixie -> .deb di ./out/<arch>/
# Pakai: ARCH=amd64|arm64 ./build-gutenprint.sh
set -euo pipefail
ARCH=${ARCH:-amd64}
OUT=$(cd "$(dirname "$0")" && pwd)/out/$ARCH
mkdir -p "$OUT"
docker run --rm --platform "linux/$ARCH" -v "$OUT:/out" debian:trixie bash -euo pipefail -c '
  export DEBIAN_FRONTEND=noninteractive
  echo "deb-src http://deb.debian.org/debian sid main" > /etc/apt/sources.list.d/sid-src.list
  sed -i "s/^Types: deb$/Types: deb deb-src/" /etc/apt/sources.list.d/debian.sources
  apt-get update -qq
  apt-get install -y -qq --no-install-recommends build-essential devscripts equivs dpkg-dev fakeroot >/dev/null
  mkdir -p /build && cd /build
  apt-get source -qq -t sid gutenprint >/dev/null 2>&1 || apt-get source -qq gutenprint/sid
  cd gutenprint-*/
  # build-dep dari trixie (bukan sid) supaya hasil cocok dengan libc/cups trixie
  mk-build-deps -i -r -t "apt-get -y -qq --no-install-recommends" debian/control >/dev/null
  export DEBEMAIL="Mote Kreatif <smnanan@motekreatif.com>"
  dch --local "~bpo13+mote" --distribution trixie "Backport untuk booth Mote (driver Canon SELPHY CP1500)."
  DEB_BUILD_OPTIONS="nocheck parallel=$(nproc)" dpkg-buildpackage -b -us -uc >/build/build.log 2>&1 || { tail -40 /build/build.log; exit 1; }
  cp ../*.deb /out/
  # bukti: driver CP1500 ada dan paket terpasang di trixie bersih
  apt-get install -y -qq --no-install-recommends cups >/dev/null
  apt-get install -y -qq /out/libgutenprint-common_*.deb /out/libgutenprint9_*.deb /out/printer-driver-gutenprint_*.deb >/dev/null
  dpkg -l printer-driver-gutenprint | tail -1 | cut -c1-90
  (cups-genppd.5.3 -h >/dev/null 2>&1 || true)
  /usr/lib/cups/driver/gutenprint.5.3 list 2>/dev/null | grep -i "cp1500" | head -3 || echo "CP1500 TIDAK DITEMUKAN"
'
ls -la "$OUT"
