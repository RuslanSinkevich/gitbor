#!/usr/bin/env bash
# ============================================================
#  GitBor: kopirovanie Linux-artefaktov v obshchuyu papku
#  (chtoby zalit v bucket s Windows)
#  Zapusk:  bash ~/gitbor/vm-scripts/copy-release.sh
# ============================================================

SRC="$HOME/gitbor/release"
DST="/media/sf_gitbor/linux-release"

mkdir -p "$DST"

echo "==> Kopiruyu Linux-artefakty v $DST"
copied=0
for f in "$SRC"/*.AppImage "$SRC"/*.AppImage.blockmap "$SRC"/*_amd64.deb "$SRC"/latest-linux.yml; do
  if [ -f "$f" ]; then
    cp -v "$f" "$DST/"
    copied=$((copied + 1))
  fi
done

if [ "$copied" -eq 0 ]; then
  echo "OSHIBKA: ne nashel artefaktov v $SRC. Snachala: npm run dist:linux"
  exit 1
fi

echo ""
echo "============================================================"
echo " GOTOVO. Fayly na Windows tut:"
echo "   D:\\Users\\Admin\\Desktop\\Skycode\\gitbor\\linux-release\\"
echo " Zalit v bucket: gitbor/stable/linux/"
echo "============================================================"
