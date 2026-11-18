import { cookies, headers } from "next/headers";
import Link from "next/link";
import { PageHeader, SectionTitle } from "@/components/brand";
import { KpiSwitch, ModuleSwitch } from "@/components/settings-parts";
import { ThemeChoice } from "@/components/theme-switch";
import { CockpitStyleSwitch } from "@/components/cockpit-client";
import { listCalendarFeeds } from "@/lib/calendar";
import { AddFeedForm, FeedItem } from "@/components/calendar-parts";
import { searchStatus } from "@/lib/data";
import { syncSearchIndexAction } from "../../actions";
import { PushPrefSwitch, PushThisDevice, RemoveDeviceButton } from "@/components/push-settings";
import { HealthTokenBox } from "@/components/health-parts";
import { AutoToolSwitch } from "@/components/hermes-parts";
import { getAutoTools } from "@/lib/agent";
import { hermesConfig, hermesStatus } from "@/lib/hermes";
import { writeTools } from "@/lib/mcp";
import { getHealthToken, listHealthImports } from "@/lib/health";
import { PUSH_KIND_KEYS, PUSH_KINDS, getPushPrefs, lastBackupPull, listBackups, listDevices, vapidPublicKey } from "@/lib/push";
import { COCKPIT_COOKIE, KPI_KEYS, KPIS, MODULE_KEYS, MODULES, THEME_COOKIE, getHiddenKpis, getModules, parseCockpitStyle, parseTheme } from "@/lib/settings";

