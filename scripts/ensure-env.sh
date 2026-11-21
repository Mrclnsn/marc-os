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
# Hermes (gesprek 12): eigen MCP-sleutel (schrijven alleen via de akkoordwachtrij) en sleutel voor zijn API
has HERMES_MCP_TOKEN || add HERMES_MCP_TOKEN "$(openssl rand -hex 32)"
has HERMES_API_KEY || add HERMES_API_KEY "$(openssl rand -hex 32)"
grep -q '^ANTHROPIC_API_KEY=' "$ENV" || printf '%s\n' "# Hermes: Anthropic API-sleutel en model. Installeren met scripts/hermes-setup.sh" "ANTHROPIC_API_KEY=" "HERMES_MODEL=claude-sonnet-5-5" "HERMES_URL=" >>"$ENV"
# WhatsApp via Hermes (gesprek 13): sleutels altijd klaarzetten, aanzetten met scripts/whatsapp-setup.sh
has HERMES_WEBHOOK_SECRET || add HERMES_WEBHOOK_SECRET "$(openssl rand -hex 32)"
has WHATSAPP_APPROVE_TOKEN || add WHATSAPP_APPROVE_TOKEN "$(openssl rand -hex 32)"
has STT_API_KEY || add STT_API_KEY "$(openssl rand -hex 24)"
grep -q '^HERMES_WHATSAPP=' "$ENV" || printf '%s\n' "# WhatsApp via Hermes: aanzetten met scripts/whatsapp-setup.sh" "HERMES_WHATSAPP=false" "WHATSAPP_NUMBER=" "WHATSAPP_HOME_CHANNEL=" >>"$ENV"
chmod 600 "$ENV"
