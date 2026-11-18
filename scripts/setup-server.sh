#!/usr/bin/env bash
# Marc OS: installatie op een verse Ubuntu 24.04 VPS.
# Bedoeld voor Ubuntu 24.04 en 26.04. Draaien als root:  bash setup-server.sh
# Veilig om opnieuw te draaien: bestaande sleutels, .env en data blijven staan.

set -euo pipefail

REPO_SSH="git@github-marc-os:Mrclnsn/marc-os.git"
DIR="/opt/marc-os"
KEY="/root/.ssh/marc_os_deploy"
DEFAULT_DOMAIN="os.marclonsain.nl"

bold() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { printf "  \033[32m✓\033[0m %s\n" "$*"; }
warn() { printf "  \033[33m!\033[0m %s\n" "$*"; }

if [[ $EUID -ne 0 ]]; then
  echo "Draai dit script als root (sudo -i)." >&2
  exit 1
fi

bold "1/8 Systeem bijwerken en basispakketten installeren"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq git ufw fail2ban unattended-upgrades python3 ca-certificates curl dnsutils openssl >/dev/null
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true
systemctl enable --now fail2ban >/dev/null 2>&1 || true
ok "Systeem bijgewerkt, automatische beveiligingsupdates en fail2ban aan"

bold "2/8 Docker installeren"
if ! command -v docker >/dev/null 2>&1; then
  # Officiële installatie; valt terug op de Ubuntu-pakketten als die versie (nog) niet wordt ondersteund
  curl -fsSL https://get.docker.com | sh >/dev/null 2>&1 || apt-get install -y -qq docker.io docker-compose-v2 >/dev/null
fi
docker compose version >/dev/null 2>&1 || apt-get install -y -qq docker-compose-v2 >/dev/null
systemctl enable --now docker >/dev/null
ok "Docker $(docker --version | awk '{print $3}' | tr -d ,)"

bold "3/8 Firewall"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null
ufw --force enable >/dev/null
ok "Alleen SSH, HTTP en HTTPS staan open"

bold "4/8 Deploy key voor GitHub"
mkdir -p /root/.ssh && chmod 700 /root/.ssh
if [[ ! -f "$KEY" ]]; then
  ssh-keygen -t ed25519 -N "" -C "marc-os-vps" -f "$KEY" >/dev/null
fi
if ! grep -q "Host github-marc-os" /root/.ssh/config 2>/dev/null; then
  cat >>/root/.ssh/config <<EOF

Host github-marc-os
  HostName github.com
  User git
  IdentityFile $KEY
  IdentitiesOnly yes
EOF
  chmod 600 /root/.ssh/config
fi
ssh-keyscan -t ed25519 github.com >>/root/.ssh/known_hosts 2>/dev/null
sort -u -o /root/.ssh/known_hosts /root/.ssh/known_hosts

github_ok() {
  local out
  out=$(ssh -o BatchMode=yes -T github-marc-os 2>&1 || true) # GitHub geeft altijd exit 1
  grep -q "successfully authenticated" <<<"$out"
}
until github_ok; do
  echo
  echo "  Voeg deze sleutel toe op GitHub:"
  echo "  github.com/Mrclnsn/marc-os → Settings → Deploy keys → Add deploy key"
  echo "  (titel: VPS, 'Allow write access' UIT laten)"
  echo
  cat "$KEY.pub"
  echo
  read -rp "  Druk op Enter zodra de sleutel is toegevoegd..." _
done
ok "Server heeft leestoegang tot de repo"

bold "5/8 Code ophalen"
if [[ -d "$DIR/.git" ]]; then
  git -C "$DIR" pull --ff-only
else
  git clone "$REPO_SSH" "$DIR"
fi
ok "Code staat in $DIR"

bold "6/8 Instellingen (.env)"
cd "$DIR"
if [[ -f .env ]]; then
  ok ".env bestaat al, wordt niet aangepast"
