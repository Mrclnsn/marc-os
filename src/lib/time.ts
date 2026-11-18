import "server-only";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { agreements, clients, installments, projects, tasks, timeEntries, type Agreement, type TimeEntry } from "@/db/schema";
import { createInstallment, agreementLabel } from "./agreements";
import { TIMEZONE, addDaysIso, daysBetween, formatDate, today, weekStart } from "./dates";
import { formatDuration, hoursValue } from "./duration";
import { formatEuro, perMonth } from "./money";
import { BUDGET_WARNING_PCT } from "./labels";

/* ------------------------------------------------------------------ */
/* Invoer                                                              */
/* ------------------------------------------------------------------ */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Gebruik YYYY-MM-DD");
const hhmm = z.string().regex(/^\d{1,2}:\d{2}$/, "Gebruik UU:MM");
const optId = z.string().uuid().nullable().optional();
const optText = z.string().nullable().optional();

export const timeEntryInput = z.object({
  area: z.enum(["zakelijk", "prive"]).optional(),
  clientId: optId,
  projectId: optId,
  taskId: optId,
  agreementId: optId,
  category: optText,
  description: optText,
  entryDate: isoDate.optional(), // standaard vandaag
  durationMin: z.number().int().min(1).max(24 * 60).nullable().optional(),
  startTime: hhmm.nullable().optional(), // begintijd op entryDate (handmatig)
  endTime: hhmm.nullable().optional(), // eindtijd; samen met begintijd bepaalt dit de duur
  billable: z.boolean().nullable().optional(), // leeg = automatisch (ja bij een uurtarief-afspraak)
  invoiced: z.boolean().optional(),
});
export type TimeEntryInput = z.infer<typeof timeEntryInput>;

/* ------------------------------------------------------------------ */
/* Tijd en tijdzone                                                    */
/* ------------------------------------------------------------------ */

/** Verschil (ms) tussen de ingestelde tijdzone en UTC op moment `d`. */
function tzOffset(d: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(d.getTime() / 1000) * 1000;
}

/** "2026-11-17" + "09:30" in de ingestelde tijdzone → Date. */
export function zonedDate(iso: string, time: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  const [h, min] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, min);
  const first = guess - tzOffset(new Date(guess));
  return new Date(guess - tzOffset(new Date(first)));
}

