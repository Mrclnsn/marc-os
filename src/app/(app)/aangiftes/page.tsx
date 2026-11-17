import Link from "next/link";
import { PageHeader, SectionTitle } from "@/components/brand";
import { FilingRows, NewFilingForm } from "@/components/filing-parts";
import { filingOverview, listFilings } from "@/lib/data";
import { FILING_EXTENSION, FILING_FREQUENCY, FILING_WARNING_DAYS } from "@/lib/labels";
import { formatDate, today } from "@/lib/dates";
import { getOptions } from "@/lib/options";

function Kpi({ value, label, sub }: { value: string | number; label: string; sub?: string }) {
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
  { key: "lopend", label: "Lopende perioden" },
  { key: "ingediend", label: "Ingediend" },
  { key: "afgerond", label: "Afgerond" },
  { key: "instellingen", label: "Instellingen" },
] as const;

export default async function FilingsPage({ searchParams }: { searchParams: Promise<{ toon?: string; jaar?: string }> }) {
  const { toon, jaar } = await searchParams;
  const year = Number(jaar) || Number(today().slice(0, 4));
  const [overview, options, doneRows] = await Promise.all([
    filingOverview(),
    getOptions(),
    toon === "afgerond" ? listFilings({ status: ["done"], year }) : Promise.resolve([]),
  ]);
  const { open, counts } = overview;
  const toWork = open.filter((f) => f.state !== "running");
  const running = open.filter((f) => f.state === "running");
  const urgentIds = new Set([...overview.overdue, ...overview.dueSoon].map((f) => f.id));
  const docsMissing = overview.docsMissing.filter((f) => !urgentIds.has(f.id));
  const rest = toWork.filter((f) => !urgentIds.has(f.id) && !docsMissing.some((d) => d.id === f.id));

  return (
    <div className="space-y-10">
      <PageHeader eyebrow="Zakelijk · boekhoudklanten" title="Aangiftes">
        <div className="flex flex-wrap gap-4">
          {TABS.map((tab) => (
            <Link key={tab.label} href={tab.key ? `/aangiftes?toon=${tab.key}` : "/aangiftes"} className={toon === tab.key ? "tab-active" : "tab"}>
              {tab.label}
            </Link>
          ))}
        </div>
      </PageHeader>

      <div className="grid grid-cols-2 gap-6 md:grid-cols-5">
        <Kpi value={counts.open} label="Te doen" sub={`${counts.waitingDocs} wacht op stukken`} />
        <Kpi value={overview.overdue.length + overview.dueSoon.length} label="Deadline < 14 dagen" sub={overview.overdue.length ? `${overview.overdue.length} te laat` : "niets te laat"} />
        <Kpi value={overview.docsMissing.length} label="Stukken ontbreken" />
        <Kpi value={counts.filed} label="Ingediend" sub="wacht op betaling of teruggave" />
        <Kpi value={counts.doneThisYear} label="Afgerond dit jaar" />
      </div>

      {overview.bookkeepingWithoutSchedule.length > 0 && (
        <p className="border-l-[3px] border-nacht pl-3 text-sm">
          Boekhoudklant zonder aangiftes:{" "}
          {overview.bookkeepingWithoutSchedule.map((c, n) => (
            <span key={c.clientId}>{n > 0 ? ", " : ""}<Link href={`/klanten/${c.clientId}#aangiftes`} className="font-bold text-nacht hover:underline">{c.clientName}</Link></span>
          ))}
          . Stel ze in bij de klant.
        </p>
      )}

      {!toon && (
        <>
          {(overview.overdue.length > 0 || overview.dueSoon.length > 0) && (
            <section>
              <SectionTitle>Deadline binnen {FILING_WARNING_DAYS} dagen</SectionTitle>
              <div className="card"><FilingRows rows={[...overview.overdue, ...overview.dueSoon]} /></div>
            </section>
          )}
          {docsMissing.length > 0 && (
            <section>
              <SectionTitle>Stukken nog niet binnen</SectionTitle>
              <div className="card"><FilingRows rows={docsMissing} /></div>
            </section>
          )}
          <section>
            <SectionTitle>Overige open aangiftes</SectionTitle>
            <div className="card"><FilingRows rows={rest} empty="Geen andere open aangiftes over afgelopen perioden." /></div>
          </section>
          {running.length > 0 && (
            <section>
              <SectionTitle aside={<Link href="/aangiftes?toon=lopend" className="text-xs text-steen hover:text-nacht">Alle lopende</Link>}>Komend (periode loopt nog)</SectionTitle>
              <div className="card"><FilingRows rows={running.slice(0, 6)} /></div>
            </section>
          )}
          <NewFilingForm clients={options.clients} />
        </>
      )}

      {toon === "lopend" && (
        <section>
          <SectionTitle>Perioden die nog lopen</SectionTitle>
          <div className="card"><FilingRows rows={running} empty="Geen lopende perioden." /></div>
        </section>
      )}

      {toon === "ingediend" && (
        <section>
          <SectionTitle>Ingediend, nog niet afgerond</SectionTitle>
          <div className="card"><FilingRows rows={overview.awaitingPayment} empty="Niets dat wacht op betaling of teruggave." /></div>
        </section>
      )}

      {toon === "afgerond" && (
        <section>
          <SectionTitle
            aside={
              <span className="flex gap-3 text-xs">
                <Link href={`/aangiftes?toon=afgerond&jaar=${year - 1}`} className="text-steen hover:text-nacht">← {year - 1}</Link>
                <Link href={`/aangiftes?toon=afgerond&jaar=${year + 1}`} className="text-steen hover:text-nacht">{year + 1} →</Link>
              </span>
            }
          >
            Afgerond over {year}
          </SectionTitle>
          <div className="card"><FilingRows rows={doneRows} empty={`Nog niets afgerond over ${year}.`} /></div>
        </section>
      )}

      {toon === "instellingen" && (
        <section>
          <SectionTitle>Aangiftes per klant</SectionTitle>
          {overview.schedules.length === 0 ? (
            <p className="text-sm text-steen">Nog niets ingesteld. Bij een nieuwe boekhoudafspraak komen btw per kwartaal en IB of Vpb er automatisch bij.</p>
          ) : (
            <div className="card divide-y divide-lijn">
              {overview.schedules.map((s) => (
                <Link key={s.id} href={`/klanten/${s.clientId}#aangiftes`} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2 text-sm hover:bg-parel">
                  <span><span className="font-bold text-nacht">{s.clientName}</span> · {s.title}</span>
                  <span className="text-xs text-steen">
                    {FILING_FREQUENCY[s.frequency]}
                    {s.extension !== "none" ? ` · ${FILING_EXTENSION[s.extension].toLowerCase()}` : ""} · vanaf {formatDate(s.startDate)}
                    {s.endDate ? ` tot ${formatDate(s.endDate)}` : ""}
                    {!s.active ? " · gepauzeerd" : ""}
                  </span>
                </Link>
              ))}
            </div>
          )}
          <p className="mt-2 text-xs text-steen">Instellen en wijzigen doe je in het klantdossier, onder Aangiftes.</p>
        </section>
      )}
    </div>
  );
}
