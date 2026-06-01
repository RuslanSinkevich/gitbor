#!/usr/bin/env bash
# ============================================================
#  GitBor: vytaschit prichinu krasha renderera
#  Ubivaet vse kopii, zapuskaet odin raz s debug-logom,
#  sobiraet polnyy log i pokazyvaet stroki s prichinoy krasha.
#  Zapusk:  bash /media/sf_gitbor/vm-scripts/diag-crash.sh
# ============================================================

echo "==> Ubivayu vse kopii gitbor"
pkill -9 gitbor 2>/dev/null || true
pkill -9 -f '/opt/GitBor/gitbor' 2>/dev/null || true
sleep 2

LOG=/tmp/gitbor-crash.log
echo "==> Chistyy zapusk (debug, fon, 8 sek)"
GITBOR_LOG_LEVEL=debug gitbor --disable-gpu > "$LOG" 2>&1 &
GP=$!
sleep 8
kill "$GP" 2>/dev/null || true
pkill -9 gitbor 2>/dev/null || true

echo ""
echo "==> Stroki s prichinoy krasha/oshibki:"
grep -nEi "shared_memory|FATAL|signal|Check failed|renderer|GpuChannel|crashed|ERR_|gl_|swiftshader|EGL|GLX|vulkan|out of memory|mmap|memfd" "$LOG" | head -50

echo ""
echo "==> Vsego strok v loge: $(wc -l < "$LOG")"
echo "==> Posledniye 40 strok:"
tail -n 40 "$LOG"

echo ""
echo "==> Sistemnye crash-reporty (apport):"
ls -lt /var/crash/ 2>/dev/null | head -5 || echo "    net /var/crash"
