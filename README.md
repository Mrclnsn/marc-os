# Marc OS

Eén plek voor taken, projecten, klanten, notities en reviews, zakelijk en privé.
Met een MCP-koppeling, zodat een AI-assistent (Claude) je kan helpen met de dagplanning, ochtendbriefings, dagafsluitingen en het verwerken van je braindump.

## Wat zit erin

| Onderdeel | Wat het doet |
|---|---|
| **Vandaag** | Agenda, achterstallige taken, taken voor vandaag, komende 7 dagen en de briefing van vandaag. Filter op Zakelijk of Privé. |
| **Inbox** | Braindump. Snel iets vastleggen en later omzetten naar een taak of notitie. |
| **Taken** | Alle taken met filters: klantwerk, bedrijf algemeen, privé, per klant, zonder datum, afgerond. |
| **Projecten** | Gegroepeerd in Klanten, Bedrijf algemeen en Privé, met voortgang. |
| **Klanten** | Per klant een dossier: info, projecten, taken en notities. |
| **Notities** | Gespreksverslagen, besluiten, info en ideeën, te koppelen aan klant of project. |
| **Reviews** | Briefings, dagafsluitingen en weekreviews (geschreven door de AI-assistent). |

### Begrippen

- **Gebied**: `zakelijk` of `prive`. Zakelijk zonder klant is algemeen bedrijfswerk.
- **Plannen op** (`planDate`): wanneer je het wilt doen. **Deadline** (`dueDate`): wanneer het echt af moet.
- **Herhaling**: bij afronden van een terugkerende taak wordt automatisch de volgende aangemaakt.

## Lokaal ontwikkelen

Vereist: Node 22 en een Postgres-database.

```bash
npm install
cp .env.example .env.local      # vul DATABASE_URL, SESSION_SECRET, APP_PASSWORD_HASH, MCP_TOKEN in
npm run hash-password -- "jouw-wachtwoord"   # plak de uitkomst in APP_PASSWORD_HASH
npm run db:migrate
npm run seed                    # importeert scripts/notion-export.json (optioneel)
npm run dev
```

Schema aangepast in `src/db/schema.ts`? Draai `npm run db:generate` voor een nieuwe migratie.

## Op je VPS zetten

### Snelle route: installatiescript

Op een verse Ubuntu 24.04 VPS. Vanaf je eigen computer (in de map van deze repo):

```bash
scp scripts/setup-server.sh root@<IP-van-je-VPS>:
ssh root@<IP-van-je-VPS> "bash setup-server.sh"
```

Het script installeert Docker, zet de firewall dicht (alleen SSH, HTTP, HTTPS), maakt een deploy key aan die je op GitHub toevoegt, haalt de code op, vraagt je wachtwoord, genereert alle geheimen, start alles, importeert de Notion-data en zet een dagelijkse back-up klaar. Aan het eind toont het je MCP-URL.

Bijwerken na nieuwe code: `bash /opt/marc-os/scripts/update.sh`

### Handmatig

Vereist: een VPS met Docker en Docker Compose, en een (sub)domein met een A-record naar de VPS.

```bash
git clone https://github.com/Mrclnsn/marc-os.git
cd marc-os
cp .env.example .env
nano .env                       # vul alles in (zie hieronder)
docker compose up -d --build
```

Invullen in `.env`:

| Variabele | Hoe |
|---|---|
| `DOMAIN` | Bijvoorbeeld `os.marclonsain.nl`. Caddy haalt automatisch een HTTPS-certificaat. |
| `POSTGRES_PASSWORD` | `openssl rand -hex 24` |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `APP_PASSWORD_HASH` | Op je eigen computer: `npm run hash-password -- "wachtwoord"`, of op de VPS: `docker compose run --rm migrate npx tsx scripts/hash-password.ts "wachtwoord"` |
| `MCP_TOKEN` | `openssl rand -hex 32` |
| `CALENDAR_ICS_URLS` | Optioneel, zie Agenda |

Bij elke start draait eerst de `migrate`-container (database bijwerken), daarna start de app.

Notion-data importeren (eenmalig):

```bash
docker compose run --rm migrate npx tsx scripts/seed.ts
```

Bijwerken na nieuwe code:

```bash
git pull && docker compose up -d --build
```

### Back-ups

De database staat in een Docker-volume. Maak dagelijks een dump, bijvoorbeeld met cron op de VPS:

```bash
mkdir -p ~/marc-os/backups
# crontab -e
15 3 * * * cd ~/marc-os && docker compose exec -T db pg_dump -U marcos marcos | gzip > backups/marcos-$(date +\%F).sql.gz && find backups -name '*.sql.gz' -mtime +30 -delete
```

Zet die back-ups bij voorkeur ook ergens buiten de VPS neer.

### Beveiliging

- Login met één wachtwoord (scrypt-hash), sessie-cookie van 30 dagen (httpOnly, secure).
- De database is niet van buitenaf bereikbaar.
- De MCP-koppeling werkt alleen met het geheime `MCP_TOKEN`. Behandel de MCP-URL als een wachtwoord. Lekt hij uit, verander dan `MCP_TOKEN` en herstart (`docker compose up -d`).
- Caddy schrijft geen access-logs, zodat de geheime URL niet in logbestanden belandt.

## Agenda koppelen

Zet in `CALENDAR_ICS_URLS` één of meer ICS-links, komma-gescheiden, met optioneel een naam ervoor:

```
CALENDAR_ICS_URLS=Werk|https://calendar.google.com/calendar/ical/.../basic.ics,Privé|webcal://p01-caldav.icloud.com/...
```

- **Google Agenda**: Instellingen → je agenda → *Geheim adres in iCal-indeling*.
- **iCloud**: agenda delen → *Openbare agenda* → link kopiëren.

Afspraken worden 5 minuten gecachet. Alleen lezen, de app maakt geen afspraken aan.

## Koppelen aan Claude (MCP)

De app heeft een MCP-server op twee adressen:

- `https://<DOMAIN>/api/mcp/<MCP_TOKEN>`: voor clients die geen headers kunnen meesturen, zoals een custom connector in Claude.
- `https://<DOMAIN>/api/mcp` met header `Authorization: Bearer <MCP_TOKEN>`: voor clients die dat wel kunnen (bijv. Claude Code, eigen scripts).

In Claude: *Instellingen → Connectors → Custom connector toevoegen* en plak de eerste URL.

### Beschikbare tools

`get_overview` (alles voor een briefing), `list_tasks`, `create_task`, `update_task`, `complete_task`, `delete_task`, `completed_tasks`, `capture`, `inbox_to_task`, `list_notes`, `get_note`, `create_note`, `update_note`, `list_clients`, `get_client`, `create_client`, `update_client`, `list_projects`, `get_project`, `create_project`, `update_project`, `get_calendar`, `save_review`, `list_reviews`.

### Voorbeeld-opdrachten voor vaste taken

**Ochtendbriefing (werkdagen 07:30)**

> Gebruik Marc OS. Haal get_overview op. Schrijf een korte ochtendbriefing in het Nederlands: afspraken van vandaag, wat achterstallig is, de 1 tot 3 belangrijkste taken voor vandaag (rekening houdend met de vrije tijd tussen afspraken), en wat er in de inbox staat. Doe een voorstel voor de dagindeling. Sla de briefing op met save_review (kind=day).

**Dagafsluiting (werkdagen 17:30)**

> Gebruik Marc OS. Haal get_overview en completed_tasks voor vandaag op. Vat samen wat er gedaan is, wat is blijven liggen en verplaats onafgemaakte taken van vandaag naar morgen (update_task planDate). Zet de samenvatting onder de briefing van vandaag met save_review (kind=day, append=true).

**Weekreview (vrijdag 15:00)**

> Gebruik Marc OS. Haal completed_tasks voor deze week, list_projects en list_tasks (view=open) op. Maak een weekreview: wat is bereikt per klant en privé, welke projecten lopen achter, wat blijft structureel liggen, en een voorstel voor de focus van volgende week. Sla op met save_review (kind=week).

## Techniek

Next.js 16 (App Router, server actions), TypeScript, Tailwind 4, Postgres met Drizzle ORM, MCP via `@modelcontextprotocol/sdk` (stateless Streamable HTTP), node-ical voor agenda's. Draait als Docker-containers achter Caddy.

```
src/
  app/(app)/        pagina's (achter login)
  app/api/mcp/      MCP-endpoint
  app/actions.ts    server actions voor formulieren
  db/schema.ts      datamodel
  lib/data.ts       alle data-logica (gedeeld door app en MCP)
  lib/mcp.ts        MCP-tools
  lib/calendar.ts   ICS-agenda's
scripts/            migraties, import, wachtwoord-hash
drizzle/            SQL-migraties
```