const clock = new Intl.DateTimeFormat("nl-NL", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit" });
/** Date → "09:30" in de ingestelde tijdzone. */
export function clockTime(d: Date | null | undefined): string {
  return d ? clock.format(d) : "";
}

/** Datum (YYYY-MM-DD) van een moment in de ingestelde tijdzone. */
function zonedIso(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(d);
}

/** Minuten van een registratie; bij een lopende timer tot nu. */
export function entryMinutes(e: Pick<TimeEntry, "durationMin" | "startedAt">, now = Date.now()): number {
  if (e.durationMin != null) return e.durationMin;
  if (e.startedAt) return Math.max(0, Math.floor((now - e.startedAt.getTime()) / 60000));
  return 0;
}

/* ------------------------------------------------------------------ */
/* Koppelingen afleiden                                                */
/* ------------------------------------------------------------------ */

/** Lopende of concept-afspraken met uurtarief, voor een project of klant. */
async function hourlyAgreements(filter: { projectId?: string; clientId?: string }) {
  const conds = [eq(agreements.pricing, "hourly"), inArray(agreements.status, ["active", "cancelled", "draft"])];
  if (filter.projectId) conds.push(eq(agreements.projectId, filter.projectId));
  if (filter.clientId) conds.push(eq(agreements.clientId, filter.clientId));
  return db.select().from(agreements).where(and(...conds)).orderBy(sql`case ${agreements.status} when 'active' then 0 when 'cancelled' then 1 else 2 end`);
}

/**
 * Vult de koppelingen aan:
 * - taak → project, klant en gebied; project → klant en gebied; klant → zakelijk;
 * - afspraak: bij een project de uurtarief-afspraak van dat project, anders de enige lopende uurtarief-afspraak van de klant;
 * - declarabel (als niet opgegeven): ja als de uren onder een uurtarief-afspraak vallen.
 */
async function resolve<T extends Partial<TimeEntryInput>>(input: T, current?: TimeEntry): Promise<T & { billable?: boolean }> {
  const out: T & { billable?: boolean | null } = { ...input };
  if (out.taskId) {
    const [t] = await db.select().from(tasks).where(eq(tasks.id, out.taskId));
    if (t) {
      if (out.projectId === undefined) out.projectId = t.projectId;
      if (out.clientId === undefined) out.clientId = t.clientId;
      if (out.area === undefined) out.area = t.area;
      if (out.description === undefined || out.description === null) out.description = t.title;
    }
  }
  if (out.projectId) {
    const [p] = await db.select().from(projects).where(eq(projects.id, out.projectId));
    if (p) {
      if (p.clientId) out.clientId = p.clientId; // project van een klant: die klant
      else if (out.clientId === undefined) out.clientId = null;
      if (out.area === undefined) out.area = p.area;
    }
  }
  if (out.clientId && out.area === undefined && !current) out.area = "zakelijk";

  // Afspraak afleiden als klant of project verandert en er geen afspraak is opgegeven
  const linksChanged = out.clientId !== undefined || out.projectId !== undefined;
  if (out.agreementId === undefined && (linksChanged || !current)) {
    const projectId = out.projectId !== undefined ? out.projectId : current?.projectId;
    const clientId = out.clientId !== undefined ? out.clientId : current?.clientId;
    let found: Agreement | undefined;
    if (projectId) found = (await hourlyAgreements({ projectId }))[0];
    if (!found && clientId) {
      const list = await hourlyAgreements({ clientId });
      const running = list.filter((a) => a.status !== "draft" && !a.projectId);
      if (running.length === 1) found = running[0];
      else if (list.length === 1 && !list[0].projectId) found = list[0];
    }
    out.agreementId = found?.id ?? null;
  }

  // Afspraak moet bij de klant horen; anders klant overnemen van de afspraak
  if (out.agreementId) {
    const [a] = await db.select().from(agreements).where(eq(agreements.id, out.agreementId));
    if (a) {
      const clientId = out.clientId !== undefined ? out.clientId : current?.clientId;
      if (!clientId) out.clientId = a.clientId;
      else if (clientId !== a.clientId) out.agreementId = null;
      if (out.billable == null && out.agreementId) out.billable = a.pricing === "hourly";
    }
  }
  if (out.billable == null) {
    if (current && out.agreementId === undefined) delete out.billable;
    else out.billable = false;
  }
  return out as T & { billable?: boolean };
}

/** Datum, begin, eind en duur uit de invoer. */
function timing(data: TimeEntryInput, current?: TimeEntry) {
  const out: Partial<Pick<TimeEntry, "entryDate" | "startedAt" | "endedAt" | "durationMin">> = {};
  const date = data.entryDate ?? current?.entryDate ?? today();
  if (data.entryDate !== undefined) out.entryDate = data.entryDate;
  if (data.startTime) {
    const start = zonedDate(date, data.startTime);
    out.startedAt = start;
    if (data.endTime) {
      let end = zonedDate(date, data.endTime);
      if (end <= start) end = new Date(end.getTime() + 24 * 3600 * 1000); // over middernacht
      out.endedAt = end;
      out.durationMin = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000));
    } else {
      const min = data.durationMin ?? current?.durationMin;
      if (data.durationMin) out.durationMin = data.durationMin;
      if (min) out.endedAt = new Date(start.getTime() + min * 60000);
    }
  } else if (data.durationMin !== undefined && data.durationMin !== null) {
    out.durationMin = data.durationMin;
    if (data.startTime === null) Object.assign(out, { startedAt: null, endedAt: null });
    else if (current?.startedAt) out.endedAt = new Date(current.startedAt.getTime() + data.durationMin * 60000);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Lezen                                                               */
/* ------------------------------------------------------------------ */

export type TimeEntryRow = TimeEntry & {
  clientName: string | null;
  projectName: string | null;
  taskTitle: string | null;
  agreementLabel: string | null;
  rateCents: number | null; // uurtarief van de afspraak
  minutes: number; // bij een lopende timer tot nu
  running: boolean;
};

const rowSelect = {
  e: timeEntries,
  clientName: clients.name,
  projectName: projects.name,
  taskTitle: tasks.title,
  a: { kind: agreements.kind, title: agreements.title, pricing: agreements.pricing, amountCents: agreements.amountCents },
};

type RawRow = { e: TimeEntry; clientName: string | null; projectName: string | null; taskTitle: string | null; a: { kind: Agreement["kind"] | null; title: string | null; pricing: Agreement["pricing"] | null; amountCents: number | null } | null };

function toRow(r: RawRow, now = Date.now()): TimeEntryRow {
  const a = r.a?.kind ? r.a : null;
  return {
    ...r.e,
    clientName: r.clientName,
    projectName: r.projectName,
    taskTitle: r.taskTitle,
    agreementLabel: a ? agreementLabel({ kind: a.kind!, title: a.title }) : null,
    rateCents: a?.pricing === "hourly" ? a.amountCents : null,
    minutes: entryMinutes(r.e, now),
    running: r.e.durationMin == null && r.e.startedAt != null,
  };
}

function baseQuery() {
  return db
    .select(rowSelect)
    .from(timeEntries)
    .leftJoin(clients, eq(timeEntries.clientId, clients.id))
    .leftJoin(projects, eq(timeEntries.projectId, projects.id))
    .leftJoin(tasks, eq(timeEntries.taskId, tasks.id))
    .leftJoin(agreements, eq(timeEntries.agreementId, agreements.id));
}

export type TimeFilter = {
  from?: string;
  to?: string;
  clientId?: string;
  projectId?: string;
  agreementId?: string;
  area?: "zakelijk" | "prive";
  billable?: boolean;
  uninvoiced?: boolean;
  limit?: number;
};

export async function listTimeEntries(filter: TimeFilter = {}): Promise<TimeEntryRow[]> {
  const conds = [];
  if (filter.from) conds.push(gte(timeEntries.entryDate, filter.from));
  if (filter.to) conds.push(lte(timeEntries.entryDate, filter.to));
  if (filter.clientId) conds.push(eq(timeEntries.clientId, filter.clientId));
  if (filter.projectId) conds.push(eq(timeEntries.projectId, filter.projectId));
  if (filter.agreementId) conds.push(eq(timeEntries.agreementId, filter.agreementId));
  if (filter.area) conds.push(eq(timeEntries.area, filter.area));
  if (filter.billable !== undefined) conds.push(eq(timeEntries.billable, filter.billable));
  if (filter.uninvoiced) conds.push(eq(timeEntries.invoiced, false));
  const q = baseQuery()
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(timeEntries.entryDate), sql`${timeEntries.startedAt} desc nulls last`, desc(timeEntries.createdAt));
  const rows = filter.limit ? await q.limit(filter.limit) : await q;
  const now = Date.now();
  return rows.map((r) => toRow(r, now));
}

