# Marc OS: projectcontext

*Stand van zaken: 17 november 2026, na gesprek 1 (klant uitgebreid, contactpersonen, websites)*

## Doel

Eén centraal systeem voor Marc (Marc Lonsain Consultancy) waarin alles samenkomt:

- **Taken en projecten**, zakelijk en privé. Zakelijk is gesplitst in werk voor opdrachtgevers en algemeen bedrijfswerk.
- **Eén dashboard** met alle taken van vandaag, zakelijk en privé door elkaar.
- **Klantdossiers**: per klant taken, projecten, notities en vaste informatie.
- **Braindump**: snel iets vastleggen en later verwerken.
- **Dagelijkse routine**: vaste momenten voor dagstart, dagafsluiting, weekreview en maandreview.
- **AI-assistent** (Claude) die meekijkt, plant en samenvat: ochtendbriefing, dagafsluiting, weekreview, braindump verwerken.

Uitgangspunt: Marc werkt vanaf december 2026 fulltime voor zijn eigen bedrijf. Het systeem moet hem helpen de balans te houden tussen werk, sport, ontspanning en een gezonde leefstijl.

## Gemaakte keuzes

| Onderwerp | Keuze | Waarom |
|---|---|---|
| Aanpak | Eigen applicatie, samen gebouwd met Claude | Volledige controle; Notion schoot tekort (geen echte centralisatie, takenlijsten niet op te vragen via de AI-koppeling zonder Business-abonnement) |
| Architectuur | Eigen datakern + bestaande AI (Claude) via MCP | Alleen bouwen wat uniek is; AI is later te vervangen door bijv. Hermes of een eigen agent |
| AI-opzet | Eén assistent met rollen, geen team van agents | Team van agents lost een probleem op dat er nog niet is; meer onderhoud en beveiligingsrisico |
| Hosting | Eigen VPS bij Hostinger | Controle over de data (klantdossiers, ISO 27001-traject) |
| Stack | Next.js 16 + TypeScript + Postgres (Drizzle) | Sluit aan op Marc's Node-ervaring |
| Geldzaken | Blijven in Moneybird | Geen dubbele administratie |
| Voeding | Blijft in Foodvisor | Niet nabouwen; koppeling later bekijken |
| Vormgeving | MLC-huisstijl | Nacht/Grafiet/Steen/Parel, Calibri, "een lijn, geen ruis" |
| Contactpersonen | Eigen tabel, meerdere per klant, precies één primair | Oude velden contactpersoon/e-mail/telefoon zijn bij de migratie omgezet naar de primaire contactpersoon en verwijderd |
| Websites | Eigen object per klant | Een klant kan meerdere sites hebben; hosting en beheer per site afgenomen ja/nee |
| Documenten | Alleen links (OneDrive, Drive, Moneybird) | Geen bestandsopslag op de VPS nodig; upload staat op "Later" |
| Adres | Gestructureerd: straat, postcode, plaats, land | Sluit aan op de Moneybird-contactvelden (gesprek 8) |
| Wachtwoorden | Nooit in het dossier, alleen een verwijzing (`vaultRef`) | Staan in de wachtwoordmanager |

## Huidige status

| Onderdeel | Status |
|---|---|
| Eerste versie app | Klaar en getest |
| MLC-huisstijl | Doorgevoerd |
| GitHub-repo | `Mrclnsn/marc-os` (private), Claude heeft push-toegang via de Claude GitHub-app |
| Lokaal draaien | Werkt met `npm run local` op Node 22 (getest 17 november, ook een verse installatie). Op de Mac zelf nog `node -v` controleren |
| Gesprek 1: klantdossier | Klaar (commit `4b4e09a`) |
| VPS | Besteld en draait, nog niet geïnstalleerd |
| Domein `os.marclonsain.nl` | Nog geen DNS-record |
| Verhuizing `marclonsain.nl` naar Hostinger | Besloten, nog niet gestart |
| MCP-koppeling in Claude | Nog niet (na installatie op VPS) |
| Vaste briefings | Nog niet ingepland |

## Infrastructuur

### VPS (Hostinger)

| | |
|---|---|
| Pakket | KVM 2: 2 vCPU, 8 GB RAM, 100 GB NVMe, 8 TB bandbreedte |
| Locatie | Düsseldorf, Duitsland |
| Besturingssysteem | Ubuntu 26.04 LTS |
| IP-adres | 179.67.202.123 |
| Hostnaam | srv2172019.hstgr.cloud |
| Inloggen | `ssh root@179.67.202.123` |
| Looptijd | Tot 17 november 2027 (verlenging daarna € 14,99/mnd) |
| Back-ups Hostinger | Wekelijks (standaard) |

