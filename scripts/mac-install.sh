#!/bin/bash
# Eenmalig op de Mac:  bash scripts/mac-install.sh   (in de map marc-os)
# Zet een dagelijkse taak (07:15, of zodra de Mac daarna wakker wordt) die de versleutelde back-up
# van de VPS ophaalt en optioneel de Obsidian-map bijwerkt. Opnieuw draaien past de instellingen aan.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LABEL="nl.marclonsain.marc-os"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
CONF="$HOME/.marc-os.conf"
[[ -f "$CONF" ]] && . "$CONF"

echo "Marc OS op de Mac: dagelijkse back-up en Obsidian-export"
echo
if [[ ! -s "$HOME/.marc-os-token" ]]; then
  echo "De MCP-token staat op de VPS in /opt/marc-os/.env (MCP_TOKEN=...),"
  echo "of in Marc OS onder Instellingen → Koppeling met Claude (het laatste deel van de URL)."
  read -rsp "Plak de token: " TOKEN; echo
  [[ ${#TOKEN} -ge 24 ]] || { echo "Dat lijkt geen token." >&2; exit 1; }
  (umask 077; printf '%s\n' "$TOKEN" >"$HOME/.marc-os-token")
  echo "Token bewaard in ~/.marc-os-token (alleen voor jou leesbaar)"
fi

def_backup="${MARC_OS_BACKUP_DIR:-$HOME/Backups/Marc OS}"
read -rp "Map voor de back-ups [$def_backup]: " b
b="${b:-$def_backup}"
def_obs="${MARC_OS_OBSIDIAN_DIR:-}"
read -rp "Obsidian-map (leeg = geen export naar de Mac) [$def_obs]: " o
o="${o:-$def_obs}"
o="${o/#\~/$HOME}"; b="${b/#\~/$HOME}"

cat >"$CONF" <<C
# Instellingen voor scripts/mac-daily.sh
MARC_OS_URL="${MARC_OS_URL:-https://os.marclonsain.nl}"
MARC_OS_BACKUP_DIR="$b"
MARC_OS_OBSIDIAN_DIR="$o"
MARC_OS_KEEP_DAYS=${MARC_OS_KEEP_DAYS:-90}
C

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs" "$b"
cat >"$PLIST" <<P
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$HERE/mac-daily.sh</string></array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>7</integer><key>Minute</key><integer>15</integer></dict>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/marc-os.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/marc-os.log</string>
</dict>
</plist>
P
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
rm -f /tmp/marc-os-obsidian.log

echo
echo "Ingesteld: elke dag om 07:15 (of zodra de Mac daarna wakker wordt)."
echo "Nu één keer draaien..."
bash "$HERE/mac-daily.sh" && echo "Gelukt. Logboek: ~/Library/Logs/marc-os.log"
echo
echo "Let op: staat de Obsidian-map in Documenten, Bureaublad of iCloud Drive, geef dan /bin/bash"
echo "toegang tot schijf (Systeeminstellingen → Privacy en beveiliging → Volledige schijftoegang)."
echo "Stond er een oude crontab-regel voor obsidian-mac.sh? Haal die weg met: crontab -e"
