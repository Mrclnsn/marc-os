#!/usr/bin/env bash
# WhatsApp koppelen aan Hermes (gesprek 13). Draaien als root op de VPS, nadat Hermes draait (hermes-setup.sh):
#   bash /opt/marc-os/scripts/whatsapp-setup.sh
#
# Wat je nodig hebt:
#   - een APART nummer voor Hermes (bijv. een prepaid simkaart) met WhatsApp of WhatsApp Business op een telefoon;
#     niet je eigen of zakelijke nummer, want de koppeling is onofficieel (WhatsApp Web) en kan worden geblokkeerd;
#   - je eigen mobiele nummer: alleen dat nummer mag met Hermes praten.
#
# Het script zet WhatsApp aan in .env, schrijft de configuratie van Hermes, start opnieuw, toont een QR-code
# om het Hermes-nummer te koppelen, controleert de verbinding en stuurt een testbericht. Mag vaker gedraaid worden
# (bijv. om opnieuw te koppelen als de verbinding verbroken is).
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
MCP_TOKEN="$(envget MCP_TOKEN)"
app_get() { docker compose exec -T app wget -qO- "$@" 2>/dev/null; }

[[ $EUID -eq 0 ]] || { echo "Draai dit als root" >&2; exit 1; }
[[ -f "$ENV" ]] || { echo "$ENV ontbreekt: is Marc OS geïnstalleerd?" >&2; exit 1; }
grep -qE '^COMPOSE_PROFILES=.*hermes' "$ENV" || { echo "Hermes staat nog niet aan. Draai eerst: bash $DIR/scripts/hermes-setup.sh" >&2; exit 1; }

bold "1/5 Nummers"
echo "  Hermes krijgt een eigen WhatsApp-nummer (apart, bijv. prepaid). Jij appt met dat nummer."
echo "  Alleen jouw eigen nummer mag met Hermes praten; berichten van anderen worden genegeerd."
current="$(envget WHATSAPP_NUMBER)"
while true; do
  read -rp "  Jouw eigen mobiele nummer (bijv. 0612345678 of +31612345678)${current:+ [$current]}: " n
  n="${n:-$current}"
  n="$(echo "$n" | tr -d ' +()-')"
  [[ "$n" =~ ^06[0-9]{8}$ ]] && n="31${n:1}"
  [[ "$n" =~ ^0031[0-9]{9}$ ]] && n="${n:2}"
  [[ "$n" =~ ^[1-9][0-9]{9,14}$ ]] && break
  warn "Dat lijkt geen mobiel nummer. Met landcode, zonder +, bijv. 31612345678."
done
envset WHATSAPP_NUMBER "$n"
envset WHATSAPP_HOME_CHANNEL "$n@s.whatsapp.net"
bash scripts/ensure-env.sh >/dev/null
envset HERMES_WEBHOOK_URL http://hermes:8644
chmod 600 "$ENV"
ok "Jouw nummer: +$n (allowlist en bestemming van de routines)"

bold "2/5 Koppelen (QR-code)"
# Tijdens het koppelen draait de WhatsApp-koppeling van de gateway niet, zodat er maar één sessie tegelijk is
envset HERMES_WHATSAPP false
bash scripts/hermes-config.sh
docker compose up -d hermes >/dev/null
echo "  Pak de telefoon met het Hermes-nummer: WhatsApp → Instellingen → Gekoppelde apparaten → Apparaat koppelen."
echo "  Zo meteen verschijnt een QR-code. Scan die. Vraagt de wizard iets:"
echo "    modus: bot (eigen nummer)   ·   toegestane gebruikers: $n"
echo "  Staat de koppeling al en wil je niet opnieuw koppelen? Kies in de wizard om de sessie te houden."
echo "  Het venster moet minstens 60 tekens breed zijn, anders is de QR-code niet leesbaar."
read -rp "  Enter om de wizard te starten... " _
docker compose exec hermes hermes whatsapp || true
# Alleen doorgaan als er echt een gekoppelde sessie is; anders blijft WhatsApp uit
if ! docker compose exec -T hermes sh -c 'ls /opt/data/whatsapp/session/creds.json /opt/data/platforms/whatsapp/session/creds.json 2>/dev/null | grep -q .'; then
  warn "Niet gekoppeld (QR-code niet gescand). WhatsApp blijft uit; de routines gaan als pushmelding."
  echo "  Opnieuw proberen zodra je een nummer voor Hermes hebt: bash $DIR/scripts/whatsapp-setup.sh"
  exit 1