### Domein en DNS

- `marclonsain.nl` staat nu op nameservers `ns.zxcs.nl`, `ns.zxcs.eu`, `ns.zxcs.be` (huidige provider, niet Hostinger).
- Nodig: A-record `os` → `179.67.202.123`.
- Bij Hostinger staan al: `svww.nl`, `aljasyogavooryou.nl` en extern `huurconsult.nl`.

### Plan domeinverhuizing

1. Huidige DNS-zone van marclonsain.nl veiligstellen (screenshot of export). Let op MX (mail), TXT (SPF, DKIM, DMARC), A/CNAME (website).
2. Verhuiscode (token) opvragen bij de huidige provider.
3. In hPanel: Domeinen → Een bestaand domein verhuizen. Marc rekent zelf af.
4. Alle records overnemen bij Hostinger en `os` → `179.67.202.123` toevoegen.

Open vraag: waar draaien de e-mail en website van marclonsain.nl nu? Die moeten blijven werken.

Tip: zet het `os`-record nu al bij de huidige provider, zodat de installatie niet hoeft te wachten op de verhuizing.

## De applicatie

### Functies

| Pagina | Inhoud |
|---|---|
| **Vandaag** | Begroeting, kerncijfers (vandaag, achterstallig, afspraken, inbox), braindump-balk, briefing van de AI, achterstallige taken, taken voor vandaag, komende 7 dagen, agenda. Filter: Alles / Zakelijk / Privé |
| **Inbox** | Braindump-items omzetten naar taak of notitie, of weggooien |
| **Taken** | Weergaven: alle open, vandaag, komende 14 dagen, zonder datum, afgerond. Filters: klantwerk, bedrijf algemeen, privé, per klant, zoeken |
| **Projecten** | Gegroepeerd in Klanten / Bedrijf algemeen / Privé, met voortgang |
| **Klanten** | Dossier per klant: gegevens (basis, registratie, adressen, facturatie, compliance, overig), contactpersonen, websites, documenten, vaste informatie, projecten, taken, notities. Lijst met filter op status en tag |
| **Websites** | Alle websites van alle klanten, filter op hosting/beheer afgenomen, bovenaan domeinen die binnen 30 dagen verlopen |
| **Notities** | Soorten: notitie, meeting, telefoon, e-mail, besluit, info, idee. Te koppelen aan klant, project, gebied |
| **Reviews** | Briefings, dagafsluitingen, weekreviews en maandreviews van de AI |

Verder: terugkerende taken (bij afronden wordt de volgende automatisch aangemaakt), agenda-koppeling via ICS (Google/iCloud, alleen lezen), installeerbaar als app op de telefoon, login met één wachtwoord.

### Datamodel

| Object | Belangrijkste velden |
|---|---|
| Klant (`clients`) | naam (bedrijf), rechtsvorm, status (lead/actief/on hold/oud-klant), klant sinds, bron, KvK, btw, adres/postcode/plaats/land, factuuradres (alleen als afwijkend), factuur-e-mail, betaaltermijn (dagen, standaard 14), Moneybird-contact-ID, verwerkersovereenkomst (n.v.t./nodig/verstuurd/getekend) + datum, verwerkte persoonsgegevens, verwijzing wachtwoordmanager, tags, info |
| Contactpersoon (`client_contacts`) | klant, naam, rol, e-mail, telefoon, primair ja/nee, notitie. Precies één primair per klant (wordt automatisch bewaakt) |
| Website (`websites`) | klant, domein (opgeschoond: zonder https/www/pad), registrar, verloopdatum domein, hostinglocatie, CMS, livegang, hosting afgenomen, beheer afgenomen, notities |
| Document (`client_documents`) | klant, soort (offerte/overeenkomst/verwerkersovereenkomst/overig), titel, link, datum, notitie |
| Project (`projects`) | naam, gebied, klant, status (idee/gepland/actief/wacht/afgerond/gearchiveerd), start, deadline, omschrijving |
| Taak (`tasks`) | titel, gebied, klant, project, status (te doen/bezig/wacht op/klaar), plannen op, deadline, prioriteit (1-3), inschatting, herhaling, notities |
| Notitie (`notes`) | titel, inhoud (markdown), soort (incl. `inbox`), gebied, klant, project, datum |
| Review (`reviews`) | soort (dag/week/maand), periode, tekst |

