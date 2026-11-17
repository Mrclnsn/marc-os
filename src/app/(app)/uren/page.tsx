import Link from "next/link";
import { PageHeader, SectionTitle } from "@/components/brand";
import { BillingQueue, BudgetLine, EntriesByDay, ManualTimeForm, StartTimerForm, WeekGrid } from "@/components/time-parts";
import { billableQueue, effectiveRates, hourlyBudgets, recentDescriptions, weekSummary, type RatePeriod } from "@/lib/data";
import { addDaysIso, formatDate, today, weekStart } from "@/lib/dates";
import { formatDuration, formatHours } from "@/lib/duration";
import { formatEuro, formatEuroRound } from "@/lib/money";
import { getOptions } from "@/lib/options";

function Kpi({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <div className="border-l border-lijn pl-4">
      <span className="block text-3xl font-bold leading-none text-nacht tabular-nums">{value}</span>
      <span className="mt-2 block text-xs uppercase tracking-wider text-steen">{label}</span>
      {sub && <span className="block text-xs text-steen">{sub}</span>}
    </div>
  );
}

const PERIODS: { key: RatePeriod; label: string }[] = [
  { key: "month", label: "Maand" },
  { key: "quarter", label: "Kwartaal" },
  { key: "year", label: "Jaar" },
  { key: "12m", label: "12 mnd" },
];

