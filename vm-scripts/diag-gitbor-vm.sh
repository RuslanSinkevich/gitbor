#!/usr/bin/env bash
# ============================================================
#  GitBor: diagnostika zapuska v VM
#  Sobiraet info o sisteme + probuet zapustit v odnom processe
#  (--single-process). Esli tak rabotaet — problema v sozdanii
#  dochernih processov (zygote/sandbox/kernel), a ne v sborke.
#  Zapusk:  bash /media/sf_gitbor/vm-scripts/diag-gitbor-vm.sh
# ============================================================

echo "========== SISTEMA =========="
echo "--- uname ---"; uname -a
echo "--- OS ---"; (lsb_release -a 2>/dev/null || cat /etc/os-release)
echo "--- pamyat ---"; free -h
echo "--- glibc ---"; ldd --version 2>/dev/null | head -1
echo "--- electron bin ---"; ls -la /opt/GitBor/gitbor 2>/dev/null
echo "--- apparmor userns (Ubuntu 24+) ---"
sysctl kernel.apparmor_restrict_unprivileged_userns 2>/dev/null || echo "  (net takogo sysctl)"
echo "--- chrome-sandbox ---"; ls -la /opt/GitBor/chrome-sandbox 2>/dev/null

TMPD="$HOME/gitbor-tmp"
mkdir -p "$TMPD"; chmod 1777 "$TMPD" 2>/dev/null || true

echo ""
echo "========== TEST: --single-process =========="
echo "(zapusk na 7 sek v fone, potom pokazhu log)"
TMPDIR="$TMPD" gitbor --no-sandbox --disable-gpu --single-process \
  > /tmp/gitbor-sp.log 2>&1 &
GP=$!
sleep 7
if kill -0 "$GP" 2>/dev/null; then
  echo ">>> PROCESS ZHIV (vozmozhno okno otkrylos). Ostanavlivayu test."
  kill "$GP" 2>/dev/null || true
else
  echo ">>> PROCESS UPAL za 7 sek."
fi
echo ""
echo "--- posledniye stroki loga ---"
tail -n 30 /tmp/gitbor-sp.log