Begrippen:
- **Gebied**: `zakelijk` of `prive`. Zakelijk zonder klant = algemeen bedrijfswerk.
- **Plannen op** (`planDate`) = wanneer je het wilt doen. **Deadline** (`dueDate`) = wanneer het af moet.
- Een taak bij een project neemt automatisch klant en gebied van het project over.

### Techniek

- Next.js 16 (App Router, server actions; let op: `middleware` heet nu `proxy.ts`)
- TypeScript, Tailwind 4
- Postgres met Drizzle ORM; migraties in `drizzle/`
- MCP-server via `@modelcontextprotocol/sdk` (stateless Streamable HTTP)
- node-ical voor agenda's
- Lokaal: PGlite als aparte server (`pglite-server`), zodat er maar één proces de database open heeft
- Productie: Docker Compose met Postgres 17, de app en Caddy (automatische HTTPS)

### Mappenstructuur

```
src/app/(app)/        pagina's achter de login
src/app/api/mcp/      MCP-endpoint (/api/mcp en /api/mcp/<token>)
src/app/actions.ts    server actions voor formulieren
src/db/schema.ts      datamodel
src/db/connect.ts     databaseverbinding
src/lib/data.ts       alle data-logica (gedeeld door app en MCP)
src/lib/mcp.ts        MCP-tools
src/lib/calendar.ts   ICS-agenda's
src/components/       interface-onderdelen, incl. brand.tsx (beeldmerk, paginakop, sectiekop)
scripts/              setup-server.sh, update.sh, migrate, seed, local, hash-password
public/brand/         MLC-logo's (gecorrigeerd: stroke-linejoin round)
```

### Beveiliging

- Inloggen met één wachtwoord (scrypt-hash), sessiecookie 30 dagen (httpOnly, secure).
- Database niet van buitenaf bereikbaar; firewall alleen SSH, HTTP en HTTPS.
- MCP-koppeling alleen met geheim token (`MCP_TOKEN`). De MCP-URL is een wachtwoord. Bij uitlekken: token vervangen in `.env` en herstarten.
- Caddy schrijft geen access-logs (geheime URL komt niet in logbestanden).
- Dagelijkse database-back-up om 03:15, 30 dagen bewaard (`/opt/marc-os/backups`). Advies: ook buiten de VPS bewaren.
- Geheimen staan alleen in `.env` op de server (chmod 600), nooit in git.

## Installatie op de VPS

1. DNS-record `os` → `179.67.202.123` aanmaken.
2. Op de Mac:
   ```bash
   git clone https://github.com/Mrclnsn/marc-os.git && cd marc-os
   scp scripts/setup-server.sh root@179.67.202.123:
   ssh root@179.67.202.123
   bash setup-server.sh
   ```
3. Het script vraagt om:
   - een **deploy key** toe te voegen op GitHub (repo → Settings → Deploy keys, alleen lezen);
   - het **inlogwachtwoord** voor de app (minimaal 12 tekens);
   - eventueel **agenda-links** (kan later in `/opt/marc-os/.env`).
4. Het script doet de rest: systeemupdates, fail2ban, automatische beveiligingsupdates, Docker, firewall, code ophalen, `.env` met geheimen, starten, Notion-klanten importeren, dagelijkse back-up. Aan het eind toont het de MCP-URL.

Bijwerken na nieuwe code: `bash /opt/marc-os/scripts/update.sh`

Let op: het script is gecontroleerd op syntax, maar nog niet op een echte verse server gedraaid. Ubuntu 26.04 is nieuwer dan waarvoor het oorspronkelijk geschreven was; er is een terugval voor de Docker-installatie ingebouwd.

## Lokaal draaien (proefomgeving)

Vereist Node 22 (`node -v`). Marc's Mac had 20.16: updaten via Homebrew, nvm of conda.

```bash
cd marc-os
git pull
rm -rf .local-db .local-seeded node_modules   # oude, beschadigde testdatabase weg
npm install
npm run local
```

Open http://localhost:3000, wachtwoord `marc-os`. Data staat in `.local-pg`. Stoppen met Ctrl+C. Lokale data gaat niet mee naar de VPS.

## Koppeling met Claude (MCP)

Na installatie: in Claude → Instellingen → Connectors → Custom connector, met URL `https://os.marclonsain.nl/api/mcp/<MCP_TOKEN>`.

