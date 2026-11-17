# Marc OS: projectcontext

*Stand van zaken: 17 november 2026, na gesprek 6 (cockpit en modules aan/uit)*

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
| Bedragen | In centen (integer), altijd exclusief btw | Geen afrondingsfouten; btw regelt Moneybird |
| MRR | Som van lopende vaste afspraken (actief, of opgezegd tot de einddatum), omgerekend naar per maand (kwartaal / 3, jaar / 12). Eenmalig en uurtarief tellen niet mee | Zuivere maatstaf voor vaste maandomzet |
| Verwachte omzet | Per maand wat er gefactureerd wordt: maandafspraken elke maand, kwartaalafspraken in jan/apr/jul/okt, jaarafspraken in de startmaand (anders januari), plus termijnen met een datum | Kasstroombeeld; MRR is het gladde beeld |
| Termijnen voor vaste afspraken | Niet als termijnen aangemaakt; die lopen straks via terugkerende facturen in Moneybird (gesprek 8) | Geen dubbele administratie |
| Eenmalig werk | Website: 2 termijnen van 50% (bij akkoord, bij oplevering) en automatisch een websiteproject. Overig eenmalig: 1 termijn bij oplevering | Volgens ontwerp; overig eenmalig is zelf te splitsen |
| Oplevering | Project op "afgerond" of knop "Opgeleverd" bij de afspraak zet termijnen "bij oplevering" op klaar om te factureren | Eén handeling, geen dubbel werk |
| Opzeggen | Zonder einddatum: einde van de maand na de opzegtermijn. Na de einddatum wordt de afspraak automatisch beëindigd | Opgezegd telt mee in de MRR tot de einddatum |
| Hosting/beheer bij website | Volgt automatisch uit de afspraken als er voor die website een hosting- of beheerafspraak bestaat | Eén bron van waarheid |
| Indexatie | Alleen vastgelegd (percentage), nog niet automatisch toegepast | Zie Later |
| Uren: wat | Alles mag uren krijgen: klantwerk, bedrijf algemeen, privé en leren. Gebied zakelijk/privé plus een vrije "soort werk" (Klantwerk, Administratie, Acquisitie, Leren...) | Doelen als "5 uur leren per week" worden meetbaar (gesprek 12/13) |
| Uren: invoer | Timer (start/stop, ook vanuit een taak of project) of handmatig: duur ("1:30", "1,5", "90m", "2u") of begin- en eindtijd. Er loopt hooguit één timer; een nieuwe stopt de vorige. Duur in hele minuten, niet afgerond | Snel en eerlijk; afronden kan later per afspraak als dat nodig blijkt |
| Uren: koppelingen | Taak → project, klant en gebied; project → klant. Afspraak automatisch: de uurtarief-afspraak van het project, anders de enige lopende uurtarief-afspraak van de klant | Zo min mogelijk invullen |
| Declarabel | Standaard ja als de uren onder een afspraak met uurtarief vallen, anders nee. Per registratie aan te passen | Uren voor vaste afspraken (boekhouding, beheer) zitten al in de prijs |
| Uren factureren | Knop "Klaarzetten voor factuur" maakt van alle open declarabele uren van een uurtarief-afspraak één termijn "klaar om te factureren" en markeert de uren als gefactureerd. Termijn verwijderen zet de uren weer open. Uren zonder uurtarief kun je handmatig als gefactureerd markeren | Factureren blijft via termijnen en straks Moneybird (gesprek 8) |
| Budget maatwerk | Besteed = declarabele uren x tarief, tegenover het budget van de afspraak. Signaal vanaf 80%, "overschreden" vanaf 100% | Volgens ontwerp |
| Leads | Eigen tabel, los van klanten. Een lead is een nieuw bedrijf (bedrijfsnaam, contactgegevens) of een kans bij een bestaande klant. Status nieuw / in gesprek / offerte verstuurd / gewonnen / verloren, met kans, geschatte waarde en volgende stap + datum | De klantenlijst blijft schoon; pas bij akkoord wordt een nieuw bedrijf klant. Bestaande klanten met status lead kregen bij de migratie een lead |
| Kans | Standaard per status (nieuw 20%, in gesprek 40%, offerte verstuurd 60%, gewonnen 100%, verloren 0%). Schuift mee met de status zolang je hem niet zelf aanpast | Gewogen pipeline zonder extra invullen |
| Waarde van een lead | Offerte met akkoord, anders verstuurd, anders concept; zonder lopende offerte de eigen schatting, anders de laatste offerte | Eén getal per lead |
| Offerte | Hoort altijd bij een lead. Nummer `OFF-jaar-volgnummer`, standaard 30 dagen geldig. Regels met dezelfde velden als een afspraak (soort, prijsvorm, bedrag, periode, budget, domein, start) | Akkoord kan zo één op één afspraken maken |
| Waarde offerte | Eenmalig + 12 x maandbedrag + budgetten van uurwerk = waarde eerste jaar. MRR apart getoond | Vergelijkbaar tussen eenmalig en terugkerend werk |
| Offertestatus | Verstuurd zet de lead op "offerte verstuurd". Verstuurd en voorbij "geldig tot" wordt automatisch verlopen. Opnieuw versturen na verlopen geeft weer 30 dagen | Minder handwerk |
| Akkoord (één klik) | Klant van de lead, of een bestaande klant met precies dezelfde naam, of een nieuwe klant (actief, klant sinds vandaag, bron en primaire contactpersoon uit de lead). Websites per domein (bestaande hergebruikt). Elke regel een actieve afspraak met startdatum (standaard vandaag, of de eigen start van de regel) en notitie "Uit offerte ...". Websiteproject en termijnen volgen uit de afspraken (eerste websitetermijn direct klaar om te factureren). Lead gewonnen, andere open offertes van die lead afgewezen, documentlink bij de klant | Volgens ontwerp; geen dubbele klanten of websites |
| Offerte na akkoord | Niet meer te wijzigen of te verwijderen; wijzigingen gaan via de afspraken. Wel te kopiëren als nieuwe offerte | De afspraken zijn de bron van waarheid |
| Effectief uurtarief | Omzet / alle zakelijke uren voor de klant in de periode (maand, kwartaal, jaar, 12 maanden). Omzet = vaste afspraken naar rato van de dagen + termijnen van eenmalig werk (klaar of gefactureerd in de periode) + declarabele uren x tarief; uren-termijnen tellen niet dubbel. De periode begint nooit vóór de eerste geschreven uren | Anders staat er maanden omzet tegenover nul uren |
| Aangiftecyclus: opzet | Per klant een of meer **instellingen** (soort, frequentie, uitstel, vanaf/tot, stukken-termijn, taken ja/nee, actief). Daaruit ontstaat per periode automatisch een **aangifte-item**. Soorten: btw, IB, Vpb, ICP-opgaaf, loonheffingen, overig (eigen naam). IB en Vpb altijd per jaar | Flexibel genoeg voor maand-, kwartaal- en jaaraangiftes en extra aangiftes, zonder dubbel werk |
| Aangifte-items: wanneer | Voor elke periode die begonnen is (de lopende periode staat er dus al, als "periode loopt"), vanaf de startdatum tot de einddatum van de instelling of van de gekoppelde afspraak. Een instelling bij een afspraak in concept doet nog niets. Gebeurt automatisch bij elk overzicht | Je ziet de komende deadline al, en na akkoord op een offerte start de cyclus vanzelf |
| Standaard bij boekhouding | Nieuwe boekhoudafspraak (ook via een offerte) krijgt btw per kwartaal plus IB (eenmanszaak, vof, maatschap of onbekend) of Vpb (bv, nv), vanaf de huidige periode of de latere startdatum. Alleen als de klant nog geen instellingen heeft. Migratie 0006 deed dit eenmalig voor bestaande lopende boekhoudafspraken | Oudere perioden die nog open staan voeg je toe door "vanaf" eerder te zetten |
| Deadlines | Btw/ICP/loonheffingen per maand of kwartaal: laatste dag van de maand erna. Btw per jaar: 31 maart. IB: 30 april; met uitstel 31 augustus; met becon-uitstel 30 april van het jaar daarna. Vpb: 31 mei; met uitstel 31 oktober; becon 30 april van het jaar daarna. Per item met de hand aan te passen; die blijft dan staan | Wettelijke termijnen (Belastingdienst, gecontroleerd november 2026) |
| Stukken | Standaard binnen 10 dagen na de periode (jaar: 59 dagen, eind februari), per instelling aan te passen. "Stukken opgevraagd" zet te doen op wacht op stukken; "stukken binnen" zet hem terug op te doen | Signaal "stukken ontbreken" als de datum voorbij is |
| Statussen | Te doen / wacht op stukken / in behandeling / klaar voor controle / ingediend / afgerond (betaald of ontvangen). Ingediend en afgerond vullen hun datum met vandaag. Uitkomst als bedrag (te betalen of terug) en kenmerk | Volgens ontwerp |
| Taken | Na afloop van de periode één taak per aangifte (deadline = aangiftedeadline, plannen op = stukken-datum als die nog komt). Taak afronden zet de aangifte op ingediend; aangifte ingediend of afgerond rondt de taak af; heropenen werkt beide kanten op. Een verwijderde taak komt niet terug | Aangiftes verschijnen vanzelf in Vandaag en de takenlijst |
| Signalen | Deadline binnen 14 dagen, te laat, stukken ontbreken. Op Vandaag, op de pagina Aangiftes en in get_overview | Volgens ontwerp |
| Instelling wijzigen | Andere soort of frequentie: items waar nog niets aan gedaan is worden opnieuw opgebouwd. Andere start/eind: zulke items buiten het bereik vervallen. Ander uitstel of stukken-termijn: deadlines en stukken-datums van open items schuiven mee. Verwijderen: items waar al aan gewerkt is blijven bewaard. Dezelfde soort twee keer bij één klant kan niet | Geen spookitems, geen verlies van werk |
| Modules aan/uit | Zes modules apart te schakelen op **Instellingen → Modules**: uitgebreid dossier, websites, afspraken en termijnen, uren, pipeline, aangiftes. Opgeslagen in de tabel `settings` (sleutel `modules`). Zonder opgeslagen waarde staan ze **uit** (MVP-stand). Uit = verbergen, niet verwijderen | MVP rustig houden; alles blijft bewaard en is per module terug te zetten |
| Wat "uit" doet | Weg uit navigatie (Mac en telefoon), Vandaag (KPI's en signalen), klantdossier, klantenlijst (tags, plaats, websites) en `get_overview`. MCP-tools van die module worden niet aangeboden en de MCP-instructies noemen welke modules uit staan. Direct adres naar een pagina (ook onderliggende) toont een melding met link naar Instellingen | Claude en straks Hermes werken niet met wat uit staat |
| Automatische processen | Aangiftes uit: geen nieuwe aangifte-items en taken (instellingen worden wel bewaard en bij een nieuwe boekhoudafspraak nog aangemaakt). Afspraken uit: geen websiteproject en termijnen bij een nieuwe afspraak, geen termijnen klaarzetten bij oplevering, geen automatisch beëindigen of termijnen op datum. Weer aan: alles wordt bij het eerstvolgende overzicht aangevuld (bij Aangiftes: items en taken voor alle intussen afgelopen perioden) | Volgens werkplan |
| Klant (basis) | Met het uitgebreide dossier uit: kop met contactpersoon en status, contactpersonen, vaste informatie (met formulier voor naam, status en vaste informatie), projecten, taken, notities. `get_client` geeft dan alleen naam, status, vaste informatie en de verwijzing naar de wachtwoordmanager | Volgens werkplan |
| Thema | Licht, donker of volg systeem; per apparaat in een cookie (`marc-os-thema`), zodat de kleuren direct goed staan. Wisselen via het knopje onder in de zijbalk of op Instellingen | Mac en telefoon kunnen elk hun eigen keuze hebben |
| Donkere modus | Kleuren als rollen (CSS-variabelen): `nacht` = sterkste tekst en lijnen, `vlak` = kaarten, `op-nacht` = tekst op een Nacht-vlak, `zijbalk`/`balk` blijven altijd donker. Donker: achtergrond Nacht, panelen Grafiet, tekst Parel en Steen | Dezelfde klassen werken in beide modi; geen dubbele opmaak |
| Cockpit: indeling | Naar de inspiratievideo (17 november, tweede ronde): kop met live klok, filter en stijlschakelaar; doelbalk; KPI-tegels; drie kolommen: links Hermes en agents (status per rol, vaste routines, akkoord nodig), midden briefing met bol, braindump, Focus (top 3 op prioriteit, achterstallig, deadline) en Verder vandaag, rechts de tijdlijn voor de komende 8 uur op een echte tijdas plus signalen. Onder 1360 px twee kolommen, op de telefoon onder elkaar. Gebruikt de volle breedte en ververst elke 5 minuten | Marc wilde de cockpit uit de video |
| Cockpit: stijl | Per apparaat te kiezen (cookie `marc-os-cockpit`): **Strak** (MLC, lijnen, beeldmerk in een ring) of **Iron Man** (HUD: donker, raster, koele gloed, hoekjes op panelen, technisch lettertype voor cijfers, ademende en draaiende Hermes-bol, scanlijn). Iron Man zet altijd donkere kleuren, ook bij een licht thema. Animaties staan uit als het systeem minder beweging vraagt | Marc wil beide kunnen gebruiken |
| Doelbalk tot gesprek 10 | Voorlopig doel: taken van vandaag afgerond (x van y) | Echte gegevens in plaats van een nepdoel |
| Briefing zonder Hermes | Als er vandaag geen briefing is opgeslagen, maakt de cockpit er zelf een uit taken, agenda, vrije tijd en signalen | Het middenpaneel is nooit leeg |
| Cockpit (eerste opzet, gesprek 6) | Vandaag in panelen met één korte accentlijn. KPI-tegels (vandaag, achterstallig, inbox, agenda; met modules aan ook uren, MRR, te factureren, openstaande offertes, aangiftes binnen 14 dagen), per tegel aan/uit op Instellingen (verborgen tegels worden opgeslagen, dus nieuwe tegels verschijnen vanzelf). Signalen in één blok, met voorrang bovenaan. Tijdlijn: hele-dag-items, agenda met "nu"-markering, nog vrij tot het einde van de werkdag, inschatting van de taken voor vandaag | Volgens ontwerp |
| Werkdag | Voorlopig vast 09:00 tot 17:30 (`WORKDAY` in `src/lib/cockpit.ts`), voor "nog vrij". Wordt in gesprek 8 vervangen door de dagritme-sjablonen | Eenvoudig tot het dagritme er is |
| Plekken voor later | `GoalBar` (gesprek 10), `HabitsPanel` (gesprek 8) en `HermesPanel` (nu de briefing; gesprek 12/13 akkoordwachtrij en routinestatus) in `src/components/cockpit.tsx`. Ze tonen niets zolang er geen gegevens zijn | Cockpit hoeft later niet om te bouwen |
| Stukken opvragen | Conceptmail in MLC-toon (je, voornaam, direct) per soort aangifte met een lijst van stukken, aan de primaire contactpersoon (anders het factuuradres). "Open in mail" opent hem in je mailprogramma; Marc verstuurt zelf. Later kan Hermes dezelfde tekst voorbereiden (draft_docs_reminder) | Alles wat de deur uitgaat, gaat via Marc |

## Huidige status

| Onderdeel | Status |
|---|---|
| Eerste versie app | Klaar en getest |
| MLC-huisstijl | Doorgevoerd |
| GitHub-repo | `Mrclnsn/marc-os` (private), Claude heeft push-toegang via de Claude GitHub-app |
| Lokaal draaien | Werkt met `npm run local` op Node 22 (getest 17 november, ook een verse installatie). Op de Mac zelf nog `node -v` controleren |
| Gesprek 1: klantdossier | Klaar (commit `4b4e09a`) |
| Gesprek 2: afspraken, termijnen, MRR | Klaar (commit `bea069c`) |
| Gesprek 3: urenregistratie | Klaar (commit `a4cf0b6`) |
| Gesprek 4: pipeline | Klaar (commit `d10ca90`) |
| Gesprek 5: aangiftecyclus | Klaar (commit `3cde210`) |
| Gesprek 6: cockpit en modules aan/uit | Klaar (commits `3992447` en `5dafb26`: cockpit naar de video met Strak/Iron Man). Geavanceerde modules staan standaard uit |
| Volgende gesprek | Second brain (gesprek 11, naar voren gehaald), daarna live op de VPS (gesprek 7) |
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
| **Vandaag** (cockpit) | Begroeting met datum en weeknummer, filter Alles / Zakelijk / Privé, plek voor de doelbalk, KPI-tegels, braindump-balk, briefing van de AI (Hermes-paneel), signalen in één blok (achterstallige taken, deadlines vandaag en morgen, agenda die niet laadt, volle inbox; met modules aan ook aangiftes, pipeline, offertes, te factureren, aflopende afspraken, budget maatwerk en domeinen), achterstallig, paneel Vandaag met tijdlijn (agenda, nu-markering, nog vrij, inschatting) en de taken voor vandaag, komende 7 dagen. Op de telefoon staan de signalen boven de taken |
| **Instellingen** | Thema (systeem/licht/donker), modules aan/uit, KPI-tegels op Vandaag, uitleg agenda-koppeling |
| **Inbox** | Braindump-items omzetten naar taak of notitie, of weggooien |
| **Taken** | Weergaven: alle open, vandaag, komende 14 dagen, zonder datum, afgerond. Filters: klantwerk, bedrijf algemeen, privé, per klant, zoeken |
| **Projecten** | Gegroepeerd in Klanten / Bedrijf algemeen / Privé, met voortgang |
| **Klanten** | Dossier per klant: gegevens (basis, registratie, adressen, facturatie, compliance, overig), contactpersonen, websites, afspraken en termijnen (met MRR van de klant en uren/budget per uurtarief-afspraak), aangiftes (instellingen per soort, open aangiftes, laatst afgerond, losse aangifte toevoegen; ingeklapt als er geen boekhoudafspraak is), leads en offertes (met snel een nieuwe lead voor deze klant), uren (dit jaar, declarabel, effectief uurtarief, te factureren uren, laatste registraties, timer en handmatig), documenten, vaste informatie, projecten, taken, notities. Lijst met filter op status en tag |
| **Websites** | Alle websites van alle klanten, filter op hosting/beheer afgenomen, bovenaan domeinen die binnen 30 dagen verlopen |
| **Uren** | Timer starten, KPI's (deze week, declarabel, uren te factureren, effectief uurtarief), weekoverzicht per klant/gebied en per dag (vorige/volgende week, filter op klant), uren per soort werk, registraties per dag (bewerken, verwijderen, ▶ verder), handmatig toevoegen, te factureren uren met "Klaarzetten voor factuur", budget per maatwerkafspraak, effectief uurtarief per klant (maand/kwartaal/jaar/12 mnd) |
| **Pipeline** | KPI's (open leads met totaalwaarde, gewogen pipeline, openstaande offertes met waarde en MRR, gewonnen dit jaar met winstpercentage), nieuwe lead, volgende stappen die aan de beurt zijn, bord met kolommen Nieuw / In gesprek / Offerte verstuurd, tabbladen Gewonnen / Verloren / Alle offertes, lopende offertes. Lead-pagina: gegevens, volgende stap, status (in gesprek, verloren met reden, heropenen), offertes, nieuwe offerte. Offertepagina: regels toevoegen en bewerken, totalen, verstuurd / afgewezen / terug naar concept, kopie als nieuwe versie, en "Akkoord van de klant verwerken" met een overzicht van wat er gebeurt |
| **Afspraken** | KPI's (MRR, jaaromzet vast, klaar om te factureren, gefactureerd open), te factureren termijnen, afspraken die binnen 30 dagen eindigen, verwachte omzet 12 maanden, MRR per dienst en per klant, alle afspraken (lopend/concept/beëindigd/alle), gefactureerde en geplande termijnen |
| **Aangiftes** | KPI's (te doen, deadline binnen 14 dagen, stukken ontbreken, ingediend, afgerond dit jaar), melding bij een boekhoudklant zonder instellingen, deadline binnen 14 dagen, stukken nog niet binnen, overige open aangiftes, komend (periode loopt nog), losse aangifte toevoegen. Tabbladen Lopende perioden / Ingediend / Afgerond (per jaar) / Instellingen. Per aangifte een pagina met deadline, uitkomst, verloop, conceptmail voor de stukken en bewerken |
| **Projecten (detail)** | Plus: knop "Start timer", uren totaal en declarabel, budget van een gekoppelde uurtarief-afspraak, laatste registraties, handmatig toevoegen |
| **Notities** | Soorten: notitie, meeting, telefoon, e-mail, besluit, info, idee. Te koppelen aan klant, project, gebied |
| **Reviews** | Briefings, dagafsluitingen, weekreviews en maandreviews van de AI |

Verder: een **timerbalk** op elke pagina zolang er een timer loopt (telefoon: boven de onderbalk; desktop: bovenaan), een ▶-knop bij elke taak om direct een timer te starten, terugkerende taken (bij afronden wordt de volgende automatisch aangemaakt), agenda-koppeling via ICS (Google/iCloud, alleen lezen), installeerbaar als app op de telefoon, login met één wachtwoord.

### Datamodel

| Object | Belangrijkste velden |
|---|---|
| Klant (`clients`) | naam (bedrijf), rechtsvorm, status (lead/actief/on hold/oud-klant), klant sinds, bron, KvK, btw, adres/postcode/plaats/land, factuuradres (alleen als afwijkend), factuur-e-mail, betaaltermijn (dagen, standaard 14), Moneybird-contact-ID, verwerkersovereenkomst (n.v.t./nodig/verstuurd/getekend) + datum, verwerkte persoonsgegevens, verwijzing wachtwoordmanager, tags, info |
| Contactpersoon (`client_contacts`) | klant, naam, rol, e-mail, telefoon, primair ja/nee, notitie. Precies één primair per klant (wordt automatisch bewaakt) |
| Website (`websites`) | klant, domein (opgeschoond: zonder https/www/pad), registrar, verloopdatum domein, hostinglocatie, CMS, livegang, hosting afgenomen, beheer afgenomen, notities |
| Afspraak (`agreements`) | klant, soort (boekhouding/website/hosting/beheer/sparringpartner/maatwerk), omschrijving, website, project, bedrag (centen excl. btw; bij uurtarief per uur), prijsvorm (vast per periode/eenmalig/uurtarief), periode (maand/kwartaal/jaar), budget, sessies per maand, start, einde, opzegtermijn (maanden), indexatie %, status (concept/actief/opgezegd/beëindigd), notitie |
| Termijn (`installments`) | klant, afspraak, project, omschrijving, bedrag (centen excl. btw), moment (op datum/bij akkoord/bij oplevering), datum, status (gepland/klaar om te factureren/concept in Moneybird/verzonden/betaald), klaar sinds, gefactureerd op, betaald op, Moneybird-factuurnummer, volgorde, notitie |
| Uren (`time_entries`) | gebied, klant, project, taak, afspraak, soort werk, omschrijving, datum, begin, eind, duur in minuten (leeg = timer loopt), declarabel, gefactureerd, termijn (waarmee gefactureerd) |
| Lead (`leads`) | onderwerp, bedrijfsnaam, klant (bestaand of na akkoord), contactnaam/-e-mail/-telefoon, bron, interesse (soorten dienst), geschatte waarde, kans %, volgende stap + datum, status (nieuw/in gesprek/offerte verstuurd/gewonnen/verloren), reden verloren, gesloten op, notities |
| Offerte (`quotes`) | lead, klant, nummer, titel, datum, geldig tot, status (concept/verstuurd/akkoord/afgewezen/verlopen), verstuurd op, besloten op, link naar document, notitie |
| Offerteregel (`quote_lines`) | offerte, soort dienst, omschrijving, bedrag, prijsvorm, periode, budget, sessies per maand, domein, start, volgorde, afspraak (na akkoord) |
| Aangifte-instelling (`filing_schedules`) | klant, afspraak (boekhouding), soort (btw/IB/Vpb/ICP/loonheffingen/overig), eigen naam, frequentie (maand/kwartaal/jaar), uitstel (geen/aangevraagd/becon), vanaf, tot, stukken binnen X dagen, taken ja/nee, actief, notitie |
| Aangifte (`filings`) | klant, instelling, soort, eigen naam, periode (begin, eind), deadline (+ zelf aangepast ja/nee), stukken uiterlijk, stukken opgevraagd, stukken binnen, status (te doen/wacht op stukken/in behandeling/klaar voor controle/ingediend/afgerond), ingediend op, afgerond op, uitkomst (centen; positief = te betalen, negatief = terug), kenmerk, taak, notitie. Uniek per instelling en periode |
| Document (`client_documents`) | klant, soort (offerte/overeenkomst/verwerkersovereenkomst/overig), titel, link, datum, notitie |
| Project (`projects`) | naam, gebied, klant, status (idee/gepland/actief/wacht/afgerond/gearchiveerd), start, deadline, omschrijving |
| Taak (`tasks`) | titel, gebied, klant, project, status (te doen/bezig/wacht op/klaar), plannen op, deadline, prioriteit (1-3), inschatting, herhaling, notities |
| Notitie (`notes`) | titel, inhoud (markdown), soort (incl. `inbox`), gebied, klant, project, datum |
| Review (`reviews`) | soort (dag/week/maand), periode, tekst |
| Instelling (`settings`) | sleutel, waarde (jsonb), bijgewerkt. Nu: `modules` (welke modules aan staan) en `hidden_kpis` (verborgen KPI-tegels) |

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
src/lib/agreements.ts afspraken, termijnen, MRR en verwachte omzet (via data.ts geëxporteerd)
src/lib/pipeline.ts   leads, offertes, akkoord, pipeline-overzicht en signalen (via data.ts geëxporteerd)
src/lib/filings.ts    aangiftecyclus: instellingen, items genereren, statussen, taken, signalen (via data.ts geëxporteerd)
src/lib/filing-rules.ts  perioden, wettelijke deadlines en de conceptmail voor stukken (zonder database)
src/lib/time.ts       uren: timer, registraties, weekoverzicht, te factureren, budget, effectief uurtarief (via data.ts geëxporteerd)
src/lib/duration.ts   tijdsduren: invoer "1:30"/"1,5"/"90m", notatie
src/lib/money.ts      bedragen: centen, euro-notatie, invoer "1.250,50"
src/lib/mcp.ts        MCP-tools (TOOL_MODULE: welke tool bij welke module hoort)
src/lib/modules.ts    modules, KPI-tegels en thema's (beschrijvingen, ook in de browser te gebruiken)
src/lib/settings.ts   instellingen lezen en schrijven (modules aan/uit, verborgen tegels)
src/lib/cockpit.ts    alles voor Vandaag: KPI's, signalen, tijdlijn
src/components/cockpit.tsx  panelen, tegels, signalen, tijdlijn en de plekken voor doelbalk, gewoontes en Hermes
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

Let op: tools van uitgeschakelde modules worden niet aangeboden. Na het aan- of uitzetten van een module in Claude de connector opnieuw laden (of een nieuw gesprek starten) zodat de toollijst klopt.

Beschikbare tools (alle modules aan): `get_overview` (inclusief aangiftes: te laat, deadline binnen 14 dagen, stukken ontbreken; pipeline-signalen, domeinen die binnen 30 dagen verlopen, MRR, te factureren termijnen, aflopende afspraken, uren deze week, lopende timer en budgetwaarschuwingen), `list_tasks`, `create_task`, `update_task`, `complete_task`, `delete_task`, `completed_tasks`, `capture`, `inbox_to_task`, `list_notes`, `get_note`, `create_note`, `update_note`, `list_clients` (filter op status en tag), `get_client` (volledig dossier, inclusief afspraken, termijnen en MRR), `create_client` (met optioneel primaire contactpersoon), `update_client`, `add_contact`, `update_contact`, `delete_contact`, `list_websites` (met `expiringWithinDays`), `add_website`, `update_website`, `delete_website`, `add_document`, `delete_document`, `list_projects`, `get_project`, `create_project`, `update_project`, `list_agreements`, `create_agreement`, `update_agreement`, `deliver_agreement`, `delete_agreement`, `list_installments`, `add_installment`, `update_installment`, `delete_installment`, `get_revenue` (MRR, per dienst/klant, verwachte omzet), `get_timer`, `start_timer`, `stop_timer`, `log_time` (duur als tekst, bijv. "2u"), `list_time_entries`, `update_time_entry`, `delete_time_entry`, `get_hours` (weekoverzicht, te factureren uren, budgetten, effectief uurtarief), `invoice_hours`, `get_pipeline`, `list_leads`, `get_lead`, `create_lead`, `update_lead`, `delete_lead`, `list_quotes`, `get_quote`, `create_quote` (maakt zo nodig eerst een lead), `update_quote`, `add_quote_line`, `update_quote_line`, `delete_quote_line`, `set_quote_status`, `accept_quote`, `list_filings` (open aangiftes met signaal), `get_filing`, `update_filing`, `create_filing` (losse aangifte), `draft_docs_reminder` (conceptmail, verstuurt niets), `list_filing_schedules`, `set_filing_schedule`, `delete_filing_schedule`, `get_calendar`, `save_review` (met `append` om onder een bestaande review toe te voegen), `list_reviews`.

### Vaste taken om in te plannen

**Ochtendbriefing** (werkdagen 07:30)
> Gebruik Marc OS. Haal get_overview op. Schrijf een korte ochtendbriefing: afspraken van vandaag, wat achterstallig is, de 1 tot 3 belangrijkste taken (rekening houdend met de vrije tijd tussen afspraken) en wat er in de inbox staat. Doe een voorstel voor de dagindeling. Sla op met save_review (kind=day).

**Dagafsluiting** (werkdagen 17:30)
> Gebruik Marc OS. Haal get_overview, completed_tasks en list_time_entries voor vandaag op. Vat samen wat gedaan is en wat is blijven liggen, en hoeveel uren er vandaag geschreven zijn (meld het als de timer nog loopt of als er voor afgeronde klanttaken geen uren staan). Verplaats onafgemaakte taken van vandaag naar morgen. Sla op met save_review (kind=day, append=true).

**Weekreview** (vrijdag 15:00)
> Gebruik Marc OS. Haal completed_tasks voor deze week, list_projects, list_tasks (view=open), get_hours (period=month), get_pipeline en list_filings op. Maak een weekreview: wat is bereikt per klant en privé, aangiftes (deadlines komende twee weken, stukken die ontbreken), de pipeline (open leads zonder volgende stap, offertes zonder reactie, gewonnen en verloren), uren per klant (declarabel/totaal), te factureren uren en budgetten boven 80%, opvallend lage effectieve uurtarieven, welke projecten lopen achter, wat blijft structureel liggen, en een voorstel voor de focus van volgende week. Sla op met save_review (kind=week).

**Aangiftecheck** (maandag 08:45)
> Gebruik Marc OS. Haal list_filings op. Geef per klant de aangiftes met een deadline binnen 14 dagen of die te laat zijn, en de aangiftes waarvan de stukken ontbreken. Maak voor elke aangifte waarvan de periode is afgelopen en de stukken nog niet zijn opgevraagd een conceptmail met draft_docs_reminder en zet die in de review, zodat Marc ze kan versturen. Verstuur niets en wijzig geen statussen. Sla op met save_review (kind=week, append=true).

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
- [ ] Lokale map `marc-os` op de Mac bijwerken (`git pull`, stond nog op gesprek 4) en `npm run local`: migratie 0007 (instellingen) draait vanzelf, daarna staan de geavanceerde modules uit
- [ ] Op de Mac `node -v` controleren (moet 22 of hoger zijn), dan `npm run local` en het klantdossier en de afspraken per klant invullen
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
