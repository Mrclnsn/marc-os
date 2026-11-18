#!/usr/bin/env bash
# Een versleutelde back-up terugzetten op de VPS. Draaien als root:
#   bash /opt/marc-os/scripts/restore.sh backups/marcos-2026-11-18.sql.gz.enc
# Een back-up van je Mac eerst naar de VPS kopiëren:
#   scp "~/Backups/Marc OS/marcos-2026-11-18.sql.gz.enc" root@179.67.202.123:/opt/marc-os/backups/
# De sleutel (BACKUP_PASSPHRASE) staat in /opt/marc-os/.env en in je wachtwoordmanager.
# Bij een nieuwe server: eerst setup-server.sh, dan BACKUP_PASSPHRASE in .env zetten, dan dit script.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"
FILE="${1:?Geef het back-upbestand op, bijv. backups/marcos-2026-11-18.sql.gz.enc}"
[[ -f "$FILE" ]] || { echo "Bestand niet gevonden: $FILE" >&2; exit 1; }
envget() { grep -E "^$1=" .env | tail -1 | cut -d= -f2-; }
export BACKUP_PASSPHRASE="${BACKUP_PASSPHRASE:-$(envget BACKUP_PASSPHRASE)}"
if [[ -z "${BACKUP_PASSPHRASE:-}" ]]; then
  read -rsp "Back-upsleutel (uit je wachtwoordmanager): " BACKUP_PASSPHRASE; echo
  export BACKUP_PASSPHRASE
fi

echo "Controleren of de back-up te ontsleutelen is..."
# Eerst het hele bestand (ontsleutelen en uitpakken), dan het begin; niet in één pijplijn met head (pipefail + SIGPIPE)
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -pass env:BACKUP_PASSPHRASE <"$FILE" | gunzip -t 2>/dev/null \
  || { echo "Niet te ontsleutelen: verkeerde sleutel of beschadigd bestand." >&2; exit 1; }
header=$(set +o pipefail; openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -pass env:BACKUP_PASSPHRASE <"$FILE" 2>/dev/null | gunzip 2>/dev/null | head -c 4000)
grep -q "PostgreSQL database dump" <<<"$header" || { echo "Dit bestand is geen PostgreSQL-dump." >&2; exit 1; }

echo
echo "Dit VERVANGT alle gegevens in Marc OS door de back-up $FILE."
read -rp "Typ HERSTEL om door te gaan: " ok
[[ "$ok" == "HERSTEL" ]] || { echo "Afgebroken."; exit 1; }

SAFE="backups/voor-herstel-$(date +%F-%H%M).sql.gz.enc"
echo "Eerst een veiligheidskopie van de huidige stand naar $SAFE..."
docker compose exec -T db pg_dump -U marcos --no-owner marcos | gzip -9 |
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -salt -pass env:BACKUP_PASSPHRASE >"$SAFE"

docker compose stop app
docker compose exec -T db psql -q -U marcos -d marcos -c "drop schema public cascade; drop schema if exists drizzle cascade; create schema public;"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -pass env:BACKUP_PASSPHRASE <"$FILE" | gunzip | docker compose exec -T db psql -q -v ON_ERROR_STOP=1 -U marcos -d marcos >/dev/null
docker compose up -d
echo "Teruggezet. Open de app en controleer of alles klopt."