Beschikbare tools: `get_overview` (inclusief domeinen die binnen 30 dagen verlopen), `list_tasks`, `create_task`, `update_task`, `complete_task`, `delete_task`, `completed_tasks`, `capture`, `inbox_to_task`, `list_notes`, `get_note`, `create_note`, `update_note`, `list_clients` (filter op status en tag), `get_client` (volledig dossier), `create_client` (met optioneel primaire contactpersoon), `update_client`, `add_contact`, `update_contact`, `delete_contact`, `list_websites` (met `expiringWithinDays`), `add_website`, `update_website`, `delete_website`, `add_document`, `delete_document`, `list_projects`, `get_project`, `create_project`, `update_project`, `get_calendar`, `save_review` (met `append` om onder een bestaande review toe te voegen), `list_reviews`.

### Vaste taken om in te plannen

**Ochtendbriefing** (werkdagen 07:30)
> Gebruik Marc OS. Haal get_overview op. Schrijf een korte ochtendbriefing: afspraken van vandaag, wat achterstallig is, de 1 tot 3 belangrijkste taken (rekening houdend met de vrije tijd tussen afspraken) en wat er in de inbox staat. Doe een voorstel voor de dagindeling. Sla op met save_review (kind=day).

**Dagafsluiting** (werkdagen 17:30)
> Gebruik Marc OS. Haal get_overview en completed_tasks voor vandaag op. Vat samen wat gedaan is en wat is blijven liggen. Verplaats onafgemaakte taken van vandaag naar morgen. Sla op met save_review (kind=day, append=true).

**Weekreview** (vrijdag 15:00)
> Gebruik Marc OS. Haal completed_tasks voor deze week, list_projects en list_tasks (view=open) op. Maak een weekreview: wat is bereikt per klant en privé, welke projecten lopen achter, wat blijft structureel liggen, en een voorstel voor de focus van volgende week. Sla op met save_review (kind=week).

## Routine (advies)

| Moment | Wat |
|---|---|
| Dagstart (10 min) | 1 tot 3 kerntaken kiezen |
| Dagafsluiting (10 min) | Losse eindjes noteren, morgen klaarzetten |
| Weekreview (30 tot 45 min, vrijdag) | Alle klanten en projecten langs, volgende week plannen, uren en openstaande facturen checken |
| Maandelijks | Facturen versturen, administratie bijwerken, cashflow bekijken |
| Per kwartaal | Btw-aangifte, terugkijken op omzet en doelen |
| Jaarlijks | IB-aangifte, tarieven herzien, jaarplan |

Verder: een **ideale week** in de agenda met vaste blokken voor dagstart, diep werk, administratie, sport, pauzes en een vast eindtijdstip. Sport plannen als afspraak, niet als taak. Gewoontetracker eventueel later, en dan eenvoudig.

## Klanten (geïmporteerd uit Notion)

| Bedrijf | Contactpersoon |
|---|---|
| Vobis | Robin Eefting |
| Huurconsult | Merel Bruntink |
| Aljasyogaforyou | Alja |
| SVWW | Diana Ipema |
| JS Interieurwerken | Jeffrey Strijk |
| NK Technical Services | Nick Kremer |

Plus één taak: "Handleiding webbeheer" (SVWW). De Notion-workspace "Freelance Business OS" blijft bestaan als archief.

## Openstaande punten

### Nu
- [ ] Op de Mac `node -v` controleren (moet 22 of hoger zijn), dan `npm run local` en het klantdossier invullen
- [ ] DNS-record `os.marclonsain.nl` → `179.67.202.123`
- [ ] Installatiescript draaien op de VPS
- [ ] MCP-koppeling toevoegen in Claude
- [ ] Ochtendbriefing, dagafsluiting en weekreview inplannen als vaste taken
- [ ] Agenda-links (ICS) toevoegen
- [ ] Ideale week in de agenda zetten

### Domein
- [ ] DNS-zone van marclonsain.nl veiligstellen
- [ ] Uitzoeken waar mail en website nu draaien
- [ ] Verhuiscode opvragen en verhuizing starten bij Hostinger

### Later / ideeën
- [ ] Gezondheidsdata: sport (Apple Health, Strava of Garmin) en voeding (Foodvisor: koppeling uitzoeken; anders iOS-shortcut die dagelijks een samenvatting doorstuurt)
- [ ] Moneybird-koppeling (facturen en uren uitlezen, heeft een API)
- [ ] Doelen per maand/kwartaal als eigen object in de app
- [ ] Gewoontetracker (eenvoudig)
- [ ] Snelle invoer op de telefoon verbeteren (bijv. via Telegram of spraak naar de AI)
- [ ] Extra gebieden (bijv. vereniging) als dat nodig blijkt
- [ ] Eventueel later: eigen agent (bijv. Hermes Agent van Nous Research) op dezelfde MCP-koppeling