export default async function HoursPage({ searchParams }: { searchParams: Promise<{ week?: string; klant?: string; periode?: string }> }) {
  const sp = await searchParams;
  const t = today();
  const week = /^\d{4}-\d{2}-\d{2}$/.test(sp.week ?? "") ? weekStart(sp.week!) : weekStart(t);
  const period = (PERIODS.find((p) => p.key === sp.periode)?.key ?? "year") as RatePeriod;
  const clientId = sp.klant || undefined;

  const [summary, queue, budgets, rates, options, descriptions] = await Promise.all([
    weekSummary(week, { clientId }),
    billableQueue(),
    hourlyBudgets(),
    effectiveRates(period),
    getOptions(),
    recentDescriptions(),
  ]);
  const clientName = clientId ? options.clients.find((c) => c.id === clientId)?.name : null;
  const queueValue = queue.reduce((s, g) => s + (g.amountCents ?? 0), 0);
  const queueMinutes = queue.reduce((s, g) => s + g.minutes, 0);
  const pct = summary.total ? Math.round((summary.billable / summary.total) * 100) : 0;
  const isThisWeek = week === weekStart(t);
  const link = (patch: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    const next = { week: isThisWeek ? undefined : week, klant: clientId, periode: period === "year" ? undefined : period, ...patch };
    for (const [k, v] of Object.entries(next)) if (v) q.set(k, v);
    const qs = q.toString();
    return qs ? `/uren?${qs}` : "/uren";
  };

  return (
    <div className="space-y-10">
      <PageHeader eyebrow={`Week ${formatDate(week)} t/m ${formatDate(addDaysIso(week, 6))}${clientName ? ` · ${clientName}` : ""}`} title="Uren">
        <div className="flex items-center gap-2">
          <Link href={link({ week: addDaysIso(week, -7) })} className="btn px-3" aria-label="Vorige week">‹</Link>
          {!isThisWeek && <Link href={link({ week: undefined })} className="btn">Deze week</Link>}
          <Link href={link({ week: addDaysIso(week, 7) })} className="btn px-3" aria-label="Volgende week">›</Link>
        </div>
      </PageHeader>

      <StartTimerForm clients={options.clients} projects={options.projects} descriptions={descriptions} clientId={clientId} />

      <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
        <Kpi value={formatDuration(summary.total)} label={isThisWeek ? "Deze week" : "Die week"} sub={`${formatHours(summary.total)} totaal`} />
        <Kpi value={formatDuration(summary.billable)} label="Declarabel" sub={`${pct}% van alle uren`} />
        <Kpi value={formatEuroRound(queueValue)} label="Uren te factureren" sub={`${formatHours(queueMinutes)} open`} />
        <Kpi value={rates.totals.rateCents != null ? formatEuroRound(rates.totals.rateCents) : "–"} label="Effectief uurtarief" sub={PERIODS.find((p) => p.key === period)!.label.toLowerCase() + ", alle klanten"} />
      </div>

      <section>
        <SectionTitle
          aside={
            clientId ? (
              <Link href={link({ klant: undefined })} className="text-xs text-steen hover:text-nacht">Filter {clientName} wissen</Link>
            ) : null
          }
        >
          Week per klant
        </SectionTitle>
        <WeekGrid week={summary} today={t} />
        {summary.byCategory.length > 0 && (
          <p className="mt-3 text-xs text-steen">
            Per soort: {summary.byCategory.map((c) => `${c.category} ${formatDuration(c.minutes)}`).join(" · ")}
          </p>
        )}
        {!clientId && summary.rows.some((r) => r.clientId) && (
          <p className="mt-1 text-xs text-steen">
            Alleen één klant tonen:{" "}
            {summary.rows.filter((r) => r.clientId).map((r, i) => (
              <span key={r.key}>{i > 0 && " · "}<Link href={link({ klant: r.clientId! })} className="hover:text-nacht">{r.label}</Link></span>
            ))}
          </p>
        )}
      </section>

      <section className="space-y-4">
        <SectionTitle>Registraties</SectionTitle>
        <EntriesByDay entries={summary.entries} clients={options.clients} projects={options.projects} descriptions={descriptions} />
        <ManualTimeForm clients={options.clients} projects={options.projects} descriptions={descriptions} today={week === weekStart(t) ? t : week} clientId={clientId} />
      </section>

      <div className="grid gap-10 lg:grid-cols-2">
        <section>
          <SectionTitle aside={<Link href="/afspraken" className="text-xs text-steen hover:text-nacht">Afspraken</Link>}>Te factureren uren</SectionTitle>
          <div className="card"><BillingQueue groups={queue} /></div>
          <p className="mt-2 text-xs text-steen">
            Klaarzetten maakt één termijn &quot;klaar om te factureren&quot; bij de afspraak, met alle open declarabele uren. De factuur zelf maak je in Moneybird.
          </p>
        </section>

        <section>
          <SectionTitle>Maatwerk en budget</SectionTitle>
          {budgets.length === 0 ? (
            <p className="text-sm text-steen">Geen lopende afspraken met uurtarief.</p>
          ) : (
            <div className="divide-y divide-lijn">{budgets.map((b) => <BudgetLine key={b.agreementId} b={b} showClient />)}</div>
          )}
        </section>
      </div>

      <section>
        <SectionTitle
          aside={
            <div className="flex gap-3 whitespace-nowrap">
              {PERIODS.map((p) => (
                <Link key={p.key} href={link({ periode: p.key === "year" ? undefined : p.key })} className={period === p.key ? "tab-active" : "tab"}>{p.label}</Link>
              ))}
            </div>
          }
        >
          Effectief uurtarief
        </SectionTitle>
        {rates.clients.length === 0 ? (
          <p className="text-sm text-steen">Nog geen omzet of uren in deze periode.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-steen">
                  <th className="py-1 font-normal">Klant</th>
                  <th className="py-1 text-right font-normal">Omzet</th>
                  <th className="hidden py-1 text-right font-normal md:table-cell">Vast</th>
                  <th className="hidden py-1 text-right font-normal md:table-cell">Eenmalig</th>
                  <th className="hidden py-1 text-right font-normal md:table-cell">Uren x tarief</th>
                  <th className="py-1 text-right font-normal">Uren</th>
                  <th className="py-1 text-right font-normal">Per uur</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-lijn">
                {rates.clients.map((c) => (
                  <tr key={c.clientId}>
                    <td className="py-1.5"><Link href={`/klanten/${c.clientId}`} className="hover:text-nacht">{c.clientName}</Link></td>
                    <td className="py-1.5 text-right tabular-nums">{formatEuroRound(c.revenueCents)}</td>
                    <td className="hidden py-1.5 text-right tabular-nums text-steen md:table-cell">{c.fixedCents ? formatEuroRound(c.fixedCents) : "–"}</td>
                    <td className="hidden py-1.5 text-right tabular-nums text-steen md:table-cell">{c.oneOffCents ? formatEuroRound(c.oneOffCents) : "–"}</td>
                    <td className="hidden py-1.5 text-right tabular-nums text-steen md:table-cell">{c.hourlyCents ? formatEuroRound(c.hourlyCents) : "–"}</td>
                    <td className="py-1.5 text-right tabular-nums">{c.minutes ? formatHours(c.minutes) : "–"}</td>
                    <td className="py-1.5 text-right font-bold tabular-nums text-nacht">{c.rateCents != null ? formatEuro(c.rateCents) : "geen uren"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-nacht">
                  <td className="py-1.5 font-bold text-nacht">Totaal</td>
                  <td className="py-1.5 text-right font-bold tabular-nums">{formatEuroRound(rates.totals.revenueCents)}</td>
                  <td className="hidden md:table-cell" colSpan={3} />
                  <td className="py-1.5 text-right font-bold tabular-nums">{formatHours(rates.totals.minutes)}</td>
                  <td className="py-1.5 text-right font-bold tabular-nums text-nacht">{rates.totals.rateCents != null ? formatEuro(rates.totals.rateCents) : "–"}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-steen">
          Omzet gedeeld door alle zakelijke uren voor de klant, van {formatDate(rates.from)} t/m {formatDate(rates.to)}.
          {rates.from !== rates.requestedFrom && " De periode begint bij je eerste geschreven uren, zodat er geen omzet zonder uren meetelt."}
          {" "}Vast = afspraken naar rato van de dagen; eenmalig = termijnen klaar of gefactureerd in de periode; uren x tarief = declarabele uren bij een uurtarief.
        </p>
      </section>
    </div>
  );
}
