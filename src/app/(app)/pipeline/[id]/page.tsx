import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, SectionTitle } from "@/components/brand";
import { LeadFields, QuoteRows } from "@/components/pipeline-parts";
import { getLead } from "@/lib/data";
import { formatDate, formatShort } from "@/lib/dates";
import { LEAD_STATUS, SERVICE_KIND } from "@/lib/labels";
import { formatEuroRound } from "@/lib/money";
import { getOptions } from "@/lib/options";
import { createQuoteAction, deleteLeadAction, setLeadStatusAction, updateLeadAction } from "@/app/actions";

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [lead, options] = await Promise.all([getLead(id), getOptions()]);
  if (!lead) notFound();
  const accepted = lead.quotes.some((q) => q.status === "accepted");

  return (
    <div className="space-y-10">
      <Link href="/pipeline" className="mb-6 inline-block text-sm text-steen hover:text-nacht">← Pipeline</Link>
      <PageHeader
        eyebrow={[lead.clientName ? "Bestaande klant" : "Nieuwe klant", lead.contactName, lead.source].filter(Boolean).join(" · ")}
        title={lead.clientName ?? lead.companyName}
      >
        <span className="chip">{LEAD_STATUS[lead.status]}</span>
      </PageHeader>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
          <p className="text-lg font-bold text-nacht">{lead.title}</p>
          <p><span className="text-steen">Waarde </span><span className="font-bold tabular-nums text-nacht">{lead.valueCents ? formatEuroRound(lead.valueCents) : "–"}</span></p>
          <p><span className="text-steen">Kans </span><span className="font-bold tabular-nums text-nacht">{lead.probabilityPct}%</span></p>
          {lead.open && <p><span className="text-steen">Gewogen </span><span className="font-bold tabular-nums text-nacht">{formatEuroRound(lead.weightedCents)}</span></p>}
          {lead.closedAt && <p className="text-steen">{LEAD_STATUS[lead.status]} op {formatDate(lead.closedAt)}</p>}
        </div>
        {lead.interests.length > 0 && (
          <div className="flex flex-wrap gap-1">{lead.interests.map((k) => <span key={k} className="chip">{SERVICE_KIND[k as keyof typeof SERVICE_KIND] ?? k}</span>)}</div>
        )}
        {(lead.nextStep || lead.nextStepDate) && lead.open && (
          <p className={`border-l-[3px] pl-3 text-sm ${lead.nextStepDue ? "border-nacht font-bold text-nacht" : "border-lijn text-grafiet"}`}>
            Volgende stap{lead.nextStepDate ? ` (${formatShort(lead.nextStepDate)})` : ""}: {lead.nextStep ?? "–"}
          </p>
        )}
        {(lead.contactEmail || lead.contactPhone) && (
          <p className="text-sm text-steen">
            {lead.contactEmail && <a href={`mailto:${lead.contactEmail}`} className="hover:text-nacht">{lead.contactEmail}</a>}
            {lead.contactEmail && lead.contactPhone && " · "}
            {lead.contactPhone && <a href={`tel:${lead.contactPhone}`} className="hover:text-nacht">{lead.contactPhone}</a>}
          </p>
        )}
        {lead.status === "lost" && lead.lostReason && <p className="text-sm text-steen">Reden: {lead.lostReason}</p>}
        {lead.notes && <p className="whitespace-pre-line text-sm text-grafiet">{lead.notes}</p>}
        {lead.clientId && <Link href={`/klanten/${lead.clientId}`} className="inline-block text-sm text-steen hover:text-nacht">Klantdossier →</Link>}

        <div className="flex flex-wrap gap-2 pt-1">
          {lead.status === "new" && <form action={setLeadStatusAction.bind(null, id, "contact", undefined)}><button className="btn text-xs">In gesprek</button></form>}
          {(lead.status === "won" || lead.status === "lost") && !accepted && (
            <form action={setLeadStatusAction.bind(null, id, "contact", undefined)}><button className="btn text-xs">Heropenen</button></form>
          )}
          {lead.open && (
            <details className="inline-block">
              <summary className="btn-ghost cursor-pointer text-xs">Verloren…</summary>
              <form action={setLeadStatusAction.bind(null, id, "lost")} className="mt-2 flex flex-wrap gap-2">
                <input name="lostReason" placeholder="Reden (optioneel), bijv. te duur, geen tijd" className="input min-w-64" />
                <button className="btn text-xs">Markeer als verloren</button>
              </form>
            </details>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <SectionTitle
          aside={
            !accepted && lead.status !== "lost" ? (
              <form action={createQuoteAction.bind(null, id)}><button className="btn-primary text-xs">Nieuwe offerte</button></form>
            ) : undefined
          }
        >
          Offertes
        </SectionTitle>
        <div className="card"><QuoteRows rows={lead.quotes} empty="Nog geen offerte. Maak er een met de knop hierboven." /></div>
      </section>

      <section>
        <details className="card p-4">
          <summary className="cursor-pointer text-sm font-medium">Lead bewerken</summary>
          <form action={updateLeadAction.bind(null, id)} className="mt-3 space-y-3">
            <LeadFields value={lead} clients={options.clients} />
            <button className="btn">Opslaan</button>
          </form>
          {!accepted && (
            <form action={deleteLeadAction.bind(null, id)} className="mt-3">
              <button className="btn-ghost text-xs">Lead verwijderen (met offertes)</button>
            </form>
          )}
        </details>
      </section>
    </div>
  );
}