export async function getTimeEntry(id: string): Promise<TimeEntryRow | null> {
  const [r] = await baseQuery().where(eq(timeEntries.id, id));
  return r ? toRow(r) : null;
}

/** De lopende timer, of null. */
export async function getRunningTimer(): Promise<TimeEntryRow | null> {
  const [r] = await baseQuery()
    .where(and(isNull(timeEntries.durationMin), isNotNull(timeEntries.startedAt)))
    .orderBy(desc(timeEntries.startedAt))
    .limit(1);
  return r ? toRow(r) : null;
}

/* ------------------------------------------------------------------ */
/* Schrijven                                                           */
/* ------------------------------------------------------------------ */

function cleanFields(data: TimeEntryInput) {
  const { startTime, endTime, durationMin, entryDate, ...rest } = data;
  void startTime; void endTime; void durationMin; void entryDate;
  return rest;
}

/** Handmatig uren schrijven: duur, of begin- en eindtijd. */
export async function logTime(input: TimeEntryInput) {
  const data = timeEntryInput.parse(input);
  if (!data.durationMin && !(data.startTime && data.endTime)) throw new Error("Geef een duur, of een begin- en eindtijd");
  const resolved = await resolve(data);
  const t = timing(data);
  const [row] = await db
    .insert(timeEntries)
    .values({ ...cleanFields(resolved), ...t, entryDate: data.entryDate ?? today(), billable: resolved.billable ?? false })
    .returning();
  return row;
}

