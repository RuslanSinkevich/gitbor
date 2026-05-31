#!/usr/bin/env bash
# ============================================================
#  GitBor: pereborka Linux-artefaktov posle pravok na Windows
#  Chto delaet:
#    1. zabiraet svezhiy kod iz obshchey papki (krome node_modules/.git)
#    2. stavit zavisimosti (esli menyalis)
#    3. chistit starye artefakty (release/ + linux-release/)
#    4. sobiraet AppImage + deb + rpm (npm run dist:linux)
#    5. kladet artefakty obratno v obshchuyu papku -> na Windows
#  Zapusk (iz obshchey papki, ne iz ~/gitbor):
#    bash /media/sf_gitbor/vm-scripts/release-linux.sh
# ============================================================

set -e

SRC="/media/sf_gitbor"
DST="$HOME/gitbor"
OUT="$SRC/linux-release"

if [ ! -d "$SRC" ]; then
  echo "OSHIBKA: obshchaya papka $SRC ne najdena. Proverь shared folder."
  exit 1
fi

echo "==> 1. rsync: sinhronizaciya koda Windows -> VM"
if ! command -v rsync >/dev/null 2>&1; then
  echo "   rsync ne najden, ustanavlivayu"
  sudo apt install -y rsync
fi
rsync -a \
  --exclude 'node_modules' \
  --exclude 'release' \
  --exclude 'dist' \
  --exclude '.git' \
  --exclude 'linux-release' \
  "$SRC/" "$DST/"

cd "$DST"

echo "==> 2. Ustanovka zavisimostey (idempotentno)"
npm install --legacy-peer-deps
( cd src/renderer && npm install )

echo "==> 3. Ikonki (esli net)"
if [ ! -f "$DST/resources/icon.png" ]; then
  npm run build:icons
fi

echo "==> 4. Proverka rpm-tooling (dlya .rpm pod RedOS/Fedora)"
if ! command -v rpmbuild >/dev/null 2>&1; then
  echo "   rpmbuild ne najden, ustanavlivayu paket rpm"
  sudo apt install -y rpm
fi

echo "==> 5. Ochistka staryh artefaktov (release/ + linux-release/)"
rm -f "$DST"/release/*.AppImage \
      "$DST"/release/*.AppImage.blockmap \
      "$DST"/release/*_amd64.deb \
      "$DST"/release/*.rpm \
      "$DST"/release/latest-linux.yml 2>/dev/null || true
rm -rf "$OUT"

echo "==> 6. Sborka Linux-artefaktov (AppImage + deb + rpm)"
npm run dist:linux

echo "==> 7. Kopirovanie artefaktov obratno v $OUT"
mkdir -p "$OUT"
copied=0
for f in "$DST"/release/*.AppImage \
         "$DST"/release/*.AppImage.blockmap \
         "$DST"/release/*_amd64.deb \
         "$DST"/release/*.rpm \
         "$DST"/release/latest-linux.yml; do
  if [ -f "$f" ]; then
    cp -v "$f" "$OUT/"
    copied=$((copied + 1))
  fi
done

if [ "$copied" -eq 0 ]; then
  echo "OSHIBKA: artefakty ne sobralis (release/ pust)."
  exit 1
fi

echo ""
echo "============================================================"
echo " GOTOVO. Fayly na Windows tut:"
echo "   D:\\Users\\Admin\\Desktop\\Skycode\\gitbor\\linux-release\\"
echo ""
echo " Zalit v bucket: gitbor/stable/linux/  (perezapisat)"
echo "   - GitBor-X.Y.Z.AppImage"
echo "   - gitbor_X.Y.Z_amd64.deb"
echo "   - gitbor-X.Y.Z.x86_64.rpm"
echo "   - latest-linux.yml"
echo "============================================================"
