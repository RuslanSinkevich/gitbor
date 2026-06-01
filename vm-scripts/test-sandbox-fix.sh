#!/usr/bin/env bash
# ============================================================
#  GitBor: test fiksa zapuska na Ubuntu 24.04+/26.04
#  Gipoteza: deb stavit chrome-sandbox bez setuid-bita, a app
#  forsit --no-sandbox. Na yadre s zablokirovannym userns eto
#  ronyaet zygote. Pravilno dlya deb: setuid-sandbox VKLYUCHEN.
#
#  Skript: stavit setuid na chrome-sandbox i zapuskaet s
#  GITBOR_ENABLE_SANDBOX=1 (otkat forsa --no-sandbox).
#  Zapusk:  bash /media/sf_gitbor/vm-scripts/test-sandbox-fix.sh
# ============================================================

SANDBOX="/opt/GitBor/chrome-sandbox"

echo "==> Do fiksa:"
ls -la "$SANDBOX"

echo "==> Stavlyu setuid root (nuzhen sudo)"
sudo chown root:root "$SANDBOX"
sudo chmod 4755 "$SANDBOX"

echo "==> Posle fiksa (dolzhno byt -rwsr-xr-x):"
ls -la "$SANDBOX"

TMPD="$HOME/gitbor-tmp"
mkdir -p "$TMPD"; chmod 1777 "$TMPD" 2>/dev/null || true

echo ""
echo "==> Zapusk s VKLYUCHENNYM sandbox (GITBOR_ENABLE_SANDBOX=1)"
echo "    Esli okno otkrylos — eto i est fiks."
echo ""
TMPDIR="$TMPD" GITBOR_ENABLE_SANDBOX=1 gitbor --disable-gpu
