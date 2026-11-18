#!/usr/bin/env bash
# Haalt de Obsidian-export op van Marc OS (VPS) en zet hem in een map op de Mac.
# Alleen de mappen van Marc OS worden vervangen; .obsidian en eigen mappen blijven staan.
#
# Eenmalig: de MCP-token (staat in /opt/marc-os/.env op de VPS) in een bestand dat alleen jij kunt lezen:
#   echo 'de-token' > ~/.marc-os-token && chmod 600 ~/.marc-os-token
# Draaien:
#   bash scripts/obsidian-mac.sh "$HOME/Obsidian/Marc OS"
# Elke ochtend om 07:05 (crontab -e):
#   5 7 * * * /bin/bash $HOME/marc-os/scripts/obsidian-mac.sh "$HOME/Obsidian/Marc OS" >/tmp/marc-os-obsidian.log 2>&1
set -euo pipefail
URL="${MARC_OS_URL:-https://os.marclonsain.nl}"
DEST="${1:?Geef de map op, bijv. \"$HOME/Obsidian/Marc OS\"}"
TOKEN="${MARC_OS_TOKEN:-$(cat "$HOME/.marc-os-token" 2>/dev/null || true)}"
[[ -n "$TOKEN" ]] || { echo "Geen token: zet hem in ~/.marc-os-token" >&2; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
curl -fsS -H "Authorization: Bearer $TOKEN" "$URL/api/export/obsidian" -o "$TMP/export.zip"
unzip -q "$TMP/export.zip" -d "$TMP"
mkdir -p "$DEST"
for d in Notities Bronnen Klanten Projecten Reviews; do
  mkdir -p "$TMP/Marc OS/$d" "$DEST/$d"
  rsync -a --delete --include='*.md' --exclude='*' "$TMP/Marc OS/$d/" "$DEST/$d/"
done
cp "$TMP/Marc OS/Marc OS.md" "$DEST/"
echo "Obsidian-export bijgewerkt in $DEST ($(date '+%d-%m %H:%M'))"
