#!/usr/bin/env bash
# Build the Mote Capture Bridge installer on macOS/Linux via Wine.
# Requires: Wine + Inno Setup 6 installed inside Wine prefix.
set -euo pipefail

cd "$(dirname "$0")"

echo "=== Mote Capture Bridge — Building Installer (macOS/Linux via Wine) ==="
echo

# 1) Wine check
if ! command -v wine &> /dev/null; then
    cat <<EOF
✗ Wine tidak terinstall.

  macOS:  brew install --cask wine-stable
  Linux:  sudo apt install wine64       (Ubuntu/Debian)

Setelah install:
  1. Download installer Inno Setup 6 dari https://jrsoftware.org/isdl.php
  2. Run: wine ./innosetup-6.x.x.exe
EOF
    exit 1
fi

# 2) Locate ISCC.exe inside Wine prefix
WINEPREFIX="${WINEPREFIX:-$HOME/.wine}"
ISCC_CANDIDATES=(
    "$WINEPREFIX/drive_c/Program Files (x86)/Inno Setup 6/ISCC.exe"
    "$WINEPREFIX/drive_c/Program Files/Inno Setup 6/ISCC.exe"
)
ISCC_PATH=""
for c in "${ISCC_CANDIDATES[@]}"; do
    if [ -f "$c" ]; then
        ISCC_PATH="$c"
        break
    fi
done

if [ -z "$ISCC_PATH" ]; then
    echo "✗ Inno Setup belum diinstall di Wine prefix ($WINEPREFIX)."
    echo "  Run: wine ./innosetup-6.x.x.exe"
    exit 1
fi

# 3) Regenerate wizard assets
echo "[1/2] Generating installer assets..."
node "assets/generate-installer-assets.cjs"

# 4) Compile
echo "[2/2] Compiling installer via wine..."
echo "  ISCC: $ISCC_PATH"
wine "$ISCC_PATH" "MoteCaptureBridge.iss"

echo
echo "✓ Installer ready: output/MoteCaptureBridge-Setup-0.1.0.exe"
ls -lh output/MoteCaptureBridge-Setup-0.1.0.exe 2>/dev/null || true
