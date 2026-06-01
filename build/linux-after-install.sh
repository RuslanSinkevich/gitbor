#!/bin/bash
# ============================================================
#  GitBor: postinst dlya deb/rpm (FPM --after-install)
#
#  KRITICHNO: chrome-sandbox dolzhen byt setuid-root. Na Ubuntu
#  24.04+/26.04 unprivileged user namespaces zablokirovany
#  AppArmor (kernel.apparmor_restrict_unprivileged_userns=1),
#  poetomu bez setuid-sandbox dochernie processy Chromium ne
#  spavnyatsya i prilozhenie padaet pri starte (ERR_FAILED).
#
#  Kastomnyy afterInstall zamenyaet defoltnyy skript electron-
#  builder, poetomu zdes zhe povtoryaem registraciyu desktop/mime.
# ============================================================

# Simlink na binar (kak v defoltnom postinst electron-builder)
ln -sf '/opt/GitBor/gitbor' '/usr/bin/gitbor' || true

# SUID chrome-sandbox (Electron 5+)
chmod 4755 '/opt/GitBor/chrome-sandbox' || true
chown root:root '/opt/GitBor/chrome-sandbox' || true

# Registraciya yarlyka i mime-tipov (kak v defoltnom postinst)
update-mime-database /usr/share/mime || true
update-desktop-database /usr/share/applications || true

exit 0
