import Link from "next/link";
import type { FilingRow, FilingState, ScheduleRow } from "@/lib/filings";
import { formatDate, formatShort } from "@/lib/dates";
import {
  FILING_EXTENSION,
  FILING_FREQUENCIES,
  FILING_FREQUENCY,
  FILING_KIND,
  FILING_STATUS,
  type FilingKind,
  type FilingStatus,
} from "@/lib/labels";
import { formatEuro } from "@/lib/money";
import {
  createFilingAction,
  createScheduleAction,
  deleteScheduleAction,
  filingDocsReceivedAction,
  setFilingStatusAction,
  updateScheduleAction,
} from "@/app/actions";
import { Field, type Option } from "./forms";

/* ---------------- Status en signalen ---------------- */

const STATE_TEXT: Record<FilingState, string | null> = {
  overdue: "Te laat",
  due_soon: "Deadline nadert",
  docs_missing: "Stukken ontbreken",
  running: "Periode loopt",
  ok: null,
  closed: null,
};

/** Statuschip; "te laat" en "deadline nadert" vallen op (Nacht), de rest is rustig. */
export function FilingStatusChip({ f }: { f: Pick<FilingRow, "status" | "state"> }) {
  const strong = f.state === "overdue" || f.state === "due_soon";
  return <span className={`chip ${strong ? "bg-nacht text-white" : ""}`}>{STATE_TEXT[f.state] ?? FILING_STATUS[f.status]}</span>;
}

/** De logische volgende stap per status. */
export const FILING_NEXT: Partial<Record<FilingStatus, { to: FilingStatus; label: string }>> = {
  todo: { to: "in_progress", label: "In behandeling" },
  in_progress: { to: "review", label: "Klaar voor controle" },
  review: { to: "filed", label: "Ingediend" },
  filed: { to: "done", label: "Afgerond" },
};

/** "Uitkomst: € 1.234 te betalen" of "€ 210 terug". */
export function amountText(cents: number | null | undefined) {
  if (cents == null) return null;
  if (cents === 0) return "nihil";
  return cents > 0 ? `${formatEuro(cents)} te betalen` : `${formatEuro(-cents)} terug`;
}

function detailText(f: FilingRow) {
  if (f.status === "done") return `afgerond ${formatDate(f.doneAt)}`;
  if (f.status === "filed") return `ingediend ${formatDate(f.filedAt)}`;
  const parts = [];
  if (f.state === "running") parts.push(`periode loopt tot ${formatDate(f.periodEnd)}`);
  if (f.docsReceivedAt) parts.push(`stukken binnen ${formatDate(f.docsReceivedAt)}`);
  else if (f.docsRequestedAt) parts.push(`stukken opgevraagd ${formatDate(f.docsRequestedAt)}`);
  else if (f.docsDueDate && f.state !== "running") parts.push(`stukken uiterlijk ${formatDate(f.docsDueDate)}`);
  return parts.join(" · ");
}

