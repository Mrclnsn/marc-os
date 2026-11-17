import Link from "next/link";
import type { Lead } from "@/db/schema";
import type { LeadRow, QuoteRow, QuoteTotals, QuoteWithLines } from "@/lib/pipeline";
import { formatDate, formatShort, today } from "@/lib/dates";
import { CLIENT_SOURCES, LEAD_STATUS, QUOTE_STATUS, SERVICE_KIND, type QuoteStatus, type ServiceKind } from "@/lib/labels";
import { centsToInput, formatEuro, formatEuroRound } from "@/lib/money";
import { createLeadAction } from "@/app/actions";
import { Field, SuggestInput, type Option } from "./forms";

/* ---------------- Bedragen ---------------- */

/** "€ 2.400 eenmalig · € 45 / mnd · uurtarief" */
export function totalsText(t: QuoteTotals) {
  const parts: string[] = [];
  if (t.oneOffCents) parts.push(`${formatEuro(t.oneOffCents)} eenmalig`);
  if (t.monthlyCents) parts.push(`${formatEuro(t.monthlyCents)} / mnd`);
  if (t.hourlyLines) parts.push(t.hourlyBudgetCents ? `${formatEuro(t.hourlyBudgetCents)} budget uurwerk` : "uurtarief");
  return parts.join(" · ") || "Nog geen regels";
}

export function QuoteStatusChip({ status }: { status: QuoteStatus }) {
  const strong = status === "sent" || status === "accepted";
  return <span className={`chip ${strong ? "bg-nacht text-white" : ""}`}>{QUOTE_STATUS[status]}</span>;
}

/* ---------------- Leads ---------------- */

function nextStepText(l: Pick<Lead, "nextStep" | "nextStepDate">) {
  if (!l.nextStep && !l.nextStepDate) return null;
  return [l.nextStepDate ? formatShort(l.nextStepDate) : null, l.nextStep].filter(Boolean).join(": ");
}

/** Kaart op het bord: bedrijf, onderwerp, waarde, kans en volgende stap. */
export function LeadCard({ l }: { l: LeadRow }) {
  const step = nextStepText(l);
  const overdue = l.nextStepDate && l.nextStepDate < today();
  return (
    <Link href={`/pipeline/${l.id}`} className={`card block p-3 transition-colors hover:border-nacht ${l.nextStepDue ? "border-l-[3px] border-l-nacht" : ""}`}>
      <p className="font-bold leading-snug text-nacht">{l.clientName ?? l.companyName}</p>
      <p className="text-sm text-grafiet">{l.title}</p>
      <p className="mt-1 text-xs text-steen tabular-nums">
        {l.valueCents ? `${formatEuroRound(l.valueCents)} · ` : ""}{l.probabilityPct}% kans
        {l.quotes.length > 0 && ` · ${l.quotes.length} offerte${l.quotes.length > 1 ? "s" : ""}`}
      </p>
      {step && <p className={`mt-1 text-xs ${overdue ? "font-bold text-nacht" : "text-steen"}`}>{step}</p>}
    </Link>
  );
}

/** Regel in een lijst (gewonnen, verloren, klantdossier). */
export function LeadLine({ l }: { l: LeadRow }) {
  return (
    <li>
      <Link href={`/pipeline/${l.id}`} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2 text-sm hover:bg-parel">
        <span className="min-w-0">
          <span className="font-medium text-grafiet">{l.clientName ?? l.companyName}</span>
          <span className="text-steen"> · {l.title}</span>
          {l.status === "lost" && l.lostReason && <span className="block text-xs text-steen">{l.lostReason}</span>}
        </span>
        <span className="flex items-center gap-3 text-xs text-steen">
          <span className="chip">{LEAD_STATUS[l.status]}</span>
          {l.closedAt && formatDate(l.closedAt)}
          {l.valueCents ? <span className="tabular-nums font-bold text-nacht">{formatEuroRound(l.valueCents)}</span> : null}
        </span>
      </Link>
    </li>
  );
}

