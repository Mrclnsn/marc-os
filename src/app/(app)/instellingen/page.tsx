import { cookies } from "next/headers";
import Link from "next/link";
import { PageHeader, SectionTitle } from "@/components/brand";
import { KpiSwitch, ModuleSwitch } from "@/components/settings-parts";
import { ThemeChoice } from "@/components/theme-switch";
import { calendarConfigured } from "@/lib/calendar";
import { KPI_KEYS, KPIS, MODULE_KEYS, MODULES, THEME_COOKIE, getHiddenKpis, getModules, parseTheme } from "@/lib/settings";

export default async function SettingsPage() {
  const [modules, hidden] = await Promise.all([getModules(), getHiddenKpis()]);
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
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

      <section className="space-y-3">
        <SectionTitle>Agenda</SectionTitle>
        <div className="card p-4 text-sm">
          {calendarConfigured() ? (
            <p className="text-grafiet">Agenda gekoppeld via ICS (alleen lezen). De tijdlijn op Vandaag toont je afspraken.</p>
          ) : (
            <p className="text-grafiet">Nog geen agenda gekoppeld.</p>
          )}
          <p className="mt-1 text-steen">
            Agenda-links staan in <code className="chip">CALENDAR_ICS_URLS</code> in het bestand <code className="chip">.env</code> op de server (lokaal <code className="chip">.env.local</code>), bijvoorbeeld <code className="chip">Werk|https://...ics,Privé|https://...ics</code>. Daarna de app herstarten.
          </p>
        </div>
      </section>
    </div>
  );
}
