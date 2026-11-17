import Link from "next/link";
import type { BillingGroup, BudgetStatus, TimeEntryRow, WeekSummary } from "@/lib/time";
import { clockTime } from "@/lib/time";
import { formatDate, formatShort } from "@/lib/dates";
import { formatDuration, formatHours } from "@/lib/duration";
import { TIME_CATEGORIES } from "@/lib/labels";
import { formatEuro } from "@/lib/money";
import {
  continueTimeEntryAction,
  deleteTimeEntryAction,
  invoiceHoursAction,
  logTimeAction,
  setHoursInvoicedAction,
  startTimerAction,
  updateTimeEntryAction,
} from "@/app/actions";
import { AreaSelect, ClientSelect, ProjectSelect, type Option } from "./forms";
import { Elapsed } from "./timer";

/* ---------------- Invoer ---------------- */

function Datalists({ descriptions }: { descriptions: string[] }) {
  return (
    <>
      <datalist id="time-categories">
        {TIME_CATEGORIES.map((c) => <option key={c} value={c} />)}
      </datalist>
      <datalist id="time-descriptions">
        {descriptions.map((d) => <option key={d} value={d} />)}
      </datalist>
    </>
  );
}

function BillableSelect({ value }: { value?: boolean | null }) {
  return (
    <select name="billable" defaultValue={value == null ? "auto" : value ? "ja" : "nee"} className="input" aria-label="Declarabel">
      {value == null && <option value="auto">Declarabel: automatisch</option>}
      <option value="ja">Declarabel</option>
      <option value="nee">Niet declarabel</option>
    </select>
  );
}

/** Timer starten: omschrijving plus optioneel klant, project en soort werk. */
export function StartTimerForm({ clients, projects, descriptions, clientId, projectId }: { clients: Option[]; projects: Option[]; descriptions: string[]; clientId?: string; projectId?: string }) {
  return (
    <form action={startTimerAction} className="card grid gap-2 p-3 md:grid-cols-[1fr_180px_200px_auto]">
      <Datalists descriptions={descriptions} />
      <input name="description" list="time-descriptions" placeholder="Waar werk je aan?" className="input" autoComplete="off" />
      <ClientSelect clients={clients} value={clientId} />
      <ProjectSelect projects={projects} value={projectId} />
      <button className="btn-primary">▶ Start timer</button>
      <details className="md:col-span-4">
        <summary className="cursor-pointer text-xs text-steen hover:text-nacht">Meer: gebied, soort werk, declarabel</summary>
        <div className="mt-2 grid gap-2 md:grid-cols-3">
          <AreaSelect />
          <input name="category" list="time-categories" placeholder="Soort werk, bijv. Leren" className="input" />
          <BillableSelect />
        </div>
      </details>
    </form>
  );
}

/** Uren achteraf schrijven: duur (1:30, 1,5 of 90m) of begin- en eindtijd. */
export function ManualTimeForm({ clients, projects, descriptions, today, clientId, projectId }: { clients: Option[]; projects: Option[]; descriptions: string[]; today: string; clientId?: string; projectId?: string }) {
  return (
    <details className="card p-4">
      <summary className="cursor-pointer text-sm font-medium">Uren handmatig toevoegen</summary>
      <form action={logTimeAction} className="mt-3 grid gap-2 md:grid-cols-4">
        <Datalists descriptions={descriptions} />
        <input name="description" list="time-descriptions" placeholder="Omschrijving" className="input md:col-span-2" autoComplete="off" />
        <label className="block"><span className="label">Datum</span><input type="date" name="entryDate" defaultValue={today} className="input w-full" required /></label>
        <label className="block"><span className="label">Duur</span><input name="duration" placeholder="1:30, 1,5 of 90m" className="input w-full" inputMode="decimal" /></label>
        <label className="block"><span className="label">Of van</span><input type="time" name="startTime" className="input w-full" /></label>
        <label className="block"><span className="label">tot</span><input type="time" name="endTime" className="input w-full" /></label>
        <label className="block"><span className="label">Klant</span><ClientSelect clients={clients} value={clientId} /></label>
        <label className="block"><span className="label">Project</span><ProjectSelect projects={projects} value={projectId} /></label>
        <AreaSelect />
        <input name="category" list="time-categories" placeholder="Soort werk" className="input" />
        <BillableSelect />
        <div><button className="btn">Toevoegen</button></div>
      </form>
    </details>
  );
}

