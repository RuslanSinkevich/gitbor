#!/usr/bin/env bash
# ============================================================
#  GitBor: razbor crash-fayla i proverka pamyati/OOM
#  Zapusk:  bash /media/sf_gitbor/vm-scripts/diag-crashfile.sh
# ============================================================

CR=/var/crash/_opt_GitBor_gitbor.1000.crash

echo "========== CRASH-FAYL =========="
if [ -f "$CR" ]; then
  # Tekstovye polya apport (kakoy process i kakoy signal upal)
  grep -aE "^(ProblemType|Date|Signal|ExecutablePath|ProcCmdline):" "$CR"
else
  echo "  net fayla $CR"
fi

echo ""
echo "========== PAMYAT =========="
free -h
echo "--- swap ---"
swapon --show 2>/dev/null || echo "  swap net"

echo ""
echo "========== OOM-KILLS (dmesg) =========="
echo "(nuzhen sudo)"
sudo dmesg 2>/dev/null | grep -iE "out of memory|oom-kill|killed process|Out of memory" | tail -20 \
  || echo "  ne udalos prochitat dmesg ili net OOM"

echo ""
echo "========== Skolko pamyati u VM =========="
grep -E "MemTotal|MemAvailable|SwapTotal" /proc/meminfo