/** Velden van een lead (nieuw en bewerken). */
export function LeadFields({ value, clients }: { value?: Partial<Lead>; clients: Option[] }) {
  const interests = new Set(value?.interests ?? []);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Onderwerp">
          <input name="title" required defaultValue={value?.title ?? ""} placeholder="Bijv. Nieuwe website met webshop" className="input w-full" />
        </Field>
        <Field label="Bedrijf (nieuwe klant)">
          <input name="companyName" defaultValue={value?.clientId ? "" : (value?.companyName ?? "")} placeholder="Bedrijfsnaam" className="input w-full" />
        </Field>
        <Field label="Of bestaande klant">
          <select name="clientId" defaultValue={value?.clientId ?? ""} className="input w-full">
            <option value="">Nieuwe klant</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Contactpersoon">
          <input name="contactName" defaultValue={value?.contactName ?? ""} className="input w-full" />
        </Field>
        <Field label="E-mail">
          <input name="contactEmail" type="email" defaultValue={value?.contactEmail ?? ""} className="input w-full" />
        </Field>
        <Field label="Telefoon">
          <input name="contactPhone" type="tel" defaultValue={value?.contactPhone ?? ""} className="input w-full" />
        </Field>
        <Field label="Bron">
          <SuggestInput name="source" value={value?.source} options={CLIENT_SOURCES} listId={`lead-source-${value?.id ?? "new"}`} placeholder="Hoe binnengekomen" />
        </Field>
      </div>
      <div>
        <span className="label">Interesse</span>
        <input type="hidden" name="interestsField" value="1" />
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {(Object.keys(SERVICE_KIND) as ServiceKind[]).map((k) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="interests" value={k} defaultChecked={interests.has(k)} className="h-4 w-4 accent-[var(--nacht)]" />
              {SERVICE_KIND[k]}
            </label>
          ))}
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Geschatte waarde (1e jaar, excl. btw)">
          <input name="estimatedValue" inputMode="decimal" defaultValue={centsToInput(value?.estimatedValueCents)} placeholder="€" className="input w-full" />
        </Field>
        <Field label="Kans (%)">
          <input name="probabilityPct" type="number" min={0} max={100} defaultValue={value?.probabilityPct ?? ""} placeholder="volgt de status" className="input w-full" />
        </Field>
        <Field label="Volgende stap">
          <input name="nextStep" defaultValue={value?.nextStep ?? ""} placeholder="Bijv. Bellen over offerte" className="input w-full" />
        </Field>
        <Field label="Datum volgende stap">
          <input type="date" name="nextStepDate" defaultValue={value?.nextStepDate ?? ""} className="input w-full" />
        </Field>
      </div>
      <textarea name="notes" rows={2} defaultValue={value?.notes ?? ""} placeholder="Notities (wensen, budget, wie beslist)" className="input w-full" />
    </div>
  );
}

export function NewLeadForm({ clients, clientId, open = false }: { clients: Option[]; clientId?: string; open?: boolean }) {
  return (
    <details className="card p-4" open={open}>
      <summary className="cursor-pointer text-sm font-medium">Nieuwe lead</summary>
      <form action={createLeadAction} className="mt-3 space-y-3">
        <LeadFields clients={clients} value={clientId ? { clientId } : undefined} />
        <button className="btn-primary">Lead toevoegen</button>
      </form>
    </details>
  );
}

/* ---------------- Offertes ---------------- */

export function QuoteRows({ rows, showCompany = false, empty = "Geen offertes." }: { rows: (QuoteWithLines | QuoteRow)[]; showCompany?: boolean; empty?: string }) {
  if (rows.length === 0) return <p className="px-3 py-3 text-sm text-steen">{empty}</p>;
  const t = today();
  return (
    <ul className="divide-y divide-lijn">
      {rows.map((q) => (
        <li key={q.id}>
          <Link href={`/pipeline/offertes/${q.id}`} className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-parel ${q.status === "sent" ? "border-l-[3px] border-l-nacht" : ""}`}>
            <span className="min-w-0">
              <span className="font-medium text-grafiet">{q.number}</span>
              {showCompany && "companyName" in q && <span className="text-grafiet"> · {q.companyName}</span>}
              {q.title && <span className="text-steen"> · {q.title}</span>}
              <span className="block text-xs text-steen">
                {totalsText(q.totals)}
                {q.status === "sent" && q.validUntil && ` · geldig tot ${formatDate(q.validUntil)}${q.validUntil < t ? " (verlopen)" : ""}`}
                {q.decidedAt && q.status !== "sent" && q.status !== "draft" && ` · ${QUOTE_STATUS[q.status].toLowerCase()} ${formatDate(q.decidedAt)}`}
              </span>
            </span>
            <span className="flex items-center gap-3">
              <span className="tabular-nums font-bold text-nacht">{formatEuroRound(q.totals.firstYearCents)}</span>
              <QuoteStatusChip status={q.status} />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
