#!/usr/bin/env bash
# ============================================================
#  GitBor: kopirovanie proekta v Ubuntu i ustanovka zavisimostey
#  Zapusk:
#     bash /media/sf_gitbor/vm-scripts/project-setup.sh
# ============================================================

SRC="/media/sf_gitbor"
DST="$HOME/gitbor"

echo "==> 1. Kopiruyu proekt iz $SRC v $DST"
mkdir -p "$DST"
cp -r "$SRC/." "$DST/"

echo "==> 2. Udalyayu Windows-artefakty (root + renderer)"
rm -rf "$DST/node_modules" "$DST/dist"
rm -rf "$DST/src/renderer/node_modules" "$DST/src/renderer/package-lock.json"

echo "==> 3. Ustanovka zavisimostey - koren (npm install)"
cd "$DST" || exit 1
npm install --legacy-peer-deps

echo "==> 4. Ustanovka zavisimostey - renderer"
cd "$DST/src/renderer" || exit 1
npm install

echo "==> 5. Nastroyka chrome-sandbox dlya Electron"
SANDBOX="$DST/node_modules/electron/dist/chrome-sandbox"
if [ -f "$SANDBOX" ]; then
  sudo chown root:root "$SANDBOX"
  sudo chmod 4755 "$SANDBOX"
fi

echo ""
echo "============================================================"
echo " GOTOVO. Zapusk gitbor:"
echo "     cd ~/gitbor"
echo "     npm run dev"
echo "============================================================"
