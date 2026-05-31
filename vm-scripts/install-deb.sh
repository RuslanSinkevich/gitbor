#!/usr/bin/env bash
# ============================================================
#  GitBor: ustanovka cherez .deb (kak obychnyy polzovatel Ubuntu/Debian)
#  Chto delaet:
#    1. udalyaet staruyu AppImage-ustanovku (yarlyk + ikonka + fayl)
#    2. udalyaet staryy deb-paket (esli stoit)
#    3. nahodit svezhiy gitbor_*_amd64.deb (lokalno ili kachaet iz bucketa)
#    4. stavit cherez apt -> ikonka i pункт menyu propisyvayutsya avtomaticheski
#  Zapusk:  bash /media/sf_gitbor/vm-scripts/install-deb.sh
# ============================================================

set -e

BUCKET="https://storage.yandexcloud.net/gitbor/stable/linux"
SEARCH_DIRS=("$HOME/gitbor/release" "/media/sf_gitbor/linux-release" "$HOME/Downloads")

echo "==> 1. Udalenie staroy AppImage-ustanovki (esli est)"
rm -f "$HOME/Applications/GitBor.AppImage"
rm -f "$HOME/.local/share/applications/gitbor.desktop"
rm -f "$HOME/.local/share/icons/gitbor.png"
update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1 || true

echo "==> 2. Udalenie starogo deb-paketa (esli stoit)"
PKG=$(dpkg-query -W -f='${Package}\n' 2>/dev/null | grep -i '^gitbor' || true)
if [ -n "$PKG" ]; then
  echo "    nayden paket: $PKG, udalyayu"
  sudo apt remove -y "$PKG"
fi

echo "==> 3. Poisk svezhego deb"
DEB=""
for d in "${SEARCH_DIRS[@]}"; do
  if [ -d "$d" ]; then
    found=$(ls -t "$d"/gitbor_*_amd64.deb 2>/dev/null | head -n1 || true)
    if [ -n "$found" ]; then
      DEB="$found"
      break
    fi
  fi
done

if [ -z "$DEB" ]; then
  echo "    lokalno ne nayden, kachayu iz bucketa"
  YML=$(curl -fsSL "$BUCKET/latest-linux.yml")
  DEB_NAME=$(echo "$YML" | grep -oE 'gitbor_[0-9.]+_amd64\.deb' | head -n1)
  if [ -z "$DEB_NAME" ]; then
    echo "OSHIBKA: ne udalos opredelit imya deb iz latest-linux.yml"
    exit 1
  fi
  mkdir -p "$HOME/Downloads"
  DEB="$HOME/Downloads/$DEB_NAME"
  curl -fSL "$BUCKET/$DEB_NAME" -o "$DEB"
fi
echo "    deb: $DEB"

echo "==> 4. Ustanovka cherez apt"
sudo apt install -y "$DEB"

echo "==> Obnovlenie bazy menyu i ikonok"
update-desktop-database /usr/share/applications >/dev/null 2>&1 || true
gtk-update-icon-cache /usr/share/icons/hicolor >/dev/null 2>&1 || true

echo ""
echo "============================================================"
echo " GOTOVO. GitBor v menyu prilozheniy (poisk: GitBor)."
echo " Zapusk iz menyu ili komandoy: gitbor"
echo " Udalit:  sudo apt remove -y gitbor"
echo "============================================================"