else
  read -rp "  Domein [$DEFAULT_DOMAIN]: " DOMAIN
  DOMAIN="${DOMAIN:-$DEFAULT_DOMAIN}"

  while true; do
    read -rsp "  Kies je inlogwachtwoord (min. 12 tekens): " PW1; echo
    read -rsp "  Nogmaals: " PW2; echo
    if [[ "$PW1" != "$PW2" ]]; then warn "Komt niet overeen, probeer opnieuw"; continue; fi
    if [[ ${#PW1} -lt 12 ]]; then warn "Te kort"; continue; fi
    break
  done
  # Zelfde formaat als src/lib/password.ts (scrypt N=16384 r=8 p=1, 64 bytes)
  HASH=$(PW="$PW1" python3 -c '
import hashlib, os
salt = os.urandom(16)
h = hashlib.scrypt(os.environ["PW"].encode(), salt=salt, n=16384, r=8, p=1, dklen=64)
print("scrypt:" + salt.hex() + ":" + h.hex())')
  unset PW1 PW2

  echo "  Agenda-links (ICS) kun je later toevoegen in $DIR/.env. Nu overslaan met Enter."
  read -rp "  CALENDAR_ICS_URLS: " CAL

  umask 077
  cat >.env <<EOF
DOMAIN=$DOMAIN
POSTGRES_PASSWORD=$(openssl rand -hex 24)
SESSION_SECRET=$(openssl rand -hex 32)
APP_PASSWORD_HASH=$HASH
MCP_TOKEN=$(openssl rand -hex 32)
CALENDAR_ICS_URLS=$CAL
APP_TIMEZONE=Europe/Amsterdam
# Semantisch zoeken (second brain): voyage of openai, met sleutel. Leeg = zoeken op trefwoord.
EMBEDDING_PROVIDER=
EMBEDDING_API_KEY=
EOF
  chmod 600 .env
  ok ".env aangemaakt (alleen leesbaar voor root)"
fi
set -a; . ./.env; set +a

bold "7/8 DNS controleren"
SERVER_IP=$(curl -fsS4 https://ifconfig.me || true)
DNS_IP=$(dig +short A "$DOMAIN" | tail -1)
if [[ -n "$SERVER_IP" && "$SERVER_IP" == "$DNS_IP" ]]; then
  ok "$DOMAIN wijst naar deze server ($SERVER_IP)"
else
  warn "$DOMAIN wijst naar '${DNS_IP:-niets}', deze server is '$SERVER_IP'."
  warn "Maak een A-record 'os' → $SERVER_IP. Caddy probeert het certificaat later opnieuw."
fi

bold "8/8 Starten (eerste keer bouwen duurt een paar minuten)"
docker compose up -d --build
for i in $(seq 1 60); do
  if docker compose exec -T app wget -qO- http://127.0.0.1:3000/api/health 2>/dev/null | grep -q '"ok":true'; then
    ok "App draait"
    break
  fi
  sleep 3
  [[ $i -eq 60 ]] && warn "App reageert nog niet. Bekijk: docker compose logs app"
done

if [[ ! -f .seeded ]]; then
  docker compose run --rm migrate npx tsx scripts/seed.ts && touch .seeded
fi

# Dagelijkse back-up om 03:15, 30 dagen bewaren
mkdir -p "$DIR/backups"
cat >/etc/cron.d/marc-os-backup <<EOF
15 3 * * * root cd $DIR && docker compose exec -T db pg_dump -U marcos marcos | gzip > backups/marcos-\$(date +\%F).sql.gz && find backups -name '*.sql.gz' -mtime +30 -delete
EOF
ok "Dagelijkse back-up ingesteld ($DIR/backups)"

# Second brain: elke nacht om 03:45 links en zoekindex bijwerken en de Obsidian-export schrijven
mkdir -p "$DIR/obsidian"
cat >/etc/cron.d/marc-os-second-brain <<EOF
45 3 * * * root cd $DIR && docker compose run --rm -T -v $DIR/obsidian:/export migrate npx tsx scripts/second-brain.ts nightly /export >> $DIR/backups/second-brain.log 2>&1
EOF
ok "Nachtelijke Obsidian-export ingesteld ($DIR/obsidian)"

bold "Klaar"
echo "  App:       https://$DOMAIN"
echo "  MCP-URL:   https://$DOMAIN/api/mcp/$MCP_TOKEN"
echo "             (behandel deze URL als een wachtwoord)"
echo "  Bijwerken: bash $DIR/scripts/update.sh"