fi
ok "Gekoppeld"

bold "3/5 WhatsApp aanzetten en herstarten"
# Spraak omzetten op de VPS: faster-whisper zit niet standaard in de image en wordt daar niet vanzelf geïnstalleerd
echo "  Spraakherkenning installeren (eenmalig, kan een paar minuten duren)..."
if docker compose exec -T hermes hermes pm install --extra stt-whisper >/tmp/marcos-stt.log 2>&1; then
  ok "Spraakherkenning (faster-whisper) geïnstalleerd"
else
  warn "Spraakherkenning installeren mislukt (zie /tmp/marcos-stt.log). Tekstberichten werken wel."
fi
envset HERMES_WHATSAPP true
chmod 600 "$ENV"
bash scripts/hermes-config.sh
docker compose up -d app hermes
ok "Hermes en de app herstart met WhatsApp aan"

bold "4/5 Controle"
API_KEY="$(envget HERMES_API_KEY)"
state=""
for i in $(seq 1 30); do
  detail="$(app_get --header "Authorization: Bearer $API_KEY" http://hermes:8642/health/detailed || true)"
  state="$(echo "$detail" | python3 -c 'import json,sys
try:
    d=json.load(sys.stdin); print((d.get("platforms",{}).get("whatsapp",{}) or {}).get("state",""))
except Exception: print("")' 2>/dev/null || true)"
  [[ "$state" == "connected" ]] && break
  sleep 3
done
if [[ "$state" == "connected" ]]; then
  ok "WhatsApp verbonden"
else
  warn "WhatsApp is nog niet verbonden (status: ${state:-onbekend}). Logboek:"
  docker compose logs --tail 30 hermes | grep -i -E "whatsapp|bridge" || docker compose logs --tail 30 hermes
  echo "  Opnieuw koppelen: bash $DIR/scripts/whatsapp-setup.sh"
fi
webhook="$(app_get http://hermes:8644/health || true)"
echo "$webhook" | grep -q '"ok"' && ok "Webhook voor berichten van Marc OS draait (alleen intern)" || warn "Webhook reageert niet op http://hermes:8644/health"

bold "5/5 Testbericht"
res="$(docker compose exec -T app wget -qO- --header "Authorization: Bearer $MCP_TOKEN" --post-data '' http://127.0.0.1:3000/api/notify/whatsapp 2>&1 || true)"
if echo "$res" | grep -q '"ok":true'; then
  ok "Testbericht verstuurd naar +$n. Komt hij binnen, dan werkt het."
else
  warn "Testbericht niet verstuurd: $res"
fi

bold "Klaar"
echo "  Stuur Hermes een eerste bericht vanaf je eigen telefoon (bijv. \"hoi\"), dan kent hij het gesprek."
echo "  Braindump: typ of spreek in wat er in je hoofd zit; Hermes zet het in je inbox."
echo "  Voorstellen: antwoord ja, ja 12, ja alles, nee 12: reden, of pas aan 12: ..."
echo "  Routines (briefing, dagafsluiting, weekreview): instellen in de app op Hermes → Routines."
echo "  Spraak wordt op de VPS omgezet (geen externe dienst); het eerste spraakbericht duurt langer."
echo "  Let op (ISO 27001): zet WhatsApp (Meta) in het leveranciersregister. Berichten met Hermes gaan via WhatsApp."
