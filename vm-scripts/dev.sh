#!/usr/bin/env bash
# ============================================================
#  GitBor: zapusk dev-rezhima v Ubuntu
#  Zapusk:  bash ~/gitbor/vm-scripts/dev.sh
# ============================================================

cd "$HOME/gitbor" || exit 1

SANDBOX="$HOME/gitbor/node_modules/electron/dist/chrome-sandbox"
if [ -f "$SANDBOX" ]; then
  OWNER=$(stat -c '%U' "$SANDBOX")
  PERM=$(stat -c '%a' "$SANDBOX")
  if [ "$OWNER" != "root" ] || [ "$PERM" != "4755" ]; then
    echo "==> Nastraivayu chrome-sandbox (nuzhen sudo)"
    sudo chown root:root "$SANDBOX"
    sudo chmod 4755 "$SANDBOX"
  fi
fi

echo "==> Zapusk: npm run dev"
npm run dev
