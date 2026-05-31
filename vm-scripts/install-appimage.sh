#!/usr/bin/env bash
# ============================================================
#  GitBor: integraciya AppImage v menyu prilozheniy (bez admina)
#  - kladet AppImage v ~/Applications/GitBor.AppImage (stabilnoe imya,
#    chtoby auto-update zamenyal fayl na meste)
#  - sozdaet .desktop yarlyk + ikonku
#  Zapusk:  bash /media/sf_gitbor/vm-scripts/install-appimage.sh
# ============================================================

set -e

REL="$HOME/gitbor/release"
APP_DIR="$HOME/Applications"
DEST="$APP_DIR/GitBor.AppImage"
ICON_DIR="$HOME/.local/share/icons"
DESKTOP_DIR="$HOME/.local/share/applications"
DESKTOP="$DESKTOP_DIR/gitbor.desktop"

# 1. najti svezhiy AppImage
SRC=$(ls -t "$REL"/GitBor-*.AppImage 2>/dev/null | head -n1)
if [ -z "$SRC" ]; then
  echo "OSHIBKA: ne najden GitBor-*.AppImage v $REL. Snachala: npm run dist:linux"
  exit 1
fi
echo "==> Istochnik: $SRC"

# 2. skopirovat pod stabilnym imenem
mkdir -p "$APP_DIR"
cp -f "$SRC" "$DEST"
chmod +x "$DEST"
echo "==> Ustanovlen: $DEST"

# 3. vytaschit ikonku iz AppImage
mkdir -p "$ICON_DIR"
TMP=$(mktemp -d)
( cd "$TMP" && "$DEST" --appimage-extract 'gitbor.png' >/dev/null 2>&1 || true )
if [ -f "$TMP/squashfs-root/gitbor.png" ]; then
  cp -f "$TMP/squashfs-root/gitbor.png" "$ICON_DIR/gitbor.png"
  ICON="$ICON_DIR/gitbor.png"
  echo "==> Ikonka: $ICON"
else
  ICON="utilities-terminal"
  echo "==> Ikonka ne najdena v AppImage, stavlyu sistemnuyu"
fi
rm -rf "$TMP"

# 4. sozdat .desktop yarlyk
#    --appimage-extract-and-run: zapusk bez libfuse2 (Ubuntu 24+).
#    --no-sandbox NE nuzhen: prilozhenie samo otklyuchaet sandbox na Linux
#    (sm. src/main/main.ts), chto pozvolyaet otkat cherez GITBOR_ENABLE_SANDBOX=1.
mkdir -p "$DESKTOP_DIR"
cat > "$DESKTOP" <<EOF
[Desktop Entry]
Type=Application
Name=GitBor
Comment=Cross-platform desktop Git client
Exec=$DEST --appimage-extract-and-run %U
Icon=$ICON
Terminal=false
Categories=Development;RevisionControl;
StartupWMClass=GitBor
EOF
chmod +x "$DESKTOP"
echo "==> Yarlyk: $DESKTOP"

# 5. obnovit bazu menyu
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true
fi

echo ""
echo "============================================================"
echo " GOTOVO. GitBor v menyu prilozheniy (poisk: GitBor)."
echo " Auto-update zamenyaet $DEST na meste."
echo "============================================================"
