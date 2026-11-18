#!/usr/bin/env bash
# Vult ontbrekende instellingen aan in /opt/marc-os/.env, zonder bestaande waarden te wijzigen.
# Wordt gebruikt door setup-server.sh en update.sh. Draaien als root.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV="$DIR/.env"
[[ -f "$ENV" ]] || { echo ".env ontbreekt in $DIR" >&2; exit 1; }

has() { grep -qE "^$1=.+" "$ENV"; }
add() {
  # Lege regel met dezelfde sleutel eerst weghalen, dan toevoegen
  sed -i "/^$1=\$/d" "$ENV"
  printf '%s=%s\n' "$1" "$2" >>"$ENV"
}

if ! has BACKUP_PASSPHRASE; then
  add BACKUP_PASSPHRASE "$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | cut -c1-40)"
  echo "NIEUW: back-upsleutel aangemaakt. Bewaar hem in je wachtwoordmanager:"
  echo "       $(grep '^BACKUP_PASSPHRASE=' "$ENV" | cut -d= -f2-)"
fi
grep -q '^EMBEDDING_PROVIDER=' "$ENV" || printf '%s\n' "# Semantisch zoeken (second brain): voyage of openai, met sleutel. Leeg = zoeken op trefwoord." "EMBEDDING_PROVIDER=" "EMBEDDING_API_KEY=" >>"$ENV"
grep -q '^APP_TIMEZONE=' "$ENV" || add APP_TIMEZONE Europe/Amsterdam
chmod 600 "$ENV"
