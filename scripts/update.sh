#!/usr/bin/env bash
# Marc OS bijwerken naar de nieuwste versie. Draaien als root op de VPS:
#   bash /opt/marc-os/scripts/update.sh
# Maakt eerst een back-up, haalt de code op, vult .env aan, zet de vaste taken goed,
# bouwt en herstart (migraties draaien vanzelf) en controleert of de app reageert.
set -euo pipefail
DIR=/opt/marc-os
cd "$DIR"

bold() { printf "\n\033[1m%s\033[0m\n" "$*"; }
before=$(git rev-parse --short HEAD)

bold "1/5 Code ophalen"
git pull --ff-only
after=$(git rev-parse --short HEAD)
[[ "$before" == "$after" ]] && echo "  Geen nieuwe code ($after); wordt toch opnieuw gestart." || git log --oneline "$before..$after" | sed 's/^/  /'

bold "2/5 Instellingen en vaste taken"
bash scripts/ensure-env.sh
bash scripts/install-cron.sh
if grep -qE '^COMPOSE_PROFILES=.*hermes' .env; then
  bash scripts/hermes-config.sh
  docker compose pull -q hermes || echo "  Hermes: nieuwe versie ophalen mislukt, de huidige blijft draaien"
fi

bold "3/5 Back-up vooraf"
if docker compose ps --status running --services | grep -qx db; then
  bash scripts/cron.sh backup && echo "  Back-up gemaakt: $(ls -t backups/marcos-*.sql.gz.enc | head -1)" || { echo "  Back-up mislukt, update gestopt. Zie logs/cron.log" >&2; exit 1; }
else
  echo "  Database draait niet, back-up overgeslagen"
fi

bold "4/5 Bouwen en herstarten (migraties draaien vanzelf)"
docker compose up -d --build --remove-orphans

bold "5/5 Controle"
for i in $(seq 1 60); do
  if docker compose exec -T app wget -qO- http://127.0.0.1:3000/api/health 2>/dev/null | grep -q '"ok":true'; then
    docker image prune -f >/dev/null
    echo "  App draait. Bijgewerkt naar $(git log -1 --format='%h %s')"
    exit 0
  fi
  sleep 3
done
echo "  App reageert niet na 3 minuten. Laatste regels van het logboek:" >&2
docker compose logs --tail 40 app migrate >&2
echo "  Terug naar de vorige versie: git checkout $before && docker compose up -d --build" >&2
exit 1
