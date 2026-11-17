import Link from "next/link";
import { PageHeader, SectionTitle } from "@/components/brand";
import { LeadCard, LeadLine, NewLeadForm, QuoteRows } from "@/components/pipeline-parts";
import { listLeads, listQuotes, pipelineOverview } from "@/lib/data";
import { LEAD_STATUS, OPEN_LEAD_STATUSES } from "@/lib/labels";
import { formatEuroRound } from "@/lib/money";
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

const TABS = [
  { key: undefined, label: "Open" },
  { key: "gewonnen", label: "Gewonnen" },
  { key: "verloren", label: "Verloren" },
  { key: "offertes", label: "Alle offertes" },
] as const;

export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ toon?: string; nieuw?: string }> }) {
  const { toon, nieuw } = await searchParams;
  const [overview, leads, options, sentQuotes] = await Promise.all([
    pipelineOverview(),
    listLeads(),
    getOptions(),
    listQuotes(toon === "offertes" ? {} : { status: ["sent", "draft"] }),
  ]);
  const open = leads.filter((l) => l.open);
  const due = open.filter((l) => l.nextStepDue);

  return (
    <div className="space-y-10">
      <PageHeader eyebrow="Zakelijk · leads en offertes · bedragen excl. btw" title="Pipeline" />

      <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
        <Kpi value={String(overview.openLeads)} label="Open leads" sub={`${formatEuroRound(overview.pipelineCents)} totaal`} />
        <Kpi value={formatEuroRound(overview.weightedCents)} label="Gewogen pipeline" sub="waarde x kans" />
        <Kpi
          value={String(overview.openQuotes.count)}
          label="Openstaande offertes"
          sub={`${formatEuroRound(overview.openQuotes.cents)}${overview.openQuotes.monthlyCents ? ` · ${formatEuroRound(overview.openQuotes.monthlyCents)} MRR` : ""}`}
        />
        <Kpi
          value={String(overview.wonThisYear.count)}
          label="Gewonnen dit jaar"
          sub={`${formatEuroRound(overview.wonThisYear.cents)}${overview.winRatePct != null ? ` · ${overview.winRatePct}% gewonnen` : ""}`}
        />
      </div>

      <NewLeadForm clients={options.clients} open={nieuw === "1"} />

      {due.length > 0 && (
        <section>
          <SectionTitle>Volgende stap nu aan de beurt</SectionTitle>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {due.map((l) => <LeadCard key={l.id} l={l} />)}
          </div>
        </section>
      )}

      <section className="space-y-4">
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {TABS.map((t) => (
            <Link key={t.label} href={t.key ? `/pipeline?toon=${t.key}` : "/pipeline"} className={toon === t.key ? "tab-active" : "tab"}>{t.label}</Link>
          ))}
        </div>

        {!toon && (
          <div className="grid gap-6 md:grid-cols-3">
            {OPEN_LEAD_STATUSES.map((st) => {
              const col = open.filter((l) => l.status === st);
              const total = overview.byStatus.find((b) => b.status === st);
              return (
                <div key={st} className="space-y-2">
                  <div className="flex items-baseline justify-between border-b-[3px] border-nacht pb-1">
                    <h3 className="font-bold text-nacht">{LEAD_STATUS[st]} <span className="font-normal text-steen">({col.length})</span></h3>
                    <span className="text-xs tabular-nums text-steen">{total?.cents ? formatEuroRound(total.cents) : ""}</span>
                  </div>
                  {col.length === 0 && <p className="text-sm text-steen">Leeg.</p>}
                  {col.map((l) => <LeadCard key={l.id} l={l} />)}
                </div>
              );
            })}
          </div>
        )}

        {(toon === "gewonnen" || toon === "verloren") && (
          <div className="card">
            {(() => {
              const rows = leads.filter((l) => l.status === (toon === "gewonnen" ? "won" : "lost"));
              return rows.length ? <ul className="divide-y divide-lijn">{rows.map((l) => <LeadLine key={l.id} l={l} />)}</ul> : <p className="px-3 py-3 text-sm text-steen">Nog niets.</p>;
            })()}
          </div>
        )}

        {toon === "offertes" && <div className="card"><QuoteRows rows={sentQuotes} showCompany /></div>}
      </section>

      {toon !== "offertes" && (
        <section>
          <SectionTitle>Lopende offertes</SectionTitle>
          <div className="card"><QuoteRows rows={sentQuotes} showCompany empty="Geen verstuurde of concept-offertes." /></div>
        </section>
      )}
    </div>
  );
}
