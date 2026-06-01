#!/usr/bin/env bash
# ============================================================
#  GitBor: polnaya ochistka vsekh sledov ustanovki
#  Snosit: deb-paket, AppImage-ustanovku, yarlyki, ikonki,
#          konfig i kesh polzovatelya, ostatki v /opt.
#  Posle etogo mozhno stavit zanovo s chistogo lista.
#  Zapusk:  bash /media/sf_gitbor/vm-scripts/uninstall-clean.sh
# ============================================================

echo "==> 1. Udalenie deb-paketa (purge, esli stoit)"
PKG=$(dpkg-query -W -f='${Package}\n' 2>/dev/null | grep -i '^gitbor' || true)
if [ -n "$PKG" ]; then
  echo "    nayden paket: $PKG"
  sudo apt purge -y "$PKG" || sudo dpkg --purge "$PKG" || true
else
  echo "    deb-paket ne stoit"
fi

echo "==> 2. Udalenie AppImage-ustanovki (install-appimage.sh)"
rm -f "$HOME/Applications/GitBor.AppImage"
rm -f "$HOME/.local/share/applications/gitbor.desktop"
rm -f "$HOME/.local/share/icons/gitbor.png"

echo "==> 3. Ostatki v sisteme (/opt, sistemnye yarlyki/ikonki)"
sudo rm -rf /opt/GitBor
sudo rm -f /usr/share/applications/gitbor.desktop
sudo rm -f /usr/share/icons/hicolor/*/apps/gitbor.png

echo "==> 4. Konfig i kesh polzovatelya"
rm -rf "$HOME/.config/GitBor"
rm -rf "$HOME/.cache/GitBor"
rm -rf "$HOME/.config/gitbor-updater"

echo "==> 5. Obnovlenie bazy menyu i ikonok"
update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1 || true
sudo update-desktop-database >/dev/null 2>&1 || true
sudo gtk-update-icon-cache /usr/share/icons/hicolor >/dev/null 2>&1 || true

echo ""
echo "============================================================"
echo " GOTOVO. Vse sledy GitBor udaleny."
echo " Proverka (dolzhno byt pusto):"
echo "   which gitbor"
echo "   ls /opt/GitBor 2>/dev/null"
echo "   dpkg -l | grep -i gitbor"
echo " Teper mozhno stavit zanovo (deb / AppImage)."
echo "============================================================"
