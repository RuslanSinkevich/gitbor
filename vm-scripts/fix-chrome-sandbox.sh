#!/usr/bin/env bash
# ============================================================
#  GitBor: pochinit chrome-sandbox (setuid-root)
#
#  Bez etogo deb-ustanovka padaet pri starte:
#    FATAL: SUID sandbox helper ... not configured correctly
#    /opt/GitBor/chrome-sandbox must be owned by root, mode 4755
#
#  Zapusk:  bash /media/sf_gitbor/vm-scripts/fix-chrome-sandbox.sh
# ============================================================

set -e

SANDBOX=/opt/GitBor/chrome-sandbox

if [ ! -f "$SANDBOX" ]; then
  echo "OSHIBKA: net $SANDBOX"
  echo "  Deb ustanovlen?  bash /media/sf_gitbor/vm-scripts/install-deb.sh"
  exit 1
fi

echo "==> DO:"
ls -l "$SANDBOX"

echo "==> chown root:root + chmod 4755"
sudo chown root:root "$SANDBOX"
sudo chmod 4755 "$SANDBOX"

echo "==> POSLE:"
ls -l "$SANDBOX"

OWNER=$(stat -c '%U' "$SANDBOX")
PERM=$(stat -c '%a' "$SANDBOX")
if [ "$OWNER" != "root" ] || [ "$PERM" != "4755" ]; then
  echo "OSHIBKA: ozhidalos root/4755, poluchilos $OWNER/$PERM"
  exit 1
fi

echo ""
echo "GOTOVO. Zapusk: gitbor"
echo "  (v VM bez 3D: bash /media/sf_gitbor/vm-scripts/run-gitbor-vm.sh)"