/** Timer starten. Een lopende timer wordt eerst gestopt (er loopt er altijd hooguit één). */
export async function startTimer(input: Omit<TimeEntryInput, "durationMin" | "startTime" | "endTime" | "entryDate"> = {}) {
  const data = timeEntryInput.parse(input);
  const stopped = await stopTimer();
  const resolved = await resolve(data);
  const now = new Date();
  const [row] = await db
    .insert(timeEntries)
    .values({ ...cleanFields(resolved), entryDate: zonedIso(now), startedAt: now, endedAt: null, durationMin: null, billable: resolved.billable ?? false })
    .returning();
  return { started: row, stopped };
}

/** Lopende timer stoppen; geeft de afgeronde registratie terug (of null als er niets liep). */
export async function stopTimer(patch: Partial<Pick<TimeEntryInput, "description" | "billable" | "category">> = {}) {
  const running = await db.select().from(timeEntries).where(and(isNull(timeEntries.durationMin), isNotNull(timeEntries.startedAt)));
  if (!running.length) return null;
  const now = new Date();
  let last: TimeEntry | null = null;
  for (const e of running) {
    const min = Math.max(1, Math.round((now.getTime() - e.startedAt!.getTime()) / 60000));
    const set: Partial<TimeEntry> = { endedAt: now, durationMin: min };
    if (patch.description !== undefined) set.description = patch.description;
    if (patch.category !== undefined) set.category = patch.category;
    if (patch.billable != null) set.billable = patch.billable;
    [last] = await db.update(timeEntries).set(set).where(eq(timeEntries.id, e.id)).returning();
  }
  return last;
}

/** Nieuwe timer met dezelfde omschrijving en koppelingen als een eerdere registratie. */
export async function continueEntry(id: string) {
  const [e] = await db.select().from(timeEntries).where(eq(timeEntries.id, id));
  if (!e) throw new Error("Registratie niet gevonden");
  return startTimer({
    area: e.area,
    clientId: e.clientId,
    projectId: e.projectId,
    taskId: e.taskId,
    agreementId: e.agreementId,
    category: e.category,
    description: e.description,
    billable: e.billable,
  });
}

export async function updateTimeEntry(id: string, patch: TimeEntryInput) {
  const [current] = await db.select().from(timeEntries).where(eq(timeEntries.id, id));
  if (!current) throw new Error("Registratie niet gevonden");
  const data = timeEntryInput.parse(patch);
  const resolved = await resolve(data, current);
  const t = timing(data, current);
  const { billable, ...fields } = cleanFields(resolved);
  const set: Partial<TimeEntry> = { ...fields, ...t };
  if (billable != null) set.billable = billable;
  if (set.invoiced === false) set.installmentId = null;
  const [row] = await db.update(timeEntries).set(set).where(eq(timeEntries.id, id)).returning();
  return row;
}

export async function deleteTimeEntry(id: string) {
  const [row] = await db.delete(timeEntries).where(eq(timeEntries.id, id)).returning();
  return row ?? null;
}

/** Registraties handmatig als (niet) gefactureerd markeren, bijv. als ze buiten Marc OS zijn gefactureerd. */
export async function setInvoiced(ids: string[], invoiced: boolean) {
  if (!ids.length) return [];
  return db
    .update(timeEntries)
    .set(invoiced ? { invoiced: true } : { invoiced: false, installmentId: null })
    .where(inArray(timeEntries.id, ids))
    .returning();
}

/* ------------------------------------------------------------------ */
/* Weekoverzicht                                                       */
/* ------------------------------------------------------------------ */

export type WeekRow = { key: string; label: string; clientId: string | null; area: "zakelijk" | "prive"; days: number[]; total: number; billable: number };

export type WeekSummary = {
  weekStart: string;
  days: string[]; // ma t/m zo
  rows: WeekRow[]; // per klant, dan "Bedrijf algemeen", dan "Privé"
  dayTotals: number[];
  total: number;
  billable: number;
  byCategory: { category: string; minutes: number }[];
  entries: TimeEntryRow[];
};

