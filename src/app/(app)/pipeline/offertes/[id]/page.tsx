import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, SectionTitle } from "@/components/brand";
import { priceText } from "@/components/agreement-parts";
import { QuoteStatusChip } from "@/components/pipeline-parts";
import { QuoteLineFields } from "@/components/quote-line-fields";
import { findClientByName, getQuote, listWebsites } from "@/lib/data";
import { formatDate, today } from "@/lib/dates";
import { SERVICE_KIND } from "@/lib/labels";
import { formatEuro } from "@/lib/money";
import {
  acceptQuoteAction,
  addQuoteLineAction,
  deleteQuoteAction,
  deleteQuoteLineAction,
  duplicateQuoteAction,
  setQuoteStatusAction,
  updateQuoteAction,
  updateQuoteLineAction,
} from "@/app/actions";

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const q = await getQuote(id);
  if (!q) notFound();
  const clientId = q.clientId ?? q.lead.clientId;
  const sites = clientId ? await listWebsites({ clientId }) : [];
  const domains = [...new Set([...sites.map((s) => s.website.domain), ...q.lines.map((l) => l.domain).filter((d): d is string => !!d)])];
  const editable = q.status !== "accepted";
  const sameName = !clientId ? await findClientByName(q.lead.companyName) : null;
  const existing = sameName && sameName.name.trim().toLowerCase() === q.lead.companyName.trim().toLowerCase() ? sameName : null;
  const company = q.clientName ?? q.lead.companyName;
  const t = today();
  const hasWebsite = q.lines.some((l) => l.kind === "website" && l.pricing === "one_off");
  const newDomains = q.lines.map((l) => l.domain).filter((d): d is string => !!d && !sites.some((s) => s.website.domain === d));

  return (
    <div className="space-y-10">
      <Link href={`/pipeline/${q.leadId}`} className="mb-6 inline-block text-sm text-steen hover:text-nacht">← {company} · {q.lead.title}</Link>
      <PageHeader eyebrow={`Offerte · ${company}`} title={q.number}>
        <QuoteStatusChip status={q.status} />
      </PageHeader>

      <section className="space-y-2">
        {q.title && <p className="text-lg font-bold text-nacht">{q.title}</p>}
        <p className="text-sm text-steen">
          Datum {formatDate(q.quoteDate)}
          {q.validUntil && ` · geldig tot ${formatDate(q.validUntil)}`}
          {q.sentAt && ` · verstuurd ${formatDate(q.sentAt)}`}
          {q.decidedAt && (q.status === "accepted" || q.status === "rejected" || q.status === "expired") && ` · ${q.status === "accepted" ? "akkoord" : q.status === "rejected" ? "afgewezen" : "verlopen"} ${formatDate(q.decidedAt)}`}
        </p>
        {q.url && <a href={q.url} target="_blank" rel="noreferrer" className="inline-block text-sm text-nacht underline">Offertedocument openen</a>}
        {q.notes && <p className="whitespace-pre-line text-sm text-grafiet">{q.notes}</p>}
      </section>

      {/* Regels en totalen */}
      <section className="space-y-3">
        <SectionTitle>Regels</SectionTitle>
        <div className="card">
          {q.lines.length === 0 && <p className="px-3 py-3 text-sm text-steen">Nog geen regels. Voeg hieronder een dienst toe.</p>}
          <ul className="divide-y divide-lijn">
            {q.lines.map((l) => (
              <li key={l.id} className="px-3 py-2 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-grafiet">{l.description || SERVICE_KIND[l.kind]}</p>
                    <p className="text-xs text-steen">
                      {SERVICE_KIND[l.kind]}
                      {l.domain && ` · ${l.domain}`}
                      {l.budgetCents ? ` · budget ${formatEuro(l.budgetCents)}` : ""}
                      {l.sessionsPerMonth ? ` · ${l.sessionsPerMonth} sessies/mnd` : ""}
                      {l.startDate && ` · start ${formatDate(l.startDate)}`}
                      {l.agreementId && clientId && <> · <Link href={`/klanten/${clientId}`} className="hover:text-nacht">afspraak aangemaakt</Link></>}
                    </p>
                  </div>
                  <span className="tabular-nums font-bold text-nacht">{priceText(l)}</span>
                </div>
                {editable && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-steen hover:text-nacht">Bewerken</summary>
                    <form action={updateQuoteLineAction.bind(null, l.id)} className="mt-2 space-y-2">
                      <QuoteLineFields value={l} domains={domains} />
                      <button className="btn">Opslaan</button>
                    </form>
                    <form action={deleteQuoteLineAction.bind(null, l.id)} className="mt-1">
                      <button className="btn-ghost text-xs">Regel verwijderen</button>
                    </form>
                  </details>
                )}
              </li>
            ))}
          </ul>
          {q.lines.length > 0 && (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 border-t-[3px] border-nacht px-3 py-3 text-sm md:grid-cols-4">
              <div><dt className="label">Eenmalig</dt><dd className="font-bold tabular-nums text-nacht">{formatEuro(q.totals.oneOffCents)}</dd></div>
              <div><dt className="label">Per maand (MRR)</dt><dd className="font-bold tabular-nums text-nacht">{formatEuro(q.totals.monthlyCents)}</dd></div>
              <div>
                <dt className="label">Uurwerk</dt>
                <dd className="font-bold tabular-nums text-nacht">{q.totals.hourlyLines ? (q.totals.hourlyBudgetCents ? `${formatEuro(q.totals.hourlyBudgetCents)} budget` : "op uurbasis") : "–"}</dd>
              </div>
              <div><dt className="label">Waarde 1e jaar</dt><dd className="font-bold tabular-nums text-nacht">{formatEuro(q.totals.firstYearCents)}</dd></div>
            </dl>
          )}
        </div>
        {editable && (
          <details className="card p-4" open={q.lines.length === 0}>
            <summary className="cursor-pointer text-sm font-medium">Regel toevoegen</summary>
            <form action={addQuoteLineAction.bind(null, id)} className="mt-3 space-y-3">
              <QuoteLineFields isNew domains={domains} />
              <button className="btn-primary">Toevoegen</button>
            </form>
          </details>
        )}
        <p className="text-xs text-steen">Bedragen excl. btw. Waarde 1e jaar = eenmalig + 12 x maandbedrag + budgetten van uurwerk.</p>
      </section>

      {/* Status en akkoord */}
      {editable && (
        <section className="space-y-3">
          <SectionTitle>Status</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {q.status === "draft" && <form action={setQuoteStatusAction.bind(null, id, "sent")}><button className="btn">Markeer als verstuurd</button></form>}
            {(q.status === "rejected" || q.status === "expired") && <form action={setQuoteStatusAction.bind(null, id, "sent")}><button className="btn">Opnieuw verstuurd</button></form>}
            {q.status === "sent" && <form action={setQuoteStatusAction.bind(null, id, "rejected")}><button className="btn-ghost">Afgewezen</button></form>}
            {q.status !== "draft" && <form action={setQuoteStatusAction.bind(null, id, "draft")}><button className="btn-ghost">Terug naar concept</button></form>}
            <form action={duplicateQuoteAction.bind(null, id)}><button className="btn-ghost">Kopie als nieuwe versie</button></form>
          </div>

          {q.lines.length > 0 && (
            <details className="card border-l-[3px] border-l-nacht p-4">
              <summary className="cursor-pointer font-bold text-nacht">Akkoord van de klant verwerken</summary>
              <div className="mt-3 space-y-3 text-sm">
                <p>Met één klik gebeurt het volgende:</p>
                <ul className="list-disc space-y-1 pl-5 text-grafiet">
                  <li>{clientId || existing ? <>Klant <b>{company}</b>{existing ? " (bestaat al)" : ""} wordt (of blijft) actief.</> : <>Nieuwe klant <b>{company}</b> (actief, klant sinds vandaag{q.lead.contactName ? `, contactpersoon ${q.lead.contactName}` : ""}).</>}</li>
                  {newDomains.length > 0 && <li>Nieuwe website{newDomains.length > 1 ? "s" : ""}: {[...new Set(newDomains)].join(", ")}.</li>}
                  <li>{q.lines.length} afspra{q.lines.length > 1 ? "ken" : "ak"} (actief): {q.lines.map((l) => l.description || SERVICE_KIND[l.kind]).join(", ")}.</li>
                  {hasWebsite && <li>Websiteproject, en 2 termijnen van 50%: de eerste staat direct klaar om te factureren.</li>}
                  {q.lines.some((l) => l.pricing === "one_off" && l.kind !== "website") && <li>Overig eenmalig werk: 1 termijn bij oplevering.</li>}
                  <li>Lead op gewonnen{q.lead.status !== "won" ? "" : " (al gewonnen)"}; andere open offertes van deze lead worden afgewezen.</li>
                  {q.url && <li>Link naar het offertedocument bij de documenten van de klant.</li>}
                </ul>
                <form action={acceptQuoteAction.bind(null, id)} className="flex flex-wrap items-end gap-3">
                  <label className="block">
                    <span className="label">Startdatum afspraken</span>
                    <input type="date" name="startDate" defaultValue={t} className="input" />
                  </label>
                  <button className="btn-primary">Akkoord: maak klant, afspraken en termijn</button>
                </form>
                <p className="text-xs text-steen">Regels met een eigen startdatum houden die datum.</p>
              </div>
            </details>
          )}
        </section>
      )}

      {q.status === "accepted" && clientId && (
        <section className="space-y-2">
          <SectionTitle>Verwerkt</SectionTitle>
          <p className="text-sm text-grafiet">
            Akkoord op {formatDate(q.decidedAt)}. Afspraken, termijnen en eventuele projecten staan in het{" "}
            <Link href={`/klanten/${clientId}`} className="font-bold text-nacht underline">klantdossier van {company}</Link>
            {" "}en bij <Link href="/afspraken" className="font-bold text-nacht underline">Afspraken</Link>.
          </p>
          <form action={duplicateQuoteAction.bind(null, id)}><button className="btn-ghost">Kopie als nieuwe offerte</button></form>
        </section>
      )}

      <section>
        <details className="card p-4">
          <summary className="cursor-pointer text-sm font-medium">Offertegegevens bewerken</summary>
          <form action={updateQuoteAction.bind(null, id)} className="mt-3 space-y-3">
            <div className="grid gap-3 md:grid-cols-4">
              <label className="block md:col-span-2"><span className="label">Titel</span><input name="title" defaultValue={q.title ?? ""} className="input w-full" /></label>
              <label className="block"><span className="label">Datum</span><input type="date" name="quoteDate" defaultValue={q.quoteDate} className="input w-full" /></label>
              <label className="block"><span className="label">Geldig tot</span><input type="date" name="validUntil" defaultValue={q.validUntil ?? ""} className="input w-full" /></label>
            </div>
            <label className="block"><span className="label">Link naar het document (OneDrive, Drive)</span><input name="url" type="url" defaultValue={q.url ?? ""} placeholder="https://" className="input w-full" /></label>
            <textarea name="notes" rows={3} defaultValue={q.notes ?? ""} placeholder="Notitie (uitgangspunten, wat niet inbegrepen is)" className="input w-full" />
            <button className="btn">Opslaan</button>
          </form>
          {editable && (
            <form action={deleteQuoteAction.bind(null, id, q.leadId)} className="mt-3">
              <button className="btn-ghost text-xs">Offerte verwijderen</button>
            </form>
          )}
        </details>
      </section>
    </div>
  );
}
