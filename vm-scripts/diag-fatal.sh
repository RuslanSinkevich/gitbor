#!/usr/bin/env bash
# ============================================================
#  GitBor: snyat svezhuyu prichinu SIGTRAP glavnogo processa
#  Chistit staryy crash, zapuskaet s podrobnym Chromium-logom,
#  pokazyvaet fatal/CHECK/GL/Ozone stroki.
#  Zapusk:  bash /media/sf_gitbor/vm-scripts/diag-fatal.sh
# ============================================================

echo "==> Ubivayu kopii i chishchu staryy crash"
pkill -9 gitbor 2>/dev/null || true
sudo rm -f /var/crash/_opt_GitBor_gitbor*.crash 2>/dev/null || true
sleep 1

LOG=/tmp/gitbor-fatal.log

echo "==> Zapusk 1: --disable-gpu + podrobnyy Chromium-log (8 sek)"
timeout 8 gitbor --disable-gpu --enable-logging=stderr --v=1 > "$LOG" 2>&1
echo "    (zavershen)"

echo ""
echo "==> Stroki fatal/CHECK/GL/Ozone/display:"
grep -nEi "fatal|check failed|dcheck|abort|trap|ozone|wayland|\bx11\b|\begl\b|\bgl\b|gpu|display|swiftshader|vulkan|seccomp|namespace" "$LOG" | head -50

echo ""
echo "==> Posledniye 30 strok loga:"
tail -n 30 "$LOG"

echo ""
echo "==> Svezhiy crash-fayl (esli poyavilsya):"
ls -lt /var/crash/_opt_GitBor_gitbor*.crash 2>/dev/null | head -1 || echo "    net"