export async function weekSummary(anyDay = today(), filter: { clientId?: string } = {}): Promise<WeekSummary> {
  const start = weekStart(anyDay);
  const days = Array.from({ length: 7 }, (_, i) => addDaysIso(start, i));
  const entries = await listTimeEntries({ from: start, to: days[6], clientId: filter.clientId });
  const rows = new Map<string, WeekRow>();
  const cats = new Map<string, number>();
  const dayTotals = Array(7).fill(0) as number[];
  let total = 0;
  let billable = 0;
  for (const e of entries) {
    const key = e.clientId ?? (e.area === "prive" ? "prive" : "bedrijf");
    const label = e.clientName ?? (e.area === "prive" ? "Privé" : "Bedrijf algemeen");
    const row = rows.get(key) ?? { key, label, clientId: e.clientId, area: e.area, days: Array(7).fill(0), total: 0, billable: 0 };
    const d = daysBetween(start, e.entryDate);
    if (d >= 0 && d < 7) {
      row.days[d] += e.minutes;
      dayTotals[d] += e.minutes;
    }
    row.total += e.minutes;
    if (e.billable) row.billable += e.minutes;
    rows.set(key, row);
    total += e.minutes;
    if (e.billable) billable += e.minutes;
    const cat = e.category || (e.area === "prive" ? "Privé" : e.clientId ? "Klantwerk" : "Overig");
    cats.set(cat, (cats.get(cat) ?? 0) + e.minutes);
  }
  const order = (r: WeekRow) => (r.clientId ? 0 : r.key === "bedrijf" ? 1 : 2);
  return {
    weekStart: start,
    days,
    rows: [...rows.values()].sort((a, b) => order(a) - order(b) || b.total - a.total),
    dayTotals,
    total,
    billable,
    byCategory: [...cats.entries()].map(([category, minutes]) => ({ category, minutes })).sort((a, b) => b.minutes - a.minutes),
    entries,
  };
}

/** Uren deze week (voor Vandaag en de briefing). */
export async function weekHours(anyDay = today()) {
  const start = weekStart(anyDay);
  const entries = await listTimeEntries({ from: start, to: addDaysIso(start, 6) });
  return {
    totalMin: entries.reduce((s, e) => s + e.minutes, 0),
    billableMin: entries.filter((e) => e.billable).reduce((s, e) => s + e.minutes, 0),
    zakelijkMin: entries.filter((e) => e.area === "zakelijk").reduce((s, e) => s + e.minutes, 0),
  };
}

/* ------------------------------------------------------------------ */
/* Te factureren uren                                                  */
/* ------------------------------------------------------------------ */

export type BillingGroup = {
  agreementId: string | null;
  agreementLabel: string | null;
  clientId: string | null;
  clientName: string | null;
  rateCents: number | null;
  minutes: number;
  amountCents: number | null;
  from: string;
  to: string;
  entryIds: string[];
};

/**
 * Declarabele, nog niet gefactureerde uren (timer gestopt), gegroepeerd per afspraak.
 * Uren zonder uurtarief-afspraak komen in een eigen groep per klant: daar ontbreekt een tarief.
 */
export async function billableQueue(filter: { clientId?: string } = {}): Promise<BillingGroup[]> {
  const rows = (await listTimeEntries({ billable: true, uninvoiced: true, clientId: filter.clientId })).filter((e) => !e.running);
  const groups = new Map<string, BillingGroup>();
  for (const e of rows) {
    const key = e.rateCents != null && e.agreementId ? e.agreementId : `zonder:${e.clientId ?? "-"}`;
    const g = groups.get(key) ?? {
      agreementId: e.rateCents != null ? e.agreementId : null,
      agreementLabel: e.rateCents != null ? e.agreementLabel : null,
      clientId: e.clientId,
      clientName: e.clientName,
      rateCents: e.rateCents,
      minutes: 0,
      amountCents: null,
      from: e.entryDate,
      to: e.entryDate,
      entryIds: [],
    };
    g.minutes += e.minutes;
    g.entryIds.push(e.id);
    if (e.entryDate < g.from) g.from = e.entryDate;
    if (e.entryDate > g.to) g.to = e.entryDate;
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, amountCents: g.rateCents != null ? hoursValue(g.minutes, g.rateCents) : null }))
    .sort((a, b) => (b.amountCents ?? -1) - (a.amountCents ?? -1));
}

/**
 * Uren van een uurtarief-afspraak factureren: maakt één termijn "klaar om te factureren"
 * met het totaal, en markeert de uren als gefactureerd (gekoppeld aan die termijn).
 * Facturen zelf maakt Marc in Moneybird.
 */
