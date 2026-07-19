#!/bin/bash
# ============================================================
#  GitBor: postinst dlya deb/rpm (FPM --after-install)
#
#  KRITICHNO: chrome-sandbox dolzhen byt setuid-root. Na Ubuntu
#  24.04+/26.04 unprivileged user namespaces zablokirovany
#  AppArmor (kernel.apparmor_restrict_unprivileged_userns=1),
#  poetomu bez setuid-sandbox dochernie processy Chromium ne
#  spavnyatsya i prilozhenie padaet pri starte (SIGTRAP /
#  "SUID sandbox helper ... not configured correctly").
#
#  Kastomnyy afterInstall zamenyaet defoltnyy skript electron-
#  builder, poetomu zdes zhe povtoryaem registraciyu desktop/mime.
# ============================================================

SANDBOX='/opt/GitBor/chrome-sandbox'

# Simlink na binar (kak v defoltnom postinst electron-builder)
ln -sf '/opt/GitBor/gitbor' '/usr/bin/gitbor' || true

# SUID chrome-sandbox: SNAChALA chown, POTOM chmod.
# Obratnyy poryadok / `|| true` ran'she glotali sboi — poluchali
# ustanovku bez setuid i smert' pri starte.
if [ -f "$SANDBOX" ]; then
  chown root:root "$SANDBOX"
  chmod 4755 "$SANDBOX"
else
  echo "WARNING: $SANDBOX ne najden — setuid ne vystavlen" >&2
fi

# Registraciya yarlyka i mime-tipov (kak v defoltnom postinst)
update-mime-database /usr/share/mime || true
update-desktop-database /usr/share/applications || true

exit 0
