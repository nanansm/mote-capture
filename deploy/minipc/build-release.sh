#!/usr/bin/env bash
# Bangun release booth-agent untuk mini PC: booth-agent-<arch>.tar.gz
#   dist/      bundle esbuild (main.js, cli.js)
#   node_modules/  dependency produksi, modul native di-build untuk Debian 13 <arch>
#   web/       build apps/web (kiosk)
# Pakai: ARCH=amd64|arm64 ./build-release.sh
set -euo pipefail
ARCH=${ARCH:-amd64}
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
OUT=$HERE/out/release-$ARCH
NODE_VERSION=${NODE_VERSION:-22.22.1}
rm -rf "$OUT" && mkdir -p "$OUT/pkg"

# 1) build JS di host (arsitektur tidak berpengaruh untuk bundle JS / web statis)
(cd "$REPO/apps/booth-agent" && pnpm run build >/dev/null)
(cd "$REPO/apps/web" && pnpm run build >/dev/null)
cp -r "$REPO/apps/booth-agent/dist" "$OUT/pkg/dist"
cp -r "$REPO/apps/web/dist" "$OUT/pkg/web"

# 2) dependency produksi (external esbuild) dipasang di Debian 13 <arch> supaya prebuilt native cocok
node -e '
const p=require(process.argv[1]);
const ext=["better-sqlite3","sharp","@node-rs/argon2","fastify","@fastify/http-proxy","@fastify/static","@fastify/websocket","ws"];
const path=require("path"),fs=require("fs");
// Versi PERSIS yang terpasang + dites di workspace (bukan rentang ^), supaya release = yang lulus tes.
const deps={};for(const k of ext){if(!p.dependencies[k])throw new Error("dep hilang: "+k);
  const pj=path.join(path.dirname(process.argv[1]),"node_modules",k,"package.json");
  deps[k]=JSON.parse(fs.readFileSync(fs.realpathSync(pj),"utf8")).version;}
require("fs").writeFileSync(process.argv[2],JSON.stringify({name:"booth-agent-release",version:p.version,private:true,type:"module",dependencies:deps},null,2));
' "$REPO/apps/booth-agent/package.json" "$OUT/pkg/package.json"

docker run --rm --platform "linux/$ARCH" -v "$OUT/pkg:/pkg" -w /pkg debian:trixie bash -euo pipefail -c "
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq && apt-get install -y -qq --no-install-recommends ca-certificates curl xz-utils >/dev/null
  NA=\$([ \$(dpkg --print-architecture) = amd64 ] && echo x64 || echo arm64)
  curl -fsSL https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-\$NA.tar.xz | tar -xJ -C /opt
  export PATH=/opt/node-v$NODE_VERSION-linux-\$NA/bin:\$PATH
  npm install --omit=dev --no-audit --no-fund --loglevel=error
  # bukti modul native jalan di Debian 13 <arch>
  node -e \"const D=require('better-sqlite3');new D(':memory:').exec('select 1');require('sharp');require('@node-rs/argon2');console.log('native OK', process.arch)\"
  chown -R $(id -u):$(id -g) /pkg
"
tar -czf "$HERE/out/booth-agent-$ARCH.tar.gz" -C "$OUT/pkg" .
ls -la "$HERE/out/booth-agent-$ARCH.tar.gz"
