#!/usr/bin/env bash
# ============================================================
#  GitBor VM setup (Ubuntu v VirtualBox)
#  Zapusk v terminale Ubuntu:
#     bash /media/sf_gitbor/vm-scripts/vm-setup.sh
# ============================================================

echo "==> 1. Obnovlenie paketov"
sudo apt update

echo "==> 2. Guest Additions utility + bufer obmena (esli dostupny)"
sudo apt install -y virtualbox-guest-utils virtualbox-guest-x11 || \
  echo "   (propusk: paket nedostupen, Guest Additions uzhe stoyat s ISO)"

echo "==> 3. Dobavlyayu polzovatelya v gruppu vboxsf"
sudo usermod -aG vboxsf "$USER"

echo "==> 4. Instrumenty razrabotki"
sudo apt install -y git curl build-essential

echo "==> 5. Node.js 22 (LTS)"
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

echo "==> 6. Sistemnye biblioteki dlya Electron"
sudo apt install -y \
  libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 xdg-utils libgbm1

echo ""
echo "============================================================"
echo " Versii:"
git --version
node --version
npm --version
echo "============================================================"
echo ""
echo " GOTOVO. Teper perezagruzi VM:  sudo reboot"
echo "============================================================"
