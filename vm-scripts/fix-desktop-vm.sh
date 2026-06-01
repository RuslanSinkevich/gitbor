#!/usr/bin/env bash
# ============================================================
#  GitBor: pochinka yarlyka v VM
#   1. Exec -> dobavlyaem --ozone-platform=x11 --disable-gpu
#      (chtoby zapusk IKONKOY v VM bez 3D ne padal na Wayland)
#   2. Icon -> absolyutnyy put k ustanovlennomu PNG
#      (chinit "shesteryonku": absolyutnyy put resolvitsya vsegda)
#   3. Obnovlyaem kesh ikonok i bazu menyu
#
#  Tolko dlya VM. Na realnom zheleze yarlyk ot deb rabotaet kak est.
#  Zapusk:  bash /media/sf_gitbor/vm-scripts/fix-desktop-vm.sh
# ============================================================

set -e

DESKTOP=/usr/share/applications/gitbor.desktop
if [ ! -f "$DESKTOP" ]; then
  echo "OSHIBKA: net $DESKTOP (deb ustanovlen?)"
  exit 1
fi

echo "========== DO POCHINKI =========="
echo "--- tekushchie Exec/Icon ---"
grep -E "^(Exec|Icon)=" "$DESKTOP" || true
echo "--- ustanovlennye ikonki gitbor ---"
ls -1 /usr/share/icons/hicolor/*/apps/gitbor.png 2>/dev/null || echo "  (v hicolor net gitbor.png!)"

# Vybiraem samuyu bolshuyu ikonku (po razmeru direktorii: 512x512 > 256x256 ...)
ICON=$(ls /usr/share/icons/hicolor/*/apps/gitbor.png 2>/dev/null | sort -V | tail -n1)
# Zapasnoy variant — ikonka vnutri /opt
if [ -z "$ICON" ] && [ -f /opt/GitBor/resources/icon.png ]; then
  ICON=/opt/GitBor/resources/icon.png
fi

echo ""
echo "========== POCHINKA =========="
echo "==> Exec -> X11 + disable-gpu"
sudo sed -i -E "s#^Exec=.*#Exec=/opt/GitBor/gitbor --ozone-platform=x11 --disable-gpu %U#" "$DESKTOP"

if [ -n "$ICON" ]; then
  echo "==> Icon -> $ICON"
  sudo sed -i -E "s#^Icon=.*#Icon=$ICON#" "$DESKTOP"
else
  echo "==> Ikonka ne najdena — Icon ne tronut (razbiraemsya otdelno)"
fi

echo "==> Obnovlenie kesha ikonok i bazy menyu"
sudo gtk-update-icon-cache -f /usr/share/icons/hicolor >/dev/null 2>&1 || true
sudo update-desktop-database /usr/share/applications >/dev/null 2>&1 || true

echo ""
echo "========== POSLE =========="
grep -E "^(Exec|Icon)=" "$DESKTOP" || true
echo ""
echo "GOTOVO. Esli ikonka v menyu ne obnovilas srazu — pereloginsya"
echo "(ili Alt+F2 -> r na X11)."
