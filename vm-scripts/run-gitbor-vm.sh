#!/usr/bin/env bash
# ============================================================
#  GitBor: zapusk v VirtualBox-VM bez rabochego 3D.
#
#  Problema: Ozone vybiraet Wayland, a v VM GPU (vmwgfx) sloman
#  -> GPU-process padaet -> SIGTRAP glavnogo, okno ne pokazyvaetsya.
#  Reshenie: forsim X11 (XWayland) + software-rendering.
#
#  Eto OBHODNOY zapusk TOLKO dlya slomannoy VM. Na realnom zheleze
#  / VM s 3D prilozhenie zapuskaetsya obychnym `gitbor` bez flagov.
#
#  Zapusk:  bash /media/sf_gitbor/vm-scripts/run-gitbor-vm.sh
# ============================================================

echo "==> Zapusk: gitbor --ozone-platform=x11 --disable-gpu"
echo "    (obhod dlya VM bez 3D: X11 vmesto Wayland + soft-render)"
echo ""

exec gitbor --ozone-platform=x11 --disable-gpu "$@"
