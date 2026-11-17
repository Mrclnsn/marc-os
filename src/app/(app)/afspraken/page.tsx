import Link from "next/link";
import { PageHeader, SectionTitle } from "@/components/brand";
import { AgreementCard, InstallmentRows, NewAgreementForm } from "@/components/agreement-parts";
import { listAgreements, listInstallments, listWebsites, revenueOverview } from "@/lib/data";
import { formatDate } from "@/lib/dates";
import { AGREEMENT_WARNING_DAYS, SERVICE_KIND } from "@/lib/labels";
import { formatEuro, formatEuroRound } from "@/lib/money";
import { getOptions } from "@/lib/options";

const monthName = new Intl.DateTimeFormat("nl-NL", { month: "short", year: "2-digit" });

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
  { key: undefined, label: "Lopend" },
  { key: "concept", label: "Concept" },
  { key: "beeindigd", label: "Beëindigd" },
  { key: "alle", label: "Alle" },
] as const;

export default async function AgreementsPage({ searchParams }: { searchParams: Promise<{ toon?: string }> }) {
  const { toon } = await searchParams;
  const status =
    toon === "concept" ? (["draft"] as const) : toon === "beeindigd" ? (["ended"] as const) : toon === "alle" ? undefined : (["active", "cancelled"] as const);

  const [overview, rows, installments, sites, options] = await Promise.all([
    revenueOverview(),
    listAgreements({ status: status ? [...status] : undefined }),
    listInstallments(),
    listWebsites(),
    getOptions(),
  ]);
  const ready = installments.filter((i) => i.status === "ready");
  const invoiced = installments.filter((i) => i.status === "draft" || i.status === "sent");
  const planned = installments.filter((i) => i.status === "planned");
  const websiteOpts = sites.map(({ website, clientName }) => ({ id: website.id, name: `${website.domain} (${clientName})` }));
  const maxMonth = Math.max(1, ...overview.forecast.map((m) => m.totalCents));

  return (
    <div className="space-y-10">
      <PageHeader eyebrow="Zakelijk · bedragen excl. btw" title="Afspraken" />

      <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
        <Kpi value={formatEuroRound(overview.mrrCents)} label="MRR" sub={`${overview.activeRecurring} vaste afspraken`} />
        <Kpi value={formatEuroRound(overview.arrCents)} label="Jaaromzet vast" sub="MRR x 12" />
        <Kpi value={formatEuroRound(overview.ready.cents)} label="Klaar om te factureren" sub={`${overview.ready.count} termijnen`} />
        <Kpi value={formatEuroRound(overview.invoicedOpen.cents)} label="Gefactureerd, open" sub={`${overview.invoicedOpen.count} termijnen`} />
      </div>

      {ready.length > 0 && (
        <section>
          <SectionTitle>Klaar om te factureren</SectionTitle>
          <div className="card"><InstallmentRows rows={ready} showClient /></div>
        </section>
      )}

      {overview.ending.length > 0 && (
        <section>
          <SectionTitle>Eindigt binnen {AGREEMENT_WARNING_DAYS} dagen</SectionTitle>
          <ul className="space-y-2">
            {overview.ending.map((a) => (
              <li key={a.id}>
                <Link href={`/klanten/${a.clientId}`} className="block border-l-[3px] border-nacht pl-3 hover:bg-parel">
                  <span className="block text-[15px] font-bold text-nacht">{a.label}</span>
                  <span className="block text-xs text-steen">{a.clientName} · tot {formatDate(a.endDate)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-10 lg:grid-cols-2">
        <section>
          <SectionTitle aside={<span className="text-xs text-steen">wat er per maand gefactureerd wordt</span>}>Verwachte omzet</SectionTitle>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-steen">
                <th className="py-1 font-normal">Maand</th>
                <th className="py-1 text-right font-normal">Vast</th>
                <th className="py-1 text-right font-normal">Termijnen</th>
                <th className="py-1 text-right font-normal">Totaal</th>
                <th className="w-1/3 py-1" aria-hidden />
              </tr>
            </thead>
            <tbody className="divide-y divide-lijn">
              {overview.forecast.map((m) => (
                <tr key={m.month} title={`${monthName.format(new Date(m.month))}: ${formatEuro(m.totalCents)}`}>
                  <td className="py-1.5 capitalize">{monthName.format(new Date(m.month))}</td>
                  <td className="py-1.5 text-right tabular-nums text-steen">{formatEuroRound(m.recurringCents)}</td>
                  <td className="py-1.5 text-right tabular-nums text-steen">{m.installmentsCents ? formatEuroRound(m.installmentsCents) : "–"}</td>
                  <td className="py-1.5 text-right font-bold tabular-nums text-nacht">{formatEuroRound(m.totalCents)}</td>
                  <td className="py-1.5 pl-3" aria-hidden>
                    <div className="h-2 rounded-r-[4px] bg-nacht" style={{ width: `${(m.totalCents / maxMonth) * 100}%` }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-steen">
            Eerste maand inclusief achterstallige en klaarstaande termijnen. Kwartaalafspraken in jan/apr/jul/okt, jaarafspraken in de startmaand.
            {overview.undatedInstallmentsCents > 0 && ` Plus ${formatEuroRound(overview.undatedInstallmentsCents)} aan termijnen zonder datum (bij akkoord of oplevering).`}
            {overview.hourly.length > 0 && ` Uurtarief-afspraken tellen hier niet mee (${overview.hourly.length}); die volgen uit de uren.`}
          </p>
        </section>

        <section className="space-y-8">
          <div>
            <SectionTitle>MRR per dienst</SectionTitle>
            <dl className="divide-y divide-lijn text-sm">
              {overview.byKind.length === 0 && <p className="text-steen">Nog geen lopende vaste afspraken.</p>}
              {overview.byKind.map((k) => (
                <div key={k.kind} className="flex justify-between py-1.5">
                  <dt>{SERVICE_KIND[k.kind]} <span className="text-steen">({k.count})</span></dt>
                  <dd className="tabular-nums font-bold text-nacht">{formatEuro(k.mrrCents)}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div>
            <SectionTitle>Per klant</SectionTitle>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-steen">
                  <th className="py-1 font-normal">Klant</th>
                  <th className="py-1 text-right font-normal">MRR</th>
                  <th className="py-1 text-right font-normal">Open termijnen</th>
                  <th className="py-1 text-right font-normal">Betaald dit jaar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-lijn">
                {overview.byClient.map((c) => (
                  <tr key={c.clientId}>
                    <td className="py-1.5"><Link href={`/klanten/${c.clientId}`} className="hover:text-nacht">{c.clientName}</Link></td>
                    <td className="py-1.5 text-right tabular-nums">{formatEuro(c.mrrCents)}</td>
                    <td className="py-1.5 text-right tabular-nums">{c.openInstallmentsCents ? formatEuro(c.openInstallmentsCents) : "–"}</td>
                    <td className="py-1.5 text-right tabular-nums">{c.paidThisYearCents ? formatEuro(c.paidThisYearCents) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="space-y-3">
        <SectionTitle
          aside={
            <div className="flex gap-4">
              {TABS.map((t) => (
                <Link key={t.label} href={t.key ? `/afspraken?toon=${t.key}` : "/afspraken"} className={toon === t.key ? "tab-active" : "tab"}>{t.label}</Link>
              ))}
            </div>
          }
        >
          Alle afspraken
        </SectionTitle>
        {rows.length === 0 && <p className="text-sm text-steen">Geen afspraken in deze weergave.</p>}
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((a) => (
            <AgreementCard
              key={a.id}
              a={a}
              showClient
              installments={installments.filter((i) => i.agreementId === a.id)}
              websites={websiteOpts.filter((w) => sites.find((s) => s.website.id === w.id)?.website.clientId === a.clientId)}
              projects={options.projects.filter((p) => p.clientId === a.clientId)}
            />
          ))}
        </div>
        <NewAgreementForm clients={options.clients} websites={websiteOpts} projects={options.projects} />
      </section>

      {(invoiced.length > 0 || planned.length > 0) && (
        <section className="grid gap-10 lg:grid-cols-2">
          <div>
            <SectionTitle>Gefactureerd, nog niet betaald</SectionTitle>
            <div className="card"><InstallmentRows rows={invoiced} showClient empty="Niets openstaand." /></div>
          </div>
          <div>
            <SectionTitle>Gepland</SectionTitle>
            <div className="card"><InstallmentRows rows={planned} showClient empty="Niets gepland." /></div>
          </div>
        </section>
      )}
    </div>
  );
}