export async function invoiceHours(agreementId: string, upTo?: string) {
  const [a] = await db.select().from(agreements).where(eq(agreements.id, agreementId));
  if (!a) throw new Error("Afspraak niet gevonden");
  if (a.pricing !== "hourly") throw new Error("Alleen uren van een afspraak met uurtarief kunnen zo gefactureerd worden");
  const entries = (await listTimeEntries({ agreementId, billable: true, uninvoiced: true, to: upTo })).filter((e) => !e.running);
  if (!entries.length) throw new Error("Geen declarabele uren om te factureren");
  const minutes = entries.reduce((s, e) => s + e.minutes, 0);
  const from = entries.reduce((m, e) => (e.entryDate < m ? e.entryDate : m), entries[0].entryDate);
  const to = entries.reduce((m, e) => (e.entryDate > m ? e.entryDate : m), entries[0].entryDate);
  const t = today();
  const installment = await createInstallment({
    clientId: a.clientId,
    agreementId: a.id,
    projectId: a.projectId,
    description: `Uren ${formatDate(from)}${to !== from ? ` t/m ${formatDate(to)}` : ""}: ${formatDuration(minutes)} uur à ${formatEuro(a.amountCents)}`,
    amountCents: hoursValue(minutes, a.amountCents),
    trigger: "date",
    dueDate: t,
    status: "ready",
  });
  await db.update(timeEntries).set({ invoiced: true, installmentId: installment.id }).where(inArray(timeEntries.id, entries.map((e) => e.id)));
  return { installment, minutes, entries: entries.length };
}

/* ------------------------------------------------------------------ */
/* Budget bij maatwerk                                                 */
/* ------------------------------------------------------------------ */

export type BudgetStatus = {
  agreementId: string;
  clientId: string;
  clientName: string;
  label: string;
  rateCents: number;
  budgetCents: number | null;
  minutes: number; // alle uren onder deze afspraak
  billableMinutes: number;
  usedCents: number; // declarabele uren x tarief
  pct: number | null; // besteed als percentage van het budget
  warning: boolean; // vanaf BUDGET_WARNING_PCT
  over: boolean;
};

/** Uren en budget per uurtarief-afspraak (lopend of concept). */
export async function hourlyBudgets(filter: { clientId?: string; projectId?: string; onlyWarnings?: boolean } = {}): Promise<BudgetStatus[]> {
  const conds = [eq(agreements.pricing, "hourly"), inArray(agreements.status, ["active", "cancelled", "draft"])];
  if (filter.clientId) conds.push(eq(agreements.clientId, filter.clientId));
  if (filter.projectId) conds.push(eq(agreements.projectId, filter.projectId));
  const list = await db.select({ a: agreements, clientName: clients.name }).from(agreements).innerJoin(clients, eq(agreements.clientId, clients.id)).where(and(...conds)).orderBy(asc(clients.name));
  if (!list.length) return [];
  const sums = await db
    .select({
      agreementId: timeEntries.agreementId,
      minutes: sql<number>`coalesce(sum(${timeEntries.durationMin}), 0)::int`,
      billable: sql<number>`coalesce(sum(case when ${timeEntries.billable} then ${timeEntries.durationMin} else 0 end), 0)::int`,
    })
    .from(timeEntries)
    .where(inArray(timeEntries.agreementId, list.map((r) => r.a.id)))
    .groupBy(timeEntries.agreementId);
  // Lopende timer telt mee
  const running = await getRunningTimer();
  const out = list.map(({ a, clientName }) => {
    const s = sums.find((x) => x.agreementId === a.id);
    let minutes = s?.minutes ?? 0;
    let billableMinutes = s?.billable ?? 0;
    if (running?.agreementId === a.id) {
      minutes += running.minutes;
      if (running.billable) billableMinutes += running.minutes;
    }
    const usedCents = hoursValue(billableMinutes, a.amountCents);
    const pct = a.budgetCents ? Math.round((usedCents / a.budgetCents) * 100) : null;
    return {
      agreementId: a.id,
      clientId: a.clientId,
      clientName,
      label: agreementLabel(a),
      rateCents: a.amountCents,
      budgetCents: a.budgetCents,
      minutes,
      billableMinutes,
      usedCents,
      pct,
      warning: pct != null && pct >= BUDGET_WARNING_PCT,
      over: pct != null && pct >= 100,
    };
  });
  return filter.onlyWarnings ? out.filter((b) => b.warning) : out;
}