/** Lijst met aangiftes: titel, klant, deadline, status en één knop voor de volgende stap. */
export function FilingRows({ rows, showClient = true, empty = "Geen aangiftes." }: { rows: FilingRow[]; showClient?: boolean; empty?: string }) {
  if (rows.length === 0) return <p className="px-3 py-3 text-sm text-steen">{empty}</p>;
  return (
    <ul className="divide-y divide-lijn">
      {rows.map((f) => {
        const next = f.state === "running" ? undefined : FILING_NEXT[f.status];
        const urgent = f.state === "overdue" || f.state === "due_soon";
        const waiting = f.status === "waiting_docs";
        return (
          <li key={f.id} className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm ${urgent ? "border-l-[3px] border-l-nacht" : ""}`}>
            <Link href={`/aangiftes/${f.id}`} className="min-w-0 flex-1 basis-64 hover:text-nacht">
              <p className={f.status === "done" ? "text-steen" : "font-medium text-grafiet"}>
                {showClient && <span className="font-bold text-nacht">{f.clientName} · </span>}
                {f.title}
              </p>
              <p className="text-xs text-steen">
                {f.status === "done" || f.status === "filed" ? FILING_STATUS[f.status] : `${FILING_STATUS[f.status]} · deadline ${formatShort(f.deadline)}`}
                {detailText(f) ? ` · ${detailText(f)}` : ""}
                {amountText(f.amountCents) ? ` · ${amountText(f.amountCents)}` : ""}
              </p>
            </Link>
            <div className="flex items-center gap-2">
              <FilingStatusChip f={f} />
              {waiting ? (
                <form action={filingDocsReceivedAction.bind(null, f.id)}><button className="btn text-xs">Stukken binnen</button></form>
              ) : next ? (
                <form action={setFilingStatusAction.bind(null, f.id, next.to)}><button className="btn text-xs">{next.label}</button></form>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------------- Instellingen ---------------- */

function KindSelect({ value, name = "kind" }: { value?: string; name?: string }) {
  return (
    <select name={name} defaultValue={value ?? "vat"} className="input w-full">
      {Object.entries(FILING_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
    </select>
  );
}

function FrequencySelect({ value, kind }: { value?: string; kind?: FilingKind }) {
  const allowed = kind ? FILING_FREQUENCIES[kind] : (["quarter", "month", "year"] as const);
  return (
    <select name="frequency" defaultValue={value ?? ""} className="input w-full">
      {!kind && <option value="">Standaard voor de soort</option>}
      {allowed.map((k) => <option key={k} value={k}>{FILING_FREQUENCY[k]}</option>)}
    </select>
  );
}

function ExtensionSelect({ value }: { value?: string }) {
  return (
    <select name="extension" defaultValue={value ?? "none"} className="input w-full">
      {Object.entries(FILING_EXTENSION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
    </select>
  );
}

function scheduleText(s: ScheduleRow) {
  const parts: string[] = [FILING_FREQUENCY[s.frequency]];
  if (s.extension !== "none") parts.push(FILING_EXTENSION[s.extension].toLowerCase());
  parts.push(`vanaf ${formatDate(s.startDate)}`);
  if (s.endDate) parts.push(`tot ${formatDate(s.endDate)}`);
  if (!s.createTasks) parts.push("zonder taken");
  return parts.join(" · ");
}

/** Welke aangiftes Marc voor de klant doet (btw, IB, Vpb...), met bewerken en toevoegen. */
export function ScheduleList({ clientId, schedules, agreements }: { clientId: string; schedules: ScheduleRow[]; agreements: Option[] }) {
  return (
    <div className="space-y-2">
      {schedules.length === 0 && <p className="text-sm text-steen">Nog geen aangiftes ingesteld voor deze klant.</p>}
      {schedules.length > 0 && (
        <div className="card divide-y divide-lijn">
          {schedules.map((s) => (
            <div key={s.id} className={`px-3 py-2 text-sm ${s.active ? "" : "text-steen"}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p><span className={s.active ? "font-bold text-nacht" : "font-bold"}>{s.title}</span> <span className="text-xs text-steen">{scheduleText(s)}</span></p>
                {!s.active && <span className="chip">Gepauzeerd</span>}
              </div>
              <details className="mt-1">
                <summary className="cursor-pointer text-xs text-steen hover:text-nacht">Bewerken</summary>
                <form key={s.updatedAt.toISOString()} action={updateScheduleAction.bind(null, s.id)} className="mt-2 grid gap-2 md:grid-cols-4">
                  <input type="hidden" name="_flags" value="1" />
                  <Field label="Soort"><KindSelect value={s.kind} /></Field>
                  <Field label="Frequentie"><FrequencySelect value={s.frequency} kind={s.kind} /></Field>
                  <Field label="Uitstel (IB/Vpb)"><ExtensionSelect value={s.extension} /></Field>
                  <Field label="Eigen naam"><input name="label" defaultValue={s.label ?? ""} placeholder="Bij overig" className="input w-full" /></Field>
                  <Field label="Vanaf (periode waarin deze datum valt)"><input type="date" name="startDate" required defaultValue={s.startDate} className="input w-full" /></Field>
                  <Field label="Tot en met"><input type="date" name="endDate" defaultValue={s.endDate ?? ""} className="input w-full" /></Field>
                  <Field label="Stukken binnen (dagen na periode)"><input type="number" min={0} name="docsDueDays" defaultValue={s.docsDueDays ?? ""} placeholder="Standaard" className="input w-full" /></Field>
                  <Field label="Afspraak">
                    <select name="agreementId" defaultValue={s.agreementId ?? ""} className="input w-full">
                      <option value="">Geen</option>
                      {agreements.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </Field>
                  <div className="flex flex-wrap items-center gap-4 md:col-span-4">
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="createTasks" defaultChecked={s.createTasks} className="h-4 w-4 accent-[var(--nacht)]" /> Taak per aangifte</label>
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={s.active} className="h-4 w-4 accent-[var(--nacht)]" /> Actief</label>
                    <input name="notes" defaultValue={s.notes ?? ""} placeholder="Notitie" className="input flex-1" />
                    <button className="btn">Opslaan</button>
                  </div>
                </form>
                <p className="mt-1 text-xs text-steen">Andere soort of frequentie: aangiftes waar nog niets aan gedaan is worden opnieuw opgebouwd. Ander uitstel: deadlines van open aangiftes schuiven mee.</p>
                <form action={deleteScheduleAction.bind(null, s.id)} className="mt-1">
                  <button className="btn-ghost text-xs">Verwijderen (aangiftes waar al aan gewerkt is blijven bewaard)</button>
                </form>
              </details>
            </div>
          ))}
        </div>
      )}
      <details className="card p-4">
        <summary className="cursor-pointer text-sm font-medium">Aangifte instellen</summary>
        <form action={createScheduleAction.bind(null, clientId)} className="mt-3 grid gap-2 md:grid-cols-4">
          <Field label="Soort"><KindSelect /></Field>
          <Field label="Frequentie"><FrequencySelect /></Field>
          <Field label="Uitstel (IB/Vpb)"><ExtensionSelect /></Field>
          <Field label="Vanaf"><input type="date" name="startDate" className="input w-full" /></Field>
          <Field label="Eigen naam" className="md:col-span-2"><input name="label" placeholder="Alleen bij overig, bijv. Suppletie" className="input w-full" /></Field>
          <Field label="Afspraak">
            <select name="agreementId" defaultValue={agreements[0]?.id ?? ""} className="input w-full">
              <option value="">Geen</option>
              {agreements.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          <div className="flex items-end"><button className="btn-primary">Toevoegen</button></div>
        </form>
        <p className="mt-2 text-xs text-steen">Leeg &quot;vanaf&quot; = de huidige periode. Kies een eerdere datum om ook oudere perioden op te nemen.</p>
      </details>
    </div>
  );
}

/** Losse aangifte buiten de vaste cyclus (bijv. een suppletie of een oud jaar). */
export function NewFilingForm({ clients, clientId }: { clients: Option[]; clientId?: string }) {
  return (
    <details className="card p-4">
      <summary className="cursor-pointer text-sm font-medium">Losse aangifte toevoegen</summary>
      <form action={createFilingAction} className="mt-3 grid gap-2 md:grid-cols-4">
        {clientId ? (
          <input type="hidden" name="clientId" value={clientId} />
        ) : (
          <Field label="Klant">
            <select name="clientId" required defaultValue="" className="input w-full">
              <option value="" disabled>Kies een klant</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Soort"><KindSelect /></Field>
        <Field label="Frequentie"><FrequencySelect /></Field>
        <Field label="Periode (een datum erin)"><input type="date" name="periodStart" required className="input w-full" /></Field>
        <Field label="Eigen naam"><input name="label" placeholder="Bijv. Suppletie btw" className="input w-full" /></Field>
        <Field label="Deadline"><input type="date" name="deadline" className="input w-full" /></Field>
        <Field label="Notitie" className="md:col-span-2"><input name="notes" className="input w-full" /></Field>
        <div className="flex items-end"><button className="btn-primary">Toevoegen</button></div>
      </form>
      <p className="mt-2 text-xs text-steen">Leeg = de wettelijke deadline voor die soort en periode. Er komt meteen een taak bij.</p>
    </details>
  );
}
