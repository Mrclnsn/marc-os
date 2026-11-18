#!/usr/bin/env bash
# Zet de vaste taken van Marc OS in /etc/cron.d/marc-os. Draaien als root; veilig om opnieuw te draaien.
# Tijden zijn in de tijdzone van de server (setup-server.sh zet die op Europe/Amsterdam).
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cat >/etc/cron.d/marc-os <<CRON
# Marc OS: vaste taken (beheerd door scripts/install-cron.sh, niet met de hand aanpassen)
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
15 3 * * *   root bash $DIR/scripts/cron.sh backup
45 3 * * *   root bash $DIR/scripts/cron.sh second-brain
30 7 * * 1-5 root bash $DIR/scripts/cron.sh morning
0 9 * * *    root bash $DIR/scripts/cron.sh deadlines
*/5 * * * *  root bash $DIR/scripts/cron.sh blocks
1-59/5 * * * * root bash $DIR/scripts/cron.sh routines
CRON
chmod 644 /etc/cron.d/marc-os
# Oude losse cron-bestanden (vóór gesprek 7)
rm -f /etc/cron.d/marc-os-backup /etc/cron.d/marc-os-second-brain

# Logboek niet eindeloos laten groeien
cat >/etc/logrotate.d/marc-os <<ROT
$DIR/logs/*.log {
  monthly
  rotate 12
  compress
  missingok
  notifempty
}
ROT
echo "Vaste taken ingesteld: back-up 03:15, export 03:45, ochtendmelding 07:30 (werkdagen), deadlines 09:00, dagritme en routines van Hermes elke 5 minuten"
