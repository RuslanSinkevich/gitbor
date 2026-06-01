#!/usr/bin/env bash
# ============================================================
#  GitBor: diagnostika "process zhiv, okna net"
#  Zapuskaet s debug-logom, pokazyvaet log prilozheniya i
#  schitaet processy (renderer/gpu) — chtoby ponyat, gde stop.
#  Zapusk:  bash /media/sf_gitbor/vm-scripts/diag-window.sh
# ============================================================

pkill -f '/opt/GitBor/gitbor' 2>/dev/null || true
sleep 1

LOG=/tmp/gitbor-diag.log
APPLOG="$HOME/.config/GitBor/logs/$(date +%F).log"

echo "==> Zapusk: GITBOR_LOG_LEVEL=debug gitbor --disable-gpu (fon, 7 sek)"
GITBOR_LOG_LEVEL=debug gitbor --disable-gpu > "$LOG" 2>&1 &
GP=$!
sleep 7

echo ""
echo "==> Processy gitbor (skolko ih):"
ps -o pid,cmd -C gitbor 2>/dev/null || ps aux | grep '[g]itbor'
echo "    vsego: $(pgrep -c -f '/opt/GitBor/gitbor' 2>/dev/null || echo '?')"

echo ""
echo "==> Okna na ekrane (wmctrl, esli est):"
command -v wmctrl >/dev/null 2>&1 && wmctrl -l || echo "    wmctrl ne ustanovlen (ne kritichno)"

echo ""
echo "==> stdout/stderr (posledniye 25 strok):"
tail -n 25 "$LOG"

echo ""
echo "==> Log prilozheniya $APPLOG (posledniye 30 strok):"
[ -f "$APPLOG" ] && tail -n 30 "$APPLOG" || echo "    net fayla loga"

kill "$GP" 2>/dev/null || true
pkill -f '/opt/GitBor/gitbor' 2>/dev/null || true
