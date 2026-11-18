#!/usr/bin/env bash
# Schrijft de configuratie van Hermes in hermes-data/ uit de bestanden in hermes/ (repo).
# Wordt gebruikt door hermes-setup.sh en update.sh. Draaien als root in /opt/marc-os.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA="$DIR/hermes-data"
ENV="$DIR/.env"
envget() { grep -E "^$1=" "$ENV" 2>/dev/null | tail -1 | cut -d= -f2- || true; }

MODEL="$(envget HERMES_MODEL)"
MODEL="${MODEL:-claude-sonnet-5-5}"
[[ "$MODEL" =~ ^[A-Za-z0-9._/:-]+$ ]] || { echo "HERMES_MODEL bevat ongeldige tekens: $MODEL" >&2; exit 1; }

mkdir -p "$DATA"
tmp="$(mktemp)"
sed "s|__HERMES_MODEL__|$MODEL|g" "$DIR/hermes/config.yaml.template" >"$tmp"
if [[ -f "$DATA/config.yaml" ]] && ! cmp -s "$tmp" "$DATA/config.yaml"; then
  cp "$DATA/config.yaml" "$DATA/config.yaml.vorige"
  echo "  Hermes: config.yaml bijgewerkt (vorige versie: hermes-data/config.yaml.vorige)"
fi
mv "$tmp" "$DATA/config.yaml"
cp "$DIR/hermes/SOUL.md" "$DATA/SOUL.md"

# Hermes draait als gebruiker hermes (UID 10000); de map bevat zijn geheugen en is alleen voor hem
chown -R 10000:10000 "$DATA"
chmod 700 "$DATA"
chmod 600 "$DATA/config.yaml" "$DATA/SOUL.md"
