#!/usr/bin/env bash
# Vaste taken van Marc OS op de VPS. Wordt aangeroepen vanuit /etc/cron.d/marc-os (zie scripts/install-cron.sh).
#
#   bash scripts/cron.sh backup        versleutelde database-back-up (03:15), daarna controle en zo nodig melding
#   bash scripts/cron.sh second-brain  links, zoekindex en Obsidian-export bijwerken (03:45)
#   bash scripts/cron.sh morning       pushmelding ochtendoverzicht (werkdagen 07:30)
#   bash scripts/cron.sh deadlines     pushmelding deadlines (09:00)
#
# Logboek: /opt/marc-os/logs/cron.log. Mislukt de back-up of de export, dan volgt een systeemmelding op je telefoon.
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JOB="${1:-}"
cd "$DIR" || exit 1
mkdir -p logs backups obsidian
# .env niet "sourcen": agenda-links bevatten tekens als | en & die bash anders uitvoert
envget() { grep -E "^$1=" .env | tail -1 | cut -d= -f2-; }
MCP_TOKEN=$(envget MCP_TOKEN)
export BACKUP_PASSPHRASE="$(envget BACKUP_PASSPHRASE)"

log() { echo "$(date '+%F %T') [$JOB] $*" >>logs/cron.log; }

# Melding via de app (die kent de apparaten en sleutels). Faalt stil als de app niet draait.
notify() {
  docker compose exec -T app wget -qO- \
    --header "Authorization: Bearer $MCP_TOKEN" \
    --header "Content-Type: application/json" \
    --post-data "${2:-}" \
    "http://127.0.0.1:3000/api/notify/$1" 2>&1
}

fail() {
  log "MISLUKT: $1 ($2)"
  local payload
  payload=$(python3 -c 'import json,sys; print(json.dumps({"title": sys.argv[1], "body": sys.argv[2]}))' "$1" "$2")
  notify system "$payload" >/dev/null || log "Systeemmelding kon niet worden verstuurd (draait de app?)"
  exit 1
}

case "$JOB" in
  backup)
    [[ -n "${BACKUP_PASSPHRASE:-}" ]] || fail "Back-up mislukt" "BACKUP_PASSPHRASE ontbreekt in .env"
    day=$(date +%F)
    tmp="backups/.marcos-$day.tmp"
    out="backups/marcos-$day.sql.gz.enc"
    umask 022
    if ! docker compose exec -T db pg_dump -U marcos --no-owner marcos | gzip -9 |
      openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -salt -pass env:BACKUP_PASSPHRASE >"$tmp"; then
      rm -f "$tmp"
      fail "Back-up mislukt" "pg_dump of versleutelen ging fout, zie logs/cron.log op de VPS"
    fi
    # Controle: is het bestand te ontsleutelen en een echte dump?
    if ! openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -pass env:BACKUP_PASSPHRASE <"$tmp" | gunzip | head -c 4000 | grep -q "PostgreSQL database dump"; then
      rm -f "$tmp"
      fail "Back-up mislukt" "de versleutelde back-up was niet terug te lezen"
    fi
    mv "$tmp" "$out"
    chmod 644 "$out"
    # 30 dagen bewaren; ook oude onversleutelde dumps opruimen
    find backups -maxdepth 1 -name 'marcos-*.sql.gz*' -mtime +30 -delete
    find backups -maxdepth 1 -name 'marcos-*.sql.gz' -delete
    log "OK $out ($(du -h "$out" | cut -f1))"
    log "controle: $(notify backupcheck)"
    ;;

  second-brain)
    if out=$(docker compose run --rm -T -v "$DIR/obsidian:/export" migrate npx tsx scripts/second-brain.ts nightly /export 2>&1); then
      log "OK $(echo "$out" | tr '\n' ' ')"
    else
      log "$out"
      fail "Nachtelijke export mislukt" "Links, zoekindex of Obsidian-export ging fout, zie logs/cron.log op de VPS"
    fi
    ;;

  morning | deadlines)
    log "$(notify "$JOB")"
    ;;

  *)
    echo "Gebruik: bash scripts/cron.sh backup|second-brain|morning|deadlines" >&2
    exit 2
    ;;
esac