/* ---------------- Registraties ---------------- */

function entryMeta(e: TimeEntryRow, showClient: boolean) {
  return [
    showClient ? e.clientName ?? (e.area === "prive" ? "Privé" : "Bedrijf algemeen") : null,
    e.projectName,
    e.category,
    e.billable ? (e.invoiced ? "gefactureerd" : "declarabel") : null,
  ].filter(Boolean) as string[];
}

function EntryEdit({ e, clients, projects }: { e: TimeEntryRow; clients: Option[]; projects: Option[] }) {
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-xs text-steen hover:text-nacht">Bewerken</summary>
      <form action={updateTimeEntryAction.bind(null, e.id)} className="mt-2 grid gap-2 md:grid-cols-4">
        {!e.running && (
          <>
            <input type="hidden" name="origDuration" value={formatDuration(e.durationMin)} />
            <input type="hidden" name="origStart" value={clockTime(e.startedAt)} />
            <input type="hidden" name="origEnd" value={clockTime(e.endedAt)} />
          </>
        )}
        <input name="description" defaultValue={e.description ?? ""} list="time-descriptions" placeholder="Omschrijving" className="input md:col-span-2" />
        <label className="block"><span className="label">Datum</span><input type="date" name="entryDate" defaultValue={e.entryDate} className="input w-full" /></label>
        {!e.running && (
          <label className="block"><span className="label">Duur</span><input name="duration" defaultValue={formatDuration(e.durationMin)} className="input w-full" /></label>
        )}
        {!e.running && (
          <>
            <label className="block"><span className="label">Van</span><input type="time" name="startTime" defaultValue={clockTime(e.startedAt)} className="input w-full" /></label>
            <label className="block"><span className="label">Tot</span><input type="time" name="endTime" defaultValue={clockTime(e.endedAt)} className="input w-full" /></label>
          </>
        )}
        <label className="block"><span className="label">Klant</span><ClientSelect clients={clients} value={e.clientId} /></label>
        <label className="block"><span className="label">Project</span><ProjectSelect projects={projects} value={e.projectId} /></label>
        <AreaSelect value={e.area} />
        <input name="category" defaultValue={e.category ?? ""} list="time-categories" placeholder="Soort werk" className="input" />
        <BillableSelect value={e.billable} />
        <select name="invoiced" defaultValue={e.invoiced ? "ja" : "nee"} className="input" aria-label="Gefactureerd">
          <option value="nee">Nog niet gefactureerd</option>
          <option value="ja">Gefactureerd</option>
        </select>
        <div className="md:col-span-4"><button className="btn">Opslaan</button></div>
      </form>
      <form action={deleteTimeEntryAction.bind(null, e.id)} className="mt-1">
        <button className="btn-ghost text-xs">Registratie verwijderen</button>
      </form>
    </details>
  );
}

