#!/usr/bin/env bash
# Nieuwe versie ophalen en herstarten. Draaien als root op de VPS.
set -euo pipefail
cd /opt/marc-os
git pull --ff-only
docker compose up -d --build
docker image prune -f >/dev/null
echo "Bijgewerkt naar $(git log -1 --format='%h %s')"
