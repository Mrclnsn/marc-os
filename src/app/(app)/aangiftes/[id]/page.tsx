import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, SectionTitle } from "@/components/brand";
import { FILING_NEXT, FilingStatusChip, amountText } from "@/components/filing-parts";
import { Field } from "@/components/forms";
import { filingReminder, getFiling, getTask } from "@/lib/data";
import { daysBetween, formatDate, today } from "@/lib/dates";
import { FILING_STATUS } from "@/lib/labels";
import { centsToInput } from "@/lib/money";
import {
  deleteFilingAction,
  filingDocsReceivedAction,
  filingDocsRequestedAction,
  setFilingStatusAction,
  updateFilingAction,
} from "../../../actions";

function Line({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-steen">{label}</span>
      <span className="text-right text-grafiet">{value || "–"}</span>
    </div>
  );
}

export default async function FilingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const f = await getFiling(id);
  if (!f) notFound();
  const [reminder, task] = await Promise.all([filingReminder(id), f.taskId ? getTask(f.taskId) : Promise.resolve(null)]);
  const t = today();
  const days = daysBetween(t, f.deadline);
  const open = !["filed", "done"].includes(f.status);
  const next = FILING_NEXT[f.status];

  return (
    <div className="space-y-10">
      <Link href="/aangiftes" className="mb-6 inline-block text-sm text-steen hover:text-nacht">← Aangiftes</Link>
      <PageHeader
        eyebrow={<Link href={`/klanten/${f.clientId}#aangiftes`} className="hover:text-nacht">{f.clientName}</Link>}
        title={f.title}
      >
        <FilingStatusChip f={f} />
      </PageHeader>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-6">
          <p>
            <span className="block text-3xl font-bold leading-none text-nacht tabular-nums">{formatDate(f.deadline)}</span>
            <span className="mt-2 block text-xs uppercase tracking-wider text-steen">
              Deadline{open ? (days < 0 ? ` · ${-days} dagen te laat` : days === 0 ? " · vandaag" : ` · over ${days} dagen`) : ""}
              {f.deadlineManual ? " · zelf aangepast" : ""}
            </span>
          </p>
          {amountText(f.amountCents) && (
            <p>
              <span className="block text-3xl font-bold leading-none text-nacht tabular-nums">{amountText(f.amountCents)}</span>
              <span className="mt-2 block text-xs uppercase tracking-wider text-steen">Uitkomst</span>
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {f.status === "todo" && (
            <form action={filingDocsRequestedAction.bind(null, f.id)}><button className="btn">Stukken opgevraagd</button></form>
          )}
          {!f.docsReceivedAt && open && (
            <form action={filingDocsReceivedAction.bind(null, f.id)}><button className="btn">Stukken binnen</button></form>
          )}
          {next && (
            <form action={setFilingStatusAction.bind(null, f.id, next.to)}><button className="btn-primary">{next.label}</button></form>
          )}
        </div>
      </section>

      <div className="grid gap-10 md:grid-cols-2">
        <section>
          <SectionTitle>Verloop</SectionTitle>
          <div className="divide-y divide-lijn">
            <Line label="Periode" value={`${formatDate(f.periodStart)} t/m ${formatDate(f.periodEnd)}`} />
            <Line label="Status" value={FILING_STATUS[f.status]} />
            <Line label="Stukken uiterlijk" value={formatDate(f.docsDueDate)} />
            <Line label="Stukken opgevraagd" value={formatDate(f.docsRequestedAt)} />
            <Line label="Stukken binnen" value={formatDate(f.docsReceivedAt)} />
            <Line label="Ingediend" value={formatDate(f.filedAt)} />
            <Line label="Afgerond" value={formatDate(f.doneAt)} />
            <Line label="Kenmerk" value={f.reference} />
            <Line
              label="Taak"
              value={task ? <Link href={`/taken/${task.id}`} className="hover:text-nacht">{task.status === "done" ? "afgerond" : "open"} · {task.title}</Link> : null}
            />
          </div>
          {f.notes && <p className="mt-3 whitespace-pre-line text-sm text-steen">{f.notes}</p>}
        </section>

        {open ? (
        <section>
          <SectionTitle>Stukken opvragen</SectionTitle>
          <p className="mb-2 text-sm text-steen">
            {reminder.to ? <>Aan {reminder.contactName ? `${reminder.contactName} ` : ""}&lt;{reminder.to}&gt;</> : "Geen e-mailadres bij de klant. Voeg een contactpersoon met e-mail toe."}
          </p>
          <p className="text-sm font-bold text-nacht">{reminder.subject}</p>
          <textarea readOnly defaultValue={reminder.body} rows={14} className="input mt-1 w-full font-[inherit] text-sm" />
          <div className="mt-2 flex flex-wrap gap-2">
            {reminder.mailto && <a href={reminder.mailto} className="btn">Open in mail</a>}
            {f.status === "todo" && (
              <form action={filingDocsRequestedAction.bind(null, f.id)}><button className="btn-ghost text-xs">Markeer als opgevraagd</button></form>
            )}
          </div>
        </section>
        ) : (
          <section>
            <SectionTitle>Uitkomst</SectionTitle>
            <p className="text-sm text-grafiet">
              {amountText(f.amountCents) ? `${amountText(f.amountCents)}.` : "Nog geen uitkomst ingevuld."}{" "}
              {f.status === "filed" ? "Zet op afgerond zodra er betaald of ontvangen is." : ""}
            </p>
          </section>
        )}
      </div>

      <section>
        <SectionTitle>Bewerken</SectionTitle>
        {/* key: na een statusknop opnieuw opbouwen, anders blijven de oude waarden in het formulier staan */}
        <form key={f.updatedAt.toISOString()} action={updateFilingAction.bind(null, f.id)} className="grid gap-2 md:grid-cols-4">
          <Field label="Status">
            <select name="status" defaultValue={f.status} className="input w-full">
              {Object.entries(FILING_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Deadline"><input type="date" name="deadline" required defaultValue={f.deadline} className="input w-full" /></Field>
          <Field label="Stukken uiterlijk"><input type="date" name="docsDueDate" defaultValue={f.docsDueDate ?? ""} className="input w-full" /></Field>
          <Field label="Stukken opgevraagd"><input type="date" name="docsRequestedAt" defaultValue={f.docsRequestedAt ?? ""} className="input w-full" /></Field>
          <Field label="Stukken binnen"><input type="date" name="docsReceivedAt" defaultValue={f.docsReceivedAt ?? ""} className="input w-full" /></Field>
          <Field label="Ingediend op"><input type="date" name="filedAt" defaultValue={f.filedAt ?? ""} className="input w-full" /></Field>
          <Field label="Afgerond op"><input type="date" name="doneAt" defaultValue={f.doneAt ?? ""} className="input w-full" /></Field>
          <Field label="Kenmerk"><input name="reference" defaultValue={f.reference ?? ""} placeholder="Betalingskenmerk" className="input w-full" /></Field>
          <Field label="Uitkomst (excl. teken)"><input name="amount" inputMode="decimal" defaultValue={f.amountCents != null ? centsToInput(Math.abs(f.amountCents)) : ""} placeholder="Bedrag" className="input w-full" /></Field>
          <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="refund" defaultChecked={(f.amountCents ?? 0) < 0} className="h-4 w-4 accent-[var(--nacht)]" /> Terug te ontvangen</label>
          <Field label="Notitie" className="md:col-span-2"><input name="notes" defaultValue={f.notes ?? ""} className="input w-full" /></Field>
          <div className="md:col-span-4"><button className="btn-primary">Opslaan</button></div>
        </form>
        <p className="mt-2 text-xs text-steen">Een zelf aangepaste deadline blijft staan als je later het uitstel bij de klant wijzigt.</p>
      </section>

      {!f.scheduleId && (
        <form action={deleteFilingAction.bind(null, f.id, "/aangiftes")} className="border-t border-lijn pt-4">
          <button className="btn-ghost text-xs">Losse aangifte verwijderen (de open taak gaat mee)</button>
        </form>
      )}
    </div>
  );
}