export function EntryRow({ e, clients, projects, showClient = true }: { e: TimeEntryRow; clients: Option[]; projects: Option[]; showClient?: boolean }) {
  const meta = entryMeta(e, showClient);
  const range = e.startedAt ? `${clockTime(e.startedAt)}${e.endedAt ? `–${clockTime(e.endedAt)}` : ""}` : null;
  return (
    <li className={`px-3 py-2 text-sm ${e.running ? "border-l-[3px] border-l-nacht" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-grafiet">{e.description || <span className="text-steen">Geen omschrijving</span>}</p>
          <p className="text-xs text-steen">
            {[range, ...meta].filter(Boolean).join(" · ")}
            {e.agreementLabel && e.rateCents != null && <> · {e.agreementLabel} à {formatEuro(e.rateCents)}</>}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {e.running ? <Elapsed since={e.startedAt!.toISOString()} className="font-bold text-nacht" /> : <span className="font-bold tabular-nums text-nacht">{formatDuration(e.minutes)}</span>}
          {!e.running && (
            <form action={continueTimeEntryAction.bind(null, e.id)}>
              <button className="btn-ghost text-xs" title="Verder met deze registratie (nieuwe timer)">▶</button>
            </form>
          )}
        </div>
      </div>
      <EntryEdit e={e} clients={clients} projects={projects} />
    </li>
  );
}

/** Registraties per dag, met dagtotaal. */
export function EntriesByDay({ entries, clients, projects, showClient = true, descriptions = [] }: { entries: TimeEntryRow[]; clients: Option[]; projects: Option[]; showClient?: boolean; descriptions?: string[] }) {
  if (entries.length === 0) return <p className="text-sm text-steen">Nog geen uren geschreven.</p>;
  const days = new Map<string, TimeEntryRow[]>();
  for (const e of entries) days.set(e.entryDate, [...(days.get(e.entryDate) ?? []), e]);
  return (
    <div className="space-y-4">
      <Datalists descriptions={descriptions} />
      {[...days.entries()].map(([day, list]) => (
        <div key={day}>
          <div className="mb-1 flex items-baseline justify-between px-1 text-xs uppercase tracking-wider text-steen">
            <span>{formatShort(day)} · {formatDate(day)}</span>
            <span className="tabular-nums">{formatDuration(list.reduce((s, e) => s + e.minutes, 0))}</span>
          </div>
          <ul className="card divide-y divide-lijn">
            {list.map((e) => <EntryRow key={e.id} e={e} clients={clients} projects={projects} showClient={showClient} />)}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Compacte lijst (dossier, project): laatste registraties zonder bewerken. */
export function RecentEntries({ entries, empty = "Nog geen uren geschreven." }: { entries: TimeEntryRow[]; empty?: string }) {
  if (entries.length === 0) return <p className="text-sm text-steen">{empty}</p>;
  return (
    <ul className="divide-y divide-lijn text-sm">
      {entries.map((e) => (
        <li key={e.id} className="flex items-baseline justify-between gap-3 py-1.5">
          <span className="min-w-0 truncate">
            <span className="text-steen">{formatShort(e.entryDate)} · </span>
            {e.description || <span className="text-steen">Geen omschrijving</span>}
            {e.billable && <span className="text-steen"> · declarabel</span>}
          </span>
          <span className="shrink-0 font-bold tabular-nums text-nacht">{e.running ? <Elapsed since={e.startedAt!.toISOString()} /> : formatDuration(e.minutes)}</span>
        </li>
      ))}
    </ul>
  );
}

/* ---------------- Weekoverzicht ---------------- */

const dayName = new Intl.DateTimeFormat("nl-NL", { weekday: "short" });

export function WeekGrid({ week, today }: { week: WeekSummary; today: string }) {
  if (week.rows.length === 0) return <p className="text-sm text-steen">Deze week nog geen uren.</p>;
  const cell = (min: number) => (min ? formatDuration(min) : "–");
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-steen">
            <th className="py-1 font-normal">Klant / gebied</th>
            {week.days.map((d) => (
              <th key={d} className={`hidden py-1 text-right font-normal md:table-cell ${d === today ? "font-bold text-nacht" : ""}`}>{dayName.format(new Date(`${d}T12:00:00`))}</th>
            ))}
            <th className="py-1 text-right font-normal">Totaal</th>
            <th className="py-1 text-right font-normal">Declarabel</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-lijn">
          {week.rows.map((r) => (
            <tr key={r.key}>
              <td className="py-1.5">
                {r.clientId ? <Link href={`/klanten/${r.clientId}`} className="hover:text-nacht">{r.label}</Link> : <span className="text-steen">{r.label}</span>}
              </td>
              {r.days.map((m, i) => (
                <td key={i} className={`hidden py-1.5 text-right tabular-nums md:table-cell ${m ? "" : "text-steen"}`}>{cell(m)}</td>
              ))}
              <td className="py-1.5 text-right font-bold tabular-nums text-nacht">{formatDuration(r.total)}</td>
              <td className="py-1.5 text-right tabular-nums text-steen">{r.billable ? formatDuration(r.billable) : "–"}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-nacht">
            <td className="py-1.5 font-bold text-nacht">Totaal</td>
            {week.dayTotals.map((m, i) => (
              <td key={i} className="hidden py-1.5 text-right tabular-nums md:table-cell">{cell(m)}</td>
            ))}
            <td className="py-1.5 text-right font-bold tabular-nums text-nacht">{formatDuration(week.total)}</td>
            <td className="py-1.5 text-right font-bold tabular-nums text-nacht">{formatDuration(week.billable)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/* ---------------- Budget en facturatie ---------------- */

/** Budgetbalk bij maatwerk: besteed (declarabele uren x tarief) tegenover het budget. */
export function BudgetLine({ b, showClient = false }: { b: BudgetStatus; showClient?: boolean }) {
  return (
    <div className={`py-2 ${b.warning ? "border-l-[3px] border-nacht pl-3" : ""}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="min-w-0">
          <span className="font-bold text-nacht">{b.label}</span>
          {showClient && <> · <Link href={`/klanten/${b.clientId}`} className="text-steen hover:text-nacht">{b.clientName}</Link></>}
        </span>
        <span className="tabular-nums text-grafiet">
          {formatHours(b.minutes)}
          {b.budgetCents ? <> · {formatEuro(b.usedCents)} van {formatEuro(b.budgetCents)} <span className={b.warning ? "font-bold text-nacht" : "text-steen"}>({b.pct}%)</span></> : <> · {formatEuro(b.usedCents)} <span className="text-steen">(geen budget)</span></>}
        </span>
      </div>
      {b.budgetCents ? (
        <div className="mt-1.5 h-1.5 w-full bg-parel" aria-hidden>
          <div className={`h-1.5 ${b.over ? "bg-nacht" : b.warning ? "bg-nacht" : "bg-grafiet/60"}`} style={{ width: `${Math.min(100, b.pct ?? 0)}%` }} />
        </div>
      ) : null}
      {b.over && <p className="mt-1 text-xs font-bold text-nacht">Budget overschreden</p>}
      {b.warning && !b.over && <p className="mt-1 text-xs text-nacht">Meer dan 80% van het budget besteed</p>}
    </div>
  );
}

/** Declarabele uren die nog gefactureerd moeten worden. */
export function BillingQueue({ groups, showClient = true }: { groups: BillingGroup[]; showClient?: boolean }) {
  if (groups.length === 0) return <p className="px-3 py-3 text-sm text-steen">Geen declarabele uren open.</p>;
  return (
    <ul className="divide-y divide-lijn">
      {groups.map((g) => (
        <li key={g.agreementId ?? `zonder-${g.clientId}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
          <div className="min-w-0">
            <p className="font-medium text-grafiet">
              {showClient && g.clientId ? <Link href={`/klanten/${g.clientId}`} className="hover:text-nacht">{g.clientName}</Link> : showClient ? "Zonder klant" : null}
              {showClient && " · "}
              {g.agreementLabel ?? <span className="text-steen">geen afspraak met uurtarief</span>}
            </p>
            <p className="text-xs text-steen">
              {formatHours(g.minutes)} · {formatDate(g.from)}{g.to !== g.from ? ` t/m ${formatDate(g.to)}` : ""}
              {g.rateCents != null && ` · à ${formatEuro(g.rateCents)}`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {g.amountCents != null && <span className="font-bold tabular-nums text-nacht">{formatEuro(g.amountCents)}</span>}
            {g.agreementId ? (
              <form action={invoiceHoursAction.bind(null, g.agreementId)}>
                <button className="btn text-xs" title="Maakt één termijn 'klaar om te factureren' en markeert de uren als gefactureerd">Klaarzetten voor factuur</button>
              </form>
            ) : (
              <form action={setHoursInvoicedAction.bind(null, g.entryIds, true)}>
                <button className="btn-ghost text-xs" title="Bijv. als je ze buiten Marc OS hebt gefactureerd">Markeer als gefactureerd</button>
              </form>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