/* ------------------------------------------------------------------ */
/* Effectief uurtarief                                                 */
/* ------------------------------------------------------------------ */

export type RatePeriod = "month" | "quarter" | "year" | "12m";

export function periodRange(period: RatePeriod, ref = today()): { from: string; to: string } {
  const [y, m] = ref.split("-").map(Number);
  if (period === "month") return { from: `${ref.slice(0, 7)}-01`, to: ref };
  if (period === "quarter") return { from: `${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, "0")}-01`, to: ref };
  if (period === "year") return { from: `${y}-01-01`, to: ref };
  return { from: addDaysIso(ref, -364), to: ref };
}

export type ClientRate = {
  clientId: string;
  clientName: string;
  revenueCents: number;
  fixedCents: number; // vaste afspraken, naar rato van de dagen
  oneOffCents: number; // termijnen van eenmalig werk
  hourlyCents: number; // declarabele uren x tarief
  minutes: number; // alle zakelijke uren voor de klant
  billableMinutes: number;
  rateCents: number | null; // omzet / uren
};

export type RateOverview = { from: string; to: string; requestedFrom: string; trackingSince: string | null; clients: ClientRate[]; totals: Omit<ClientRate, "clientId" | "clientName"> };

/**
 * Effectief uurtarief per klant: omzet gedeeld door alle geschreven uren in de periode.
 * - Omzet = vaste afspraken naar rato van de dagen dat ze liepen + termijnen van eenmalig werk
 *   (klaar, gefactureerd of betaald in de periode) + declarabele uren x uurtarief.
 *   Termijnen waarmee uren gefactureerd zijn tellen niet dubbel.
 * - De periode begint nooit vóór de eerste geschreven uren, anders staat er omzet tegenover nul uren.
 */
