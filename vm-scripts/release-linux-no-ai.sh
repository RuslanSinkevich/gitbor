#!/usr/bin/env bash
# ============================================================
#  GitBor No AI: pereborka Linux-artefaktov posle pravok na Windows
#  Chto delaet:
#    1. zabiraet svezhiy kod iz obshchey papki (krome node_modules/.git)
#    2. stavit zavisimosti (esli menyalis)
#    3. chistit starye artefakty (release/no_ai + linux-release/no_ai/)
#    4. sobiraet AppImage + deb + rpm (GITBOR_AI=0, electron-builder --linux)
#    5. kladet artefakty obratno v obshchuyu papku -> na Windows
#  Zapusk (iz obshchey papki, ne iz ~/gitbor):
#    bash /media/sf_gitbor/vm-scripts/release-linux-no-ai.sh
# ============================================================

set -e

SRC="/media/sf_gitbor"
DST="$HOME/gitbor"
OUT="$SRC/linux-release/no_ai"

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

echo "==> 2. Chistka staryh artefaktov i node_modules renderera"
# Renderer derzhit svoy node_modules. Esli on prishel s Windows, tam lezhit
# Windows-binar rollup (@rollup/rollup-win32-*) i vite build na Linux libo
# padaet, libo ne sobiraet dist/renderer -> v asar ne popadaet index.html ->
# prilozhenie pri starte: ERR_FAILED loading .../dist/renderer/index.html.
rm -rf "$DST/dist" "$DST/src/renderer/dist"
rm -rf "$DST/src/renderer/node_modules" "$DST/src/renderer/package-lock.json"

echo "==> 3. Ustanovka zavisimostey"
npm install --legacy-peer-deps
( cd src/renderer && npm install )

echo "==> 4. Ikonki (esli net icon.png ili nabora razmerov dlya Linux)"
if [ ! -f "$DST/resources/icon.png" ] || [ ! -d "$DST/resources/icons" ]; then
  npm run build:icons
fi

echo "==> 5. Proverka rpm-tooling (dlya .rpm pod RedOS/Fedora)"
if ! command -v rpmbuild >/dev/null 2>&1; then
  echo "   rpmbuild ne najden, ustanavlivayu paket rpm"
  sudo apt install -y rpm
fi

echo "==> 6. Ochistka staryh artefaktov (release/no_ai + linux-release/no_ai/)"
rm -rf "$DST"/release/no_ai
rm -rf "$OUT"

echo "==> 7. Sborka UI (renderer + main), GITBOR_AI=0"
GITBOR_AI=0 npm run build

# KRITICHNAYA PROVERKA: bez etogo fayla asar soberetsya bez UI i prilozhenie
# upadet pri starte (ERR_FAILED loading dist/renderer/index.html). Luchshe
# upast zdes, chem vylozhit bituyu sborku v bucket.
if [ ! -f "$DST/dist/renderer/index.html" ]; then
  echo ""
  echo "OSHIBKA: dist/renderer/index.html ne sobralsya."
  echo "  Renderer ne sobralsya (chasto: Windows-binar rollup v node_modules)."
  echo "  Smotri vyvod 'npm run build' vyshe. Sborka prervana."
  exit 1
fi
echo "    OK: dist/renderer/index.html na meste"

echo "==> 8. Upakovka Linux-artefaktov No AI (AppImage + deb + rpm)"
npm test
npx electron-builder --linux \
  --config.directories.output=release/no_ai \
  --config.productName="GitBor No AI" \
  --config.appId=ru.gitbor.app.noai \
  --config.publish.url=https://storage.yandexcloud.net/gitbor/stable/linux/no_ai/ \
  --config.linux.artifactName="GitBor-NoAI-\${version}.\${ext}"

echo "==> 9. Kopirovanie artefaktov obratno v $OUT"
mkdir -p "$OUT"
copied=0
for f in "$DST"/release/no_ai/*.AppImage \
         "$DST"/release/no_ai/*.AppImage.blockmap \
         "$DST"/release/no_ai/*.deb \
         "$DST"/release/no_ai/*.rpm \
         "$DST"/release/no_ai/latest-linux.yml; do
  if [ -f "$f" ]; then
    cp -v "$f" "$OUT/"
    copied=$((copied + 1))
  fi
done

if [ "$copied" -eq 0 ]; then
  echo "OSHIBKA: artefakty ne sobralis (release/no_ai pust)."
  exit 1
fi

echo ""
echo "============================================================"
echo " GOTOVO. Fayly na Windows tut:"
echo "   <papka proekta gitbor>\\linux-release\\no_ai\\"
echo ""
echo " Zalit v bucket: gitbor/stable/linux/no_ai/  (perezapisat)"
echo "   - GitBor-NoAI-X.Y.Z.AppImage"
echo "   - GitBor-NoAI-X.Y.Z.deb"
echo "   - GitBor-NoAI-X.Y.Z.rpm"
echo "   - latest-linux.yml"
echo "============================================================"
