#!/usr/bin/env bash
# Hermes installeren of opnieuw instellen op de VPS (gesprek 12). Draaien als root:
#   bash /opt/marc-os/scripts/hermes-setup.sh
# Vraagt om een Anthropic API-sleutel, zet Hermes aan naast de app (alleen intern bereikbaar),
# controleert de verbinding met Marc OS en doet een korte test. Mag vaker gedraaid worden.
set -euo pipefail
DIR=/opt/marc-os
cd "$DIR"
ENV="$DIR/.env"

bold() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { printf "  \033[32m✓\033[0m %s\n" "$*"; }
warn() { printf "  \033[33m!\033[0m %s\n" "$*"; }
envget() { grep -E "^$1=" "$ENV" | tail -1 | cut -d= -f2- || true; }
envset() {
  sed -i "/^$1=/d" "$ENV"
  printf '%s=%s\n' "$1" "$2" >>"$ENV"
}

[[ $EUID -eq 0 ]] || { echo "Draai dit als root" >&2; exit 1; }
[[ -f "$ENV" ]] || { echo "$ENV ontbreekt: is Marc OS geïnstalleerd?" >&2; exit 1; }

bold "1/5 Sleutels"
bash scripts/ensure-env.sh
key="$(envget ANTHROPIC_API_KEY)"
if [[ -z "$key" ]]; then
  echo "  Hermes gebruikt Claude via de Anthropic API (betalen per gebruik)."
  echo "  Maak een sleutel op https://console.anthropic.com → API keys (bijv. \"Hermes Marc OS\")."
  while true; do
    read -rsp "  Anthropic API-sleutel (begint met sk-ant-): " key
    echo
    [[ "$key" =~ ^sk-ant-[A-Za-z0-9_-]{20,}$ ]] && break
    warn "Dat lijkt geen Anthropic-sleutel. Probeer opnieuw."
  done
  envset ANTHROPIC_API_KEY "$key"
  ok "Sleutel opgeslagen in .env"
else
  ok "Anthropic-sleutel staat al in .env"
fi
model="$(envget HERMES_MODEL)"
read -rp "  Model [${model:-claude-sonnet-5-5}]: " m
[[ -n "$m" ]] && envset HERMES_MODEL "$m"
[[ -z "$(envget HERMES_MODEL)" ]] && envset HERMES_MODEL claude-sonnet-5-5
envset HERMES_URL http://hermes:8642
profiles="$(envget COMPOSE_PROFILES)"
[[ ",$profiles," == *",hermes,"* ]] || envset COMPOSE_PROFILES "$(echo "${profiles:+$profiles,}hermes")"
chmod 600 "$ENV"
ok "Model $(envget HERMES_MODEL), Hermes staat aan (COMPOSE_PROFILES)"

bold "2/5 Configuratie"
bash scripts/hermes-config.sh
ok "hermes-data/config.yaml en SOUL.md geschreven"

bold "3/5 Hermes ophalen en starten"
docker compose pull hermes
docker compose up -d --build
ok "Containers gestart"

bold "4/5 Controle"
up=0
for i in $(seq 1 40); do
  if docker compose exec -T app wget -qO- http://hermes:8642/health >/dev/null 2>&1; then up=1; break; fi
  sleep 3
done
if [[ $up -ne 1 ]]; then
  warn "Hermes reageert niet na 2 minuten. Laatste regels van het logboek:"
  docker compose logs --tail 40 hermes
  exit 1
fi
ok "Hermes draait"
API_KEY="$(envget HERMES_API_KEY)"
toolsets="$(docker compose exec -T app wget -qO- --header "Authorization: Bearer $API_KEY" http://hermes:8642/v1/toolsets 2>/dev/null || true)"
if [[ -n "$toolsets" ]]; then
  # /v1/toolsets noemt alle ingebouwde toolsets met "enabled"; MCP-servers staan er niet in (die test stap 5)
  risky="$(echo "$toolsets" | python3 -c 'import json,sys
try:
    d=json.load(sys.stdin).get("data",[])
    print(" ".join(t["name"] for t in d if t.get("enabled") and t.get("name") in ("terminal","file","code_execution","browser","web")))
except Exception:
    print("?")' 2>/dev/null || echo "?")"
  if [[ -z "$risky" ]]; then ok "Geen terminal, bestanden, code of browser aan voor de API"
  elif [[ "$risky" == "?" ]]; then warn "Toolsets niet te lezen; controleer met: docker compose exec hermes hermes tools list"
  else warn "Deze toolsets staan aan voor de API: $risky. Controleer platform_toolsets in hermes/config.yaml.template."; fi
else
  warn "Toolsets niet op te vragen; sla over"
fi

bold "5/5 Test"
body='{"model":"hermes-agent","messages":[{"role":"user","content":"Test vanuit de installatie. Haal get_overview op en zeg in één zin hoeveel taken er vandaag staan. Doe geen voorstellen."}]}'
answer="$(docker compose exec -T app wget -qO- -T 180 --header "Authorization: Bearer $API_KEY" --header "Content-Type: application/json" --post-data "$body" http://hermes:8642/v1/chat/completions 2>&1 || true)"
if echo "$answer" | grep -q '"content"'; then
  ok "Hermes antwoordt:"
  echo "$answer" | sed -n 's/.*"content": *"\([^"]*\)".*/    \1/p' | head -3 || true
else
  warn "Geen antwoord op de test. Uitvoer:"
  echo "$answer" | head -5 || true
  echo "  Logboek: docker compose logs --tail 60 hermes"
fi

bold "Klaar"
echo "  Chat: open Marc OS → Hermes (of de ronde knop rechtsonder)."
echo "  Akkoordwachtrij: Hermes → Akkoord. Wat zonder akkoord mag: Instellingen → Hermes."
echo "  Vaste routines (briefing, dagafsluiting, weekreview): Hermes → Routines."
echo "  WhatsApp koppelen: bash $DIR/scripts/whatsapp-setup.sh (apart nummer voor Hermes nodig)."
echo "  Logboek Hermes:  docker compose logs -f hermes"
echo "  Let op (ISO 27001): zet Anthropic (Claude API) in het leveranciersregister; Hermes stuurt"
echo "  gegevens uit Marc OS (taken, notities, klantnamen) naar de API om te kunnen antwoorden."
