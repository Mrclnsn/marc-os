#!/bin/bash
# Dagelijkse taak op de Mac (via launchd, zie scripts/mac-install.sh):
#  1. haalt de nieuwste versleutelde database-back-up op van de VPS (back-up buiten de VPS);
#  2. werkt optioneel de Obsidian-map bij.
# Instellingen in ~/.marc-os.conf, token in ~/.marc-os-token. Logboek: ~/Library/Logs/marc-os.log
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ -f "$HOME/.marc-os.conf" ]] && . "$HOME/.marc-os.conf"
URL="${MARC_OS_URL:-https://os.marclonsain.nl}"
BACKUP_DIR="${MARC_OS_BACKUP_DIR:-$HOME/Backups/Marc OS}"
OBSIDIAN_DIR="${MARC_OS_OBSIDIAN_DIR:-}"
KEEP_DAYS="${MARC_OS_KEEP_DAYS:-90}"
TOKEN="$(cat "$HOME/.marc-os-token" 2>/dev/null || true)"

log() { echo "$(date '+%F %T') $*"; }
fail() {
  log "MISLUKT: $*"
  osascript -e "display notification \"$*\" with title \"Marc OS back-up\"" >/dev/null 2>&1 || true
  exit 1
}
[[ -n "$TOKEN" ]] || fail "Geen token in ~/.marc-os-token (draai scripts/mac-install.sh)"
mkdir -p "$BACKUP_DIR"

name=$(curl -fsS --retry 3 --retry-delay 20 -H "Authorization: Bearer $TOKEN" "$URL/api/export/backup?latest=1") || fail "VPS niet bereikbaar of geen back-up"
[[ "$name" =~ ^marcos-[0-9]{4}-[0-9]{2}-[0-9]{2}\.sql\.gz\.enc$ ]] || fail "Onverwachte naam: $name"

if [[ -f "$BACKUP_DIR/$name" ]]; then
  log "Back-up $name stond er al"
else
  tmp="$BACKUP_DIR/.download.tmp"
  curl -fsS --retry 3 --retry-delay 20 -H "Authorization: Bearer $TOKEN" "$URL/api/export/backup?file=$name" -o "$tmp" || { rm -f "$tmp"; fail "Download van $name mislukt"; }
  # Een met openssl versleuteld bestand begint met "Salted__"
  [[ "$(head -c 8 "$tmp")" == "Salted__" ]] || { rm -f "$tmp"; fail "$name is geen versleutelde back-up"; }
  mv "$tmp" "$BACKUP_DIR/$name"
  log "Back-up opgehaald: $name ($(du -h "$BACKUP_DIR/$name" | cut -f1))"
fi
find "$BACKUP_DIR" -maxdepth 1 -name 'marcos-*.sql.gz.enc' -mtime +"$KEEP_DAYS" -delete

if [[ -n "$OBSIDIAN_DIR" ]]; then
  MARC_OS_URL="$URL" MARC_OS_TOKEN="$TOKEN" bash "$HERE/obsidian-mac.sh" "$OBSIDIAN_DIR" || fail "Obsidian-export mislukt"
fi