export default async function SettingsPage() {
  const [modules, hidden, brain, devices, pushPrefs, publicKey, pull, feeds, healthToken, healthImports] = await Promise.all([
    getModules(),
    getHiddenKpis(),
    searchStatus(),
    listDevices(),
    getPushPrefs(),
    vapidPublicKey(),
    lastBackupPull(),
    listCalendarFeeds(),
    getHealthToken(),
    listHealthImports(8),
  ]);
  const [hermes, autoTools, tools] = await Promise.all([hermesStatus(true), getAutoTools(), writeTools()]);
  const hermesCfg = hermesConfig();
  const backups = listBackups();
  const host = process.env.DOMAIN ?? (await headers()).get("host") ?? "os.marclonsain.nl";
  const mcpUrl = process.env.MCP_TOKEN ? `https://${host}/api/mcp/${process.env.MCP_TOKEN}` : null;
  const fmt = (iso: string) => new Intl.DateTimeFormat("nl-NL", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Amsterdam" }).format(new Date(iso));
  const store = await cookies();
  const theme = parseTheme(store.get(THEME_COOKIE)?.value);
  const cockpitStyle = parseCockpitStyle(store.get(COCKPIT_COOKIE)?.value);
  const onCount = MODULE_KEYS.filter((k) => modules[k]).length;

  return (
    <div className="space-y-12">
      <PageHeader eyebrow="Marc OS" title="Instellingen" />

      <section className="space-y-3">
        <SectionTitle>Weergave</SectionTitle>
        <div className="card flex flex-wrap items-center justify-between gap-4 p-4">
          <div>
            <p className="font-bold text-nacht">Thema</p>
            <p className="text-sm text-steen">Donkere cockpitmodus (Nacht en Grafiet) of licht. &quot;Volg systeem&quot; wisselt mee met je Mac of telefoon. Geldt per apparaat.</p>
          </div>
          <ThemeChoice theme={theme} />
        </div>
        <div className="card flex flex-wrap items-center justify-between gap-4 p-4">
          <div>
            <p className="font-bold text-nacht">Cockpitstijl op Vandaag</p>
            <p className="text-sm text-steen">Strak in MLC-stijl, of Iron Man: donker HUD met gloed, raster en een bewegende Hermes-bol. Geldt per apparaat; ook te wisselen bovenaan Vandaag.</p>
          </div>
          <CockpitStyleSwitch style={cockpitStyle} />
        </div>
      </section>

      <section id="modules" className="scroll-mt-8 space-y-3">
        <SectionTitle aside={<span className="text-xs text-steen">{onCount} van {MODULE_KEYS.length} aan</span>}>Modules</SectionTitle>
        <p className="max-w-2xl text-sm text-steen">
          Tijdens de MVP staan de geavanceerde zakelijke modules uit, zodat je alleen ziet wat je dagelijks nodig hebt. Uitzetten is verbergen, niet verwijderen: je gegevens blijven bewaard en alles is per module weer aan te zetten.
          Vandaag, Inbox, Taken, Projecten, Klanten (basis), Notities en Reviews staan altijd aan.
        </p>
        <ul className="card divide-y divide-lijn">
          {MODULE_KEYS.map((k) => {
            const m = MODULES[k];
            return (
              <li key={k} className="flex items-start justify-between gap-4 p-4">
                <div className="min-w-0">
                  <p className="font-bold text-nacht">
                    {m.href && modules[k] ? <Link href={m.href} className="hover:underline">{m.label}</Link> : m.label}
                  </p>
                  <p className="text-sm text-grafiet">{m.description}</p>
                  {!modules[k] && <p className="mt-1 text-xs text-steen">Uit: {m.off}</p>}
                </div>
                <ModuleSwitch module={k} on={modules[k]} label={m.label} />
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-steen">
          Weer aanzetten: wat stil stond wordt aangevuld. Bij Aangiftes betekent dat: items en taken voor alle perioden die intussen zijn afgelopen.
        </p>
      </section>

      <section id="second-brain" className="scroll-mt-8 space-y-3">
        <SectionTitle>Second brain</SectionTitle>
        <div className="card divide-y divide-lijn">
          <div className="flex flex-wrap items-start justify-between gap-4 p-4">
            <div className="min-w-0 max-w-2xl">
              <p className="font-bold text-nacht">Semantisch zoeken {brain.semantic ? "staat aan" : "staat uit"}</p>
              {brain.semantic ? (
                <p className="text-sm text-grafiet">
                  {brain.provider}, model {brain.model}. {brain.indexed} van {brain.items} notities en bronnen in de index{brain.stale > 0 ? `, ${brain.stale} nog bij te werken` : ""}.
                  Nieuwe en gewijzigde notities gaan er na opslaan vanzelf in; elke nacht loopt een controle.
                </p>
              ) : (
                <p className="text-sm text-grafiet">
                  Zoeken werkt op trefwoord (Nederlandse full-text search). {brain.problem ?? (brain.vector ? "" : "pgvector is niet beschikbaar in de database.")}
                </p>
              )}
              <p className="mt-1 text-xs text-steen">
                Database: pgvector {brain.vector ? "beschikbaar" : "niet beschikbaar"}. Aanzetten: in .env EMBEDDING_PROVIDER=voyage en EMBEDDING_API_KEY (of openai). De provider ziet dan de tekst van notities en bronnen: opnemen in het leveranciersregister.
              </p>
              {brain.lastError && <p className="mt-1 text-xs text-nacht">Laatste fout ({brain.lastError.at.slice(0, 16).replace("T", " ")}): {brain.lastError.message}</p>}
            </div>
            <form action={syncSearchIndexAction}>
              <button className="btn">Links en index bijwerken</button>
            </form>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 p-4">
            <div className="max-w-2xl">
              <p className="font-bold text-nacht">Obsidian-export</p>
              <p className="text-sm text-grafiet">
                Alle notities, bronnen, klanten, projecten en reviews als markdown-map in Obsidian-formaat, met [[links]] en eigenschappen. Op de VPS elke nacht naar /opt/marc-os/obsidian; hier als zip te downloaden. Alleen lezen: wijzigingen in Obsidian gaan niet terug naar Marc OS.
              </p>
            </div>
            <a href="/api/export/obsidian" className="btn">Download zip</a>
          </div>
        </div>
      </section>

      <section id="push" className="scroll-mt-8 space-y-3">
        <SectionTitle aside={<span className="text-xs text-steen">{devices.length} {devices.length === 1 ? "apparaat" : "apparaten"}</span>}>Pushmeldingen</SectionTitle>
        <div className="card divide-y divide-lijn">
          <PushThisDevice publicKey={publicKey} knownEndpoints={devices.map((d) => d.endpoint)} />
          {devices.length > 0 && (
            <ul className="divide-y divide-lijn">
              {devices.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="text-grafiet">{d.label}</p>
                    <p className="text-xs text-steen">
                      Aangemeld {fmt(d.createdAt.toISOString())}
                      {d.lastSuccessAt ? ` · laatste melding ${fmt(d.lastSuccessAt.toISOString())}` : ""}
                      {d.lastError ? ` · fout: ${d.lastError}` : ""}
                    </p>
                  </div>
                  <RemoveDeviceButton id={d.id} />
                </li>
              ))}
            </ul>
          )}
        </div>
        <ul className="card divide-y divide-lijn">
          {PUSH_KIND_KEYS.map((k) => (
            <li key={k} className="flex items-start justify-between gap-4 p-4">
              <div className="min-w-0">
                <p className="font-bold text-nacht">{PUSH_KINDS[k].label}</p>
                <p className="text-sm text-grafiet">{PUSH_KINDS[k].description}</p>
              </div>
              <PushPrefSwitch kind={k} on={pushPrefs[k]} label={PUSH_KINDS[k].label} />
            </li>
          ))}
        </ul>
        <p className="text-xs text-steen">
          Welke blokken een herinnering geven, kies je per blok op <Link href="/planning/dagritme" className="underline decoration-lijn underline-offset-2 hover:decoration-nacht">Planning → Dagritme</Link>.
        </p>
      </section>

      <section id="backups" className="scroll-mt-8 space-y-3">
        <SectionTitle>Back-ups</SectionTitle>
        <div className="card divide-y divide-lijn">
          <div className="p-4">
            <p className="font-bold text-nacht">Op de VPS</p>
            {backups.length ? (
              <p className="text-sm text-grafiet">
                Laatste back-up: {fmt(backups[0].modified)} ({Math.max(1, Math.round(backups[0].bytes / 1024))} kB). {backups.length} bewaard (30 dagen). Elke nacht om 03:15, versleuteld (AES-256).
              </p>
            ) : (
              <p className="text-sm text-grafiet">Nog geen back-ups gevonden. Op de VPS draait elke nacht om 03:15 een versleutelde back-up; lokaal is er geen.</p>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 p-4">
            <div className="max-w-2xl">
              <p className="font-bold text-nacht">Buiten de VPS (Mac)</p>
              <p className="text-sm text-grafiet">
                {pull ? `Laatst opgehaald door de Mac: ${fmt(pull.at)} (${pull.file}).` : "De Mac heeft nog geen back-up opgehaald."} Na 3 dagen zonder ophalen krijg je een systeemmelding.
              </p>
              <p className="mt-1 text-xs text-steen">
                Installeren op de Mac: <code className="chip">bash scripts/mac-install.sh</code> in de map marc-os. Terugzetten kan alleen met de back-upsleutel uit je wachtwoordmanager.
              </p>
            </div>
            {backups.length > 0 && <a href="/api/export/backup" className="btn">Download nieuwste</a>}
          </div>
        </div>
      </section>

      <section id="apple-health" className="scroll-mt-8 space-y-3">
        <SectionTitle aside={<span className="text-xs text-steen">{healthImports[0] ? `laatst ${fmt(healthImports[0].receivedAt.toISOString())}` : "nog niets ontvangen"}</span>}>Apple Health</SectionTitle>
        <div className="card space-y-4 p-4 text-sm">
          <p className="text-grafiet">
            Apple Health heeft geen koppeling via internet. De iPhone-app <strong>Health Auto Export</strong> stuurt je gegevens rechtstreeks van je telefoon naar Marc OS (geen account, geen tussenpartij). Voor automatisch versturen is Premium nodig in die app.
            Deze sleutel kan alleen gezondheidsdata aanleveren, niets lezen.
          </p>
          <HealthTokenBox url={`https://${host}/api/health/import`} token={healthToken} />
          <details>
            <summary className="cursor-pointer text-steen hover:text-nacht">Zo stel je Health Auto Export in</summary>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-grafiet">
              <li>Installeer Health Auto Export op je iPhone, geef toegang tot Gezondheid en neem Premium (abonnement of eenmalig).</li>
              <li>Ga naar Automations, maak een nieuwe automatisering van het type <strong>REST API</strong> en plak de URL hierboven.</li>
              <li>Voeg bij Headers toe: sleutel <code className="chip">Authorization</code>, waarde <code className="chip">Bearer …</code> (knop &quot;Kopieer waarde&quot;).</li>
              <li>
                Data type <strong>Health Metrics</strong>, en kies: Step Count, Active Energy, Apple Exercise Time, Walking + Running Distance, Resting Heart Rate, Weight &amp; Body Mass, Body Fat Percentage, Sleep Analysis,
                Dietary Energy, Protein, Carbohydrates, Total Fat, Fiber en Water.
              </li>
              <li>Formaat <strong>JSON</strong>, gegevens samenvoegen (Aggregate) per <strong>dag</strong>, periode bijvoorbeeld de laatste 7 dagen. Opnieuw sturen is veilig: alles wordt overschreven, niets telt dubbel.</li>
              <li>Maak een tweede automatisering met dezelfde URL en header voor <strong>Workouts</strong>.</li>
              <li>Laat ze elke paar uur draaien (Sync Cadence) en stuur één keer met de hand de laatste 90 dagen voor de weektrends.</li>
              <li>Trainingen van Virtuagym en voeding van Foodvisor komen alleen mee als die apps naar Apple Health schrijven: zet dat aan in hun instellingen en kijk in de Gezondheid-app of ze er staan. Komt een training niet door, voeg hem dan toe op de pagina Gezondheid.</li>
            </ol>
          </details>
          {healthImports.length > 0 && (
            <div>
              <p className="label">Laatste zendingen</p>
              <ul className="divide-y divide-lijn text-xs">
                {healthImports.map((i) => (
                  <li key={i.id} className="flex flex-wrap justify-between gap-x-4 py-1.5">
                    <span className="text-grafiet">{fmt(i.receivedAt.toISOString())}</span>
                    <span className="text-steen">
                      {i.error
                        ? `Mislukt: ${i.error}`
                        : `${i.samples} ${i.samples === 1 ? "meting" : "metingen"}, ${i.workouts} ${i.workouts === 1 ? "training" : "trainingen"}, ${i.sleep} ${i.sleep === 1 ? "nacht" : "nachten"}${i.fromDate ? ` (${i.fromDate === i.toDate ? i.fromDate : `${i.fromDate} t/m ${i.toDate}`})` : ""}${i.skipped.length ? ` · genegeerd: ${i.skipped.join(", ")}` : ""}`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      <section id="hermes" className="scroll-mt-8 space-y-3">
        <SectionTitle aside={<span className="text-xs text-steen">{hermes.online ? "online" : hermes.configured ? "offline" : "niet geïnstalleerd"}</span>}>Hermes</SectionTitle>
        <div className="card space-y-2 p-4 text-sm">
          {!hermesCfg.configured ? (
            <p className="text-grafiet">
              Hermes is nog niet geïnstalleerd. Op de VPS: <code className="chip">bash /opt/marc-os/scripts/hermes-setup.sh</code> (vraagt om een Anthropic API-sleutel).
            </p>
          ) : (
            <p className="text-grafiet">
              Hermes draait naast de app op de VPS ({hermesCfg.url}){hermes.online ? "" : `, maar reageert nu niet${hermes.error ? ` (${hermes.error})` : ""}`}. Hij praat met Marc OS via een eigen MCP-sleutel: lezen gaat direct,
              wijzigen wordt een voorstel in de <Link href="/hermes?tab=akkoord" className="underline">akkoordwachtrij</Link>. Alles staat in het <Link href="/hermes?tab=logboek" className="underline">logboek</Link>.
            </p>
          )}
          <p className="text-xs text-steen">{process.env.HERMES_MCP_TOKEN ? "MCP-sleutel voor Hermes (HERMES_MCP_TOKEN) staat in .env." : "HERMES_MCP_TOKEN ontbreekt in .env (wordt aangemaakt door update.sh)."}</p>
        </div>
        <p className="max-w-2xl pt-2 text-sm text-steen">
          Wat Hermes zonder akkoord mag doen. Uit = eerst een voorstel dat je goedkeurt. Verwijderen, offertes, factureren en klantgegevens gaan altijd via akkoord.
        </p>
        <ul className="card divide-y divide-lijn">
          {tools.map((t) => (
            <li key={t.name} className="flex items-center justify-between gap-4 px-4 py-2.5">
              <div className="min-w-0">
                <p className={t.neverAuto ? "text-steen" : "text-grafiet"}>{t.title}</p>
                <p className="text-xs text-steen">
                  {t.name}
                  {t.neverAuto ? " · altijd via akkoord" : ""}
                </p>
              </div>
              <AutoToolSwitch tool={t.name} on={autoTools.includes(t.name)} label={`${t.title} zonder akkoord`} disabled={t.neverAuto} />
            </li>
          ))}
        </ul>
      </section>

      <section id="claude" className="scroll-mt-8 space-y-3">
        <SectionTitle>Koppeling met Claude (MCP)</SectionTitle>
        <div className="card p-4 text-sm">
          <p className="text-grafiet">
            In Claude: Instellingen → Connectors → Custom connector toevoegen, met deze URL. Behandel de URL als een wachtwoord: wie hem heeft, kan alles in Marc OS lezen en wijzigen.
          </p>
          {mcpUrl ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-steen hover:text-nacht">Toon de MCP-URL</summary>
              <code className="chip mt-2 block break-all select-all">{mcpUrl}</code>
            </details>
          ) : (
            <p className="mt-1 text-steen">MCP_TOKEN staat niet in .env.</p>
          )}
          <p className="mt-2 text-xs text-steen">Na het aan- of uitzetten van een module: in Claude de connector opnieuw laden of een nieuw gesprek starten.</p>
        </div>
      </section>

      <section className="space-y-3">
        <SectionTitle>KPI-tegels op Vandaag</SectionTitle>
        <ul className="card divide-y divide-lijn">
          {KPI_KEYS.map((k) => {
            const kpi = KPIS[k];
            const off = kpi.module && !modules[kpi.module];
            return (
              <li key={k} className="flex items-center justify-between gap-4 px-4 py-3">
                <div>
                  <p className={off ? "text-steen" : "text-grafiet"}>{kpi.label}</p>
                  {off && <p className="text-xs text-steen">Module {MODULES[kpi.module!].label} staat uit</p>}
                </div>
                <KpiSwitch kpi={k} on={!hidden.includes(k) && !off} label={kpi.label} disabled={!!off} />
              </li>
            );
          })}
        </ul>
      </section>

      <section id="agenda" className="scroll-mt-8 space-y-3">
        <SectionTitle aside={<span className="text-xs text-steen">{feeds.filter((f) => f.active).length} actief</span>}>Agenda</SectionTitle>
        <p className="max-w-2xl text-sm text-steen">
          Je afspraken uit Google Agenda, iCloud of Outlook verschijnen op de tijdlijn van Vandaag, in Planning en in de briefing. Alleen lezen, elke 5 minuten ververst.
        </p>
        <div className="card divide-y divide-lijn">
          {feeds.length > 0 && (
            <ul className="divide-y divide-lijn">
              {feeds.map((f) => (
                <FeedItem key={f.id} feed={{ id: f.id, name: f.name, masked: f.masked, active: f.active, lastOkAt: f.lastOkAt ? f.lastOkAt.toISOString() : null, lastError: f.lastError, source: f.source }} />
              ))}
            </ul>
          )}
          <AddFeedForm />
        </div>
      </section>
    </div>
  );
}