export async function effectiveRates(period: RatePeriod = "year", ref = today(), custom?: { from: string; to: string; clampToTracking?: boolean }): Promise<RateOverview> {
  // custom: eigen bereik (doelen, gesprek 10); clampToTracking false = omzet ook vóór de eerste uren meetellen
  const range = custom ? { from: custom.from, to: custom.to } : periodRange(period, ref);
  const clamp = custom?.clampToTracking ?? true;
  const [first] = await db.select({ d: sql<string | null>`min(${timeEntries.entryDate})` }).from(timeEntries);
  const trackingSince = first?.d ?? null;
  const from = clamp && trackingSince && trackingSince > range.from ? trackingSince : range.from;
  const to = range.to;
  const span = daysBetween(from, to) + 1;

  const [allAgreements, inst, entries, clientRows] = await Promise.all([
    db.select().from(agreements).where(inArray(agreements.status, ["active", "cancelled", "ended"])),
    db
      .select({ i: installments, pricing: agreements.pricing })
      .from(installments)
      .leftJoin(agreements, eq(installments.agreementId, agreements.id))
      .where(and(inArray(installments.status, ["ready", "draft", "sent", "paid"]), sql`not exists (select 1 from ${timeEntries} where ${timeEntries.installmentId} = ${installments.id})`)),
    listTimeEntries({ from, to, area: "zakelijk" }),
    db.select({ id: clients.id, name: clients.name }).from(clients),
  ]);
  const names = new Map(clientRows.map((c) => [c.id, c.name]));
  const per = new Map<string, ClientRate>();
  const get = (id: string) => {
    let r = per.get(id);
    if (!r) {
      r = { clientId: id, clientName: names.get(id) ?? "?", revenueCents: 0, fixedCents: 0, oneOffCents: 0, hourlyCents: 0, minutes: 0, billableMinutes: 0, rateCents: null };
      per.set(id, r);
    }
    return r;
  };

  if (span > 0) {
    for (const a of allAgreements) {
      if (a.pricing !== "recurring") continue;
      const s = a.startDate && a.startDate > from ? a.startDate : from;
      const e = a.endDate && a.endDate < to ? a.endDate : to;
      const days = daysBetween(s, e) + 1;
      if (days <= 0) continue;
      get(a.clientId).fixedCents += (perMonth(a.amountCents, a.period) * 12 * days) / 365;
    }
    for (const { i, pricing } of inst) {
      if (pricing === "hourly" || pricing === "recurring") continue;
      const d = i.invoicedAt ?? i.readyAt ?? i.paidAt;
      if (!d || d < from || d > to) continue;
      get(i.clientId).oneOffCents += i.amountCents;
    }
  }
  for (const e of entries) {
    if (!e.clientId) continue;
    const r = get(e.clientId);
    r.minutes += e.minutes;
    if (e.billable) {
      r.billableMinutes += e.minutes;
      if (e.rateCents != null) r.hourlyCents += hoursValue(e.minutes, e.rateCents);
    }
  }
  const list = [...per.values()].map((r) => {
    const revenueCents = Math.round(r.fixedCents + r.oneOffCents + r.hourlyCents);
    return { ...r, fixedCents: Math.round(r.fixedCents), revenueCents, rateCents: r.minutes > 0 ? Math.round(revenueCents / (r.minutes / 60)) : null };
  });
  list.sort((a, b) => (b.minutes > 0 ? 1 : 0) - (a.minutes > 0 ? 1 : 0) || (a.rateCents ?? 0) - (b.rateCents ?? 0) || b.revenueCents - a.revenueCents);
  const sum = (k: "revenueCents" | "fixedCents" | "oneOffCents" | "hourlyCents" | "minutes" | "billableMinutes") => list.reduce((s, r) => s + r[k], 0);
  const totals = {
    revenueCents: sum("revenueCents"),
    fixedCents: sum("fixedCents"),
    oneOffCents: sum("oneOffCents"),
    hourlyCents: sum("hourlyCents"),
    minutes: sum("minutes"),
    billableMinutes: sum("billableMinutes"),
    rateCents: null as number | null,
  };
  totals.rateCents = totals.minutes > 0 ? Math.round(totals.revenueCents / (totals.minutes / 60)) : null;
  return { from, to, requestedFrom: range.from, trackingSince, clients: list.filter((r) => r.minutes > 0 || r.revenueCents > 0), totals };
}

/** Uren en effectief uurtarief van één klant (voor het dossier). */
export async function clientHours(clientId: string, period: RatePeriod = "year") {
  const [rates, recent, budgets, queue] = await Promise.all([
    effectiveRates(period),
    listTimeEntries({ clientId, limit: 8 }),
    hourlyBudgets({ clientId }),
    billableQueue({ clientId }),
  ]);
  return { rate: rates.clients.find((c) => c.clientId === clientId) ?? null, from: rates.from, to: rates.to, recent, budgets, queue };
}

/** Uren van één project: totaal, declarabel, budget van de gekoppelde afspraak en recente registraties. */
export async function projectHours(projectId: string) {
  const [sums] = await db
    .select({
      minutes: sql<number>`coalesce(sum(${timeEntries.durationMin}), 0)::int`,
      billable: sql<number>`coalesce(sum(case when ${timeEntries.billable} then ${timeEntries.durationMin} else 0 end), 0)::int`,
    })
    .from(timeEntries)
    .where(eq(timeEntries.projectId, projectId));
  const [recent, budgets, running] = await Promise.all([listTimeEntries({ projectId, limit: 8 }), hourlyBudgets({ projectId }), getRunningTimer()]);
  const extra = running?.projectId === projectId ? running.minutes : 0;
  return { minutes: (sums?.minutes ?? 0) + extra, billableMinutes: (sums?.billable ?? 0) + (running?.billable ? extra : 0), recent, budgets };
}

/** Recente omschrijvingen (voor suggesties bij invoer). */
export async function recentDescriptions(limit = 30): Promise<string[]> {
  const rows = await db
    .select({ d: timeEntries.description, last: sql<string>`max(${timeEntries.createdAt})` })
    .from(timeEntries)
    .where(and(isNotNull(timeEntries.description), sql`${timeEntries.description} <> ''`))
    .groupBy(timeEntries.description)
    .orderBy(sql`max(${timeEntries.createdAt}) desc`)
    .limit(limit);
  return rows.map((r) => r.d!).filter(Boolean);
}
