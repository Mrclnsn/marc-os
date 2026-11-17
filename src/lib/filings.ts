import "server-only";
import { isModuleOn } from "./settings";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { agreements, clientContacts, clients, filingSchedules, filings, tasks, type Filing, type FilingSchedule } from "@/db/schema";
import { addDaysIso, today } from "./dates";
import {
  defaultDeadline,
  docsDueDate,
  docsReminder,
  extensionApplies,
  filingTitle,
  frequencyOf,
  nextPeriod,
  periodLabel,
  periodOf,
  type Period,
} from "./filing-rules";
import { FILING_FREQUENCIES, FILING_KIND, FILING_WARNING_DAYS, OPEN_FILING_STATUSES, type BillingPeriod, type FilingKind, type FilingStatus } from "./labels";

/* ------------------------------------------------------------------ */
/* Invoerschema's                                                      */
/* ------------------------------------------------------------------ */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Gebruik YYYY-MM-DD");
const optText = z.string().nullable().optional();

export const filingKindSchema = z.enum(["vat", "income_tax", "corporate_tax", "icp", "payroll", "other"]);
export const filingFrequencySchema = z.enum(["month", "quarter", "year"]);
export const filingExtensionSchema = z.enum(["none", "individual", "becon"]);
export const filingStatusSchema = z.enum(["todo", "waiting_docs", "in_progress", "review", "filed", "done"]);

export const scheduleInput = z.object({
  clientId: z.string().uuid(),
  agreementId: z.string().uuid().nullable().optional(),
  kind: filingKindSchema,
  label: optText,
  frequency: filingFrequencySchema.optional(), // leeg = standaard voor de soort
  extension: filingExtensionSchema.optional(),
  startDate: isoDate.optional(), // leeg = begin van de huidige periode
  endDate: isoDate.nullable().optional(),
  docsDueDays: z.number().int().min(0).max(365).nullable().optional(),
  createTasks: z.boolean().optional(),
  active: z.boolean().optional(),
  notes: optText,
});
export type ScheduleInput = z.infer<typeof scheduleInput>;

export const filingPatch = z.object({
  status: filingStatusSchema.optional(),
  deadline: isoDate.optional(),
  docsDueDate: isoDate.nullable().optional(),
  docsRequestedAt: isoDate.nullable().optional(),
  docsReceivedAt: isoDate.nullable().optional(),
  filedAt: isoDate.nullable().optional(),
  doneAt: isoDate.nullable().optional(),
  amountCents: z.number().int().nullable().optional(),
  reference: optText,
  notes: optText,
});
export type FilingPatch = z.infer<typeof filingPatch>;

/* ------------------------------------------------------------------ */
/* Regels                                                              */
/* ------------------------------------------------------------------ */

const isOpen = (s: FilingStatus) => (OPEN_FILING_STATUSES as readonly string[]).includes(s);

/** Frequentie past bij de soort (IB en Vpb altijd per jaar). */
function fixFrequency(kind: FilingKind, frequency?: BillingPeriod | null): BillingPeriod {
  const allowed = FILING_FREQUENCIES[kind];
  return frequency && allowed.includes(frequency) ? frequency : allowed[0];
}

/** Nog niet aangeraakt: mag weg of opnieuw worden opgebouwd als de instelling verandert. */
function untouched(f: Filing) {
  return (f.status === "todo" || f.status === "waiting_docs") && !f.docsReceivedAt && f.amountCents == null && !f.notes && !f.deadlineManual && !f.reference;
}

export type FilingState = "running" | "docs_missing" | "due_soon" | "overdue" | "ok" | "closed";

/** Hoe staat dit item ervoor (voor kleur en signalen)? */
export function filingState(f: Pick<Filing, "status" | "periodEnd" | "deadline" | "docsDueDate" | "docsReceivedAt">, t = today()): FilingState {
  if (!isOpen(f.status)) return "closed";
  if (f.deadline < t) return "overdue";
  if (f.deadline <= addDaysIso(t, FILING_WARNING_DAYS)) return "due_soon";
  if (!f.docsReceivedAt && f.docsDueDate && f.docsDueDate < t && (f.status === "todo" || f.status === "waiting_docs")) return "docs_missing";
  if (f.periodEnd >= t) return "running";
  return "ok";
}

/* ------------------------------------------------------------------ */
/* Taken bij een aangifte                                              */
/* ------------------------------------------------------------------ */

async function createTaskFor(f: Filing) {
  const t = today();
  const plan = f.docsDueDate && f.docsDueDate >= t ? f.docsDueDate : null;
  const [task] = await db
    .insert(tasks)
    .values({
      title: filingTitle(f),
      area: "zakelijk",
      clientId: f.clientId,
      planDate: plan,
      dueDate: f.deadline,
      notes: "Aangifte uit de aangiftecyclus. Afronden zet de aangifte op ingediend.",
    })
    .returning();
  await db.update(filings).set({ taskId: task.id, taskCreated: true }).where(eq(filings.id, f.id));
  return task;
}

/** Deadline van de taak gelijk houden aan die van de aangifte. */
async function syncTaskDeadline(f: Pick<Filing, "taskId" | "deadline">) {
  if (f.taskId) await db.update(tasks).set({ dueDate: f.deadline }).where(and(eq(tasks.id, f.taskId), sql`${tasks.status} <> 'done'`));
}

/** Een taak van een aangifte is afgerond: aangifte op ingediend (als die nog openstond). Aangeroepen vanuit completeTask. */
export async function onTaskCompleted(taskId: string) {
  await db
    .update(filings)
    .set({ status: "filed", filedAt: today() })
    .where(and(eq(filings.taskId, taskId), inArray(filings.status, [...OPEN_FILING_STATUSES])));
}

/** Taak heropend: een aangifte die via die taak op ingediend kwam, gaat terug naar in behandeling. */
export async function onTaskReopened(taskId: string) {
  await db
    .update(filings)
    .set({ status: "in_progress", filedAt: null })
    .where(and(eq(filings.taskId, taskId), eq(filings.status, "filed")));
}

/* ------------------------------------------------------------------ */
/* Genereren                                                           */
/* ------------------------------------------------------------------ */

/** Hoeveel perioden we maximaal in één keer aanmaken (vangnet bij een heel oude startdatum). */
const MAX_PERIODS = 60;

function itemValues(s: FilingSchedule, p: Period) {
  return {
    clientId: s.clientId,
    scheduleId: s.id,
    kind: s.kind,
    label: s.label,
    periodStart: p.start,
    periodEnd: p.end,
    deadline: defaultDeadline(s.kind, s.frequency, p.end, s.extension),
    docsDueDate: docsDueDate(p.end, s.frequency, s.docsDueDays),
  };
}

/**
 * Maakt per actieve instelling een aangifte-item voor elke periode die begonnen is (tot en met de huidige),
 * vanaf de startdatum en tot de einddatum van de instelling of van de gekoppelde afspraak.
 * Een instelling bij een afspraak in concept doet nog niets. Daarna: een taak voor elke afgelopen periode.
 * Goedkoop en idempotent; wordt aangeroepen vóór elk overzicht.
 */
export async function ensureFilings() {
  // Module Aangiftes uit: geen automatische items en taken. Bij weer aanzetten wordt alles aangevuld.
  if (!(await isModuleOn("aangiftes"))) return;
  const t = today();
  const rows = await db
    .select({ s: filingSchedules, aStatus: agreements.status, aEnd: agreements.endDate })
    .from(filingSchedules)
    .leftJoin(agreements, eq(filingSchedules.agreementId, agreements.id))
    .where(eq(filingSchedules.active, true));

  const values = [];
  for (const { s, aStatus, aEnd } of rows) {
    if (aStatus === "draft") continue;
    const ends = [s.endDate, aEnd].filter((x): x is string => !!x).sort();
    const limit = ends[0] ?? null;
    let p = periodOf(s.startDate, s.frequency);
    for (let n = 0; n < MAX_PERIODS && p.start <= t && (!limit || p.start <= limit); n++) {
      values.push(itemValues(s, p));
      p = nextPeriod(p, s.frequency);
    }
  }
  if (values.length) await db.insert(filings).values(values).onConflictDoNothing();

  // Taken voor afgelopen perioden die nog openstaan
  const needTask = await db
    .select({ f: filings })
    .from(filings)
    .innerJoin(filingSchedules, eq(filings.scheduleId, filingSchedules.id))
    .where(and(eq(filings.taskCreated, false), eq(filingSchedules.createTasks, true), sql`${filings.periodEnd} < ${t}`, inArray(filings.status, [...OPEN_FILING_STATUSES])));
  for (const { f } of needTask) await createTaskFor(f);
}

/* ------------------------------------------------------------------ */
/* Instellingen per klant                                              */
/* ------------------------------------------------------------------ */

export type ScheduleRow = FilingSchedule & { clientName: string; title: string };

export async function listSchedules(filter: { clientId?: string } = {}): Promise<ScheduleRow[]> {
  const rows = await db
    .select({ s: filingSchedules, clientName: clients.name })
    .from(filingSchedules)
    .innerJoin(clients, eq(filingSchedules.clientId, clients.id))
    .where(filter.clientId ? eq(filingSchedules.clientId, filter.clientId) : undefined)
    .orderBy(asc(clients.name), sql`case ${filingSchedules.kind} when 'vat' then 0 when 'icp' then 1 when 'payroll' then 2 when 'income_tax' then 3 when 'corporate_tax' then 4 else 5 end`);
  return rows.map((r) => ({ ...r.s, clientName: r.clientName, title: r.s.label || FILING_KIND[r.s.kind] }));
}

export async function getSchedule(id: string) {
  const [row] = await db.select().from(filingSchedules).where(eq(filingSchedules.id, id));
  return row ?? null;
}

export async function createSchedule(input: ScheduleInput) {
  const data = scheduleInput.parse(input);
  const frequency = fixFrequency(data.kind, data.frequency);
  // Dezelfde soort (en eigen naam) twee keer bij één klant geeft dubbele aangiftes
  const same = (await listSchedules({ clientId: data.clientId })).find((s) => s.kind === data.kind && (s.label ?? "") === (data.label ?? ""));
  if (same) throw new Error(`${same.title} is al ingesteld voor deze klant. Pas die instelling aan (bijv. de startdatum) in plaats van een tweede toe te voegen.`);
  const [row] = await db
    .insert(filingSchedules)
    .values({
      ...data,
      frequency,
      extension: extensionApplies(data.kind) ? (data.extension ?? "none") : "none",
      startDate: data.startDate ?? periodOf(today(), frequency).start,
    })
    .returning();
  await ensureFilings();
  return row;
}

/** Items die nog niet zijn aangeraakt en niet meer passen bij de instelling, opruimen (met hun open taak). */
async function pruneUntouched(scheduleId: string, keep: (f: Filing) => boolean = () => false) {
  const items = await db.select().from(filings).where(eq(filings.scheduleId, scheduleId));
  const gone = items.filter((f) => untouched(f) && !keep(f));
  if (!gone.length) return 0;
  const taskIds = gone.map((f) => f.taskId).filter((x): x is string => !!x);
  if (taskIds.length) await db.delete(tasks).where(and(inArray(tasks.id, taskIds), sql`${tasks.status} <> 'done'`));
  await db.delete(filings).where(inArray(filings.id, gone.map((f) => f.id)));
  return gone.length;
}

/**
 * Instelling wijzigen. Gevolgen voor bestaande items:
 * - andere soort of frequentie: niet-aangeraakte items worden opnieuw opgebouwd;
 * - andere start- of einddatum: niet-aangeraakte items buiten het bereik vervallen;
 * - ander uitstel of andere stukken-termijn: deadlines en stukken-datums van open items worden herberekend (behalve een met de hand aangepaste deadline).
 */
export async function updateSchedule(id: string, patch: Partial<Omit<ScheduleInput, "clientId">>) {
  const current = await getSchedule(id);
  if (!current) throw new Error("Instelling niet gevonden");
  const data = scheduleInput.omit({ clientId: true }).partial().parse(patch);
  const kind = data.kind ?? current.kind;
  const frequency = fixFrequency(kind, data.frequency ?? (data.kind ? null : current.frequency));
  const extension = extensionApplies(kind) ? (data.extension ?? current.extension) : "none";
  const [row] = await db.update(filingSchedules).set({ ...data, frequency, extension }).where(eq(filingSchedules.id, id)).returning();

  if (row.kind !== current.kind || row.frequency !== current.frequency || row.label !== current.label) {
    await pruneUntouched(id);
    if (row.label !== current.label) await db.update(filings).set({ label: row.label }).where(eq(filings.scheduleId, id));
  } else if (row.startDate !== current.startDate || row.endDate !== current.endDate) {
    const first = periodOf(row.startDate, row.frequency).start;
    const last = row.endDate ? periodOf(row.endDate, row.frequency).start : null;
    await pruneUntouched(id, (f) => f.periodStart >= first && (!last || f.periodStart <= last));
  }
  if (row.extension !== current.extension || row.docsDueDays !== current.docsDueDays) {
    const open = await db.select().from(filings).where(and(eq(filings.scheduleId, id), inArray(filings.status, [...OPEN_FILING_STATUSES])));
    for (const f of open) {
      const set: Partial<Filing> = { docsDueDate: docsDueDate(f.periodEnd, row.frequency, row.docsDueDays) };
      if (!f.deadlineManual) set.deadline = defaultDeadline(row.kind, row.frequency, f.periodEnd, row.extension);
      const [u] = await db.update(filings).set(set).where(eq(filings.id, f.id)).returning();
      await syncTaskDeadline(u);
    }
  }
  await ensureFilings();
  return row;
}

/** Instelling verwijderen. Niet-aangeraakte items gaan mee; items waar al aan gewerkt is blijven bewaard. */
export async function deleteSchedule(id: string) {
  const removed = await pruneUntouched(id);
  const [row] = await db.delete(filingSchedules).where(eq(filingSchedules.id, id)).returning();
  return { schedule: row ?? null, removedItems: removed };
}

/**
 * Standaard aangiftes bij een nieuwe boekhoudafspraak (alleen als de klant er nog geen heeft):
 * btw per kwartaal, en IB (eenmanszaak, vof, maatschap of onbekend) of Vpb (bv, nv). Vanaf de huidige periode
 * of de startdatum van de afspraak als die later ligt.
 */
export async function createDefaultSchedules(agreement: { id: string; clientId: string; startDate: string | null }) {
  const [existing] = await db.select({ id: filingSchedules.id }).from(filingSchedules).where(eq(filingSchedules.clientId, agreement.clientId)).limit(1);
  if (existing) return [];
  const [client] = await db.select({ legalForm: clients.legalForm }).from(clients).where(eq(clients.id, agreement.clientId));
  const form = (client?.legalForm ?? "").trim().toLowerCase();
  const t = today();
  const from = (freq: BillingPeriod) => {
    const cur = periodOf(t, freq).start;
    return agreement.startDate && agreement.startDate > cur ? agreement.startDate : cur;
  };
  const values: (typeof filingSchedules.$inferInsert)[] = [
    { clientId: agreement.clientId, agreementId: agreement.id, kind: "vat", frequency: "quarter", startDate: from("quarter") },
  ];
  if (["", "eenmanszaak", "vof", "maatschap"].includes(form)) values.push({ clientId: agreement.clientId, agreementId: agreement.id, kind: "income_tax", frequency: "year", startDate: from("year") });
  if (["bv", "nv"].includes(form)) values.push({ clientId: agreement.clientId, agreementId: agreement.id, kind: "corporate_tax", frequency: "year", startDate: from("year") });
  const rows = await db.insert(filingSchedules).values(values).returning();
  await ensureFilings();
  return rows;
}

/* ------------------------------------------------------------------ */
/* Aangifte-items                                                      */
/* ------------------------------------------------------------------ */

export type FilingRow = Filing & {
  clientName: string;
  title: string;
  periodLabel: string;
  frequency: BillingPeriod;
  state: FilingState;
};

function toRow(f: Filing, clientName: string, t = today()): FilingRow {
  const frequency = frequencyOf({ start: f.periodStart, end: f.periodEnd });
  return { ...f, clientName, title: filingTitle(f), periodLabel: periodLabel(f.periodStart, frequency), frequency, state: filingState(f, t) };
}

export type FilingFilter = {
  clientId?: string;
  status?: FilingStatus[];
  open?: boolean; // nog niet ingediend
  kind?: FilingKind;
  year?: number; // jaar waarin de periode begint
  deadlineBefore?: string;
  includeRunning?: boolean; // ook perioden die nog lopen (standaard ja)
  limit?: number;
};

export async function listFilings(filter: FilingFilter = {}): Promise<FilingRow[]> {
  await ensureFilings();
  const t = today();
  const conds = [];
  if (filter.clientId) conds.push(eq(filings.clientId, filter.clientId));
  if (filter.status?.length) conds.push(inArray(filings.status, filter.status));
  if (filter.open) conds.push(inArray(filings.status, [...OPEN_FILING_STATUSES]));
  if (filter.kind) conds.push(eq(filings.kind, filter.kind));
  if (filter.year) conds.push(gte(filings.periodStart, `${filter.year}-01-01`), lte(filings.periodStart, `${filter.year}-12-31`));
  if (filter.deadlineBefore) conds.push(lte(filings.deadline, filter.deadlineBefore));
  if (filter.includeRunning === false) conds.push(sql`${filings.periodEnd} < ${t}`);
  const rows = await db
    .select({ f: filings, clientName: clients.name })
    .from(filings)
    .innerJoin(clients, eq(filings.clientId, clients.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(filter.open ? asc(filings.deadline) : desc(filings.periodStart), asc(clients.name), asc(filings.kind))
    .limit(filter.limit ?? 500);
  return rows.map((r) => toRow(r.f, r.clientName, t));
}

export async function getFiling(id: string): Promise<FilingRow | null> {
  const [r] = await db.select({ f: filings, clientName: clients.name }).from(filings).innerJoin(clients, eq(filings.clientId, clients.id)).where(eq(filings.id, id));
  return r ? toRow(r.f, r.clientName) : null;
}

/**
 * Aangifte bijwerken. Statusregels:
 * - ingediend: datum ingediend standaard vandaag, gekoppelde taak afgerond;
 * - afgerond: ook datum afgerond (en ingediend als die nog leeg is);
 * - terug naar open: datums ingediend/afgerond leeg, taak weer open;
 * - stukken binnen terwijl hij op "wacht op stukken" staat: terug naar te doen;
 * - stukken opgevraagd terwijl hij op "te doen" staat: wacht op stukken;
 * - deadline zelf aangepast: blijft staan bij herberekenen.
 */
export async function updateFiling(id: string, patch: FilingPatch) {
  const current = await getFiling(id);
  if (!current) throw new Error("Aangifte niet gevonden");
  const data = filingPatch.parse(patch);
  const t = today();
  const set: Partial<Filing> = { ...data };

  if (data.deadline && data.deadline !== current.deadline) set.deadlineManual = true;
  if (data.docsRequestedAt && !data.status && current.status === "todo") set.status = "waiting_docs";
  if (data.docsReceivedAt && !data.status && current.status === "waiting_docs") set.status = "todo";

  const status = set.status ?? current.status;
  if (status === "filed" || status === "done") {
    if (set.filedAt === undefined && !current.filedAt) set.filedAt = t;
    if (status === "done" && set.doneAt === undefined && !current.doneAt) set.doneAt = t;
    if (status === "filed" && data.status === "filed" && current.status === "done") set.doneAt = null;
  } else if (data.status && !isOpen(current.status)) {
    set.filedAt = null;
    set.doneAt = null;
  }

  const [row] = await db.update(filings).set(set).where(eq(filings.id, id)).returning();

  if (row.taskId) {
    if (!isOpen(row.status)) await db.update(tasks).set({ status: "done", completedAt: new Date() }).where(and(eq(tasks.id, row.taskId), sql`${tasks.status} <> 'done'`));
    else if (!isOpen(current.status)) await db.update(tasks).set({ status: "todo", completedAt: null }).where(eq(tasks.id, row.taskId));
    if (row.deadline !== current.deadline) await syncTaskDeadline(row);
  }
  return (await getFiling(id))!;
}

/** Losse aangifte (zonder instelling), bijv. een suppletie of een eenmalige aangifte. */
export async function createFiling(input: { clientId: string; kind: FilingKind; label?: string | null; periodStart: string; periodEnd?: string | null; frequency?: BillingPeriod; deadline?: string | null; notes?: string | null; createTask?: boolean }) {
  const frequency = fixFrequency(input.kind, input.frequency);
  const p = input.periodEnd ? { start: input.periodStart, end: input.periodEnd } : periodOf(input.periodStart, frequency);
  const [row] = await db
    .insert(filings)
    .values({
      clientId: input.clientId,
      kind: input.kind,
      label: input.label ?? null,
      periodStart: p.start,
      periodEnd: p.end,
      deadline: input.deadline ?? defaultDeadline(input.kind, frequency, p.end),
      deadlineManual: !!input.deadline,
      docsDueDate: docsDueDate(p.end, frequency),
      notes: input.notes ?? null,
    })
    .returning();
  if (input.createTask !== false) await createTaskFor(row);
  return (await getFiling(row.id))!;
}

/** Verwijdert een aangifte-item (de open taak gaat mee). Een item uit een instelling komt terug bij de volgende controle, tenzij de periode buiten de instelling valt. */
export async function deleteFiling(id: string) {
  const [row] = await db.delete(filings).where(eq(filings.id, id)).returning();
  if (row?.taskId) await db.delete(tasks).where(and(eq(tasks.id, row.taskId), sql`${tasks.status} <> 'done'`));
  return row ?? null;
}

/** Meerdere items in één keer op een status zetten (bijv. oude perioden op afgerond). */
export async function setFilingsStatus(ids: string[], status: FilingStatus) {
  const out = [];
  for (const id of ids) out.push(await updateFiling(id, { status }));
  return out;
}

/* ------------------------------------------------------------------ */
/* Herinnering stukken                                                 */
/* ------------------------------------------------------------------ */

/** Conceptmail om de stukken op te vragen, met de primaire contactpersoon (of het factuuradres) als ontvanger. */
export async function filingReminder(id: string) {
  const f = await getFiling(id);
  if (!f) throw new Error("Aangifte niet gevonden");
  const [contact] = await db
    .select()
    .from(clientContacts)
    .where(eq(clientContacts.clientId, f.clientId))
    .orderBy(desc(clientContacts.isPrimary), asc(clientContacts.createdAt))
    .limit(1);
  const [client] = await db.select({ invoiceEmail: clients.invoiceEmail }).from(clients).where(eq(clients.id, f.clientId));
  const to = contact?.email || client?.invoiceEmail || null;
  const { subject, body } = docsReminder(f, contact?.name);
  const mailto = to ? `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` : null;
  return { filingId: f.id, client: f.clientName, to, contactName: contact?.name ?? null, subject, body, mailto };
}

/* ------------------------------------------------------------------ */
/* Overzicht en signalen                                               */
/* ------------------------------------------------------------------ */

export type FilingSignals = {
  overdue: FilingRow[]; // deadline voorbij, nog niet ingediend
  dueSoon: FilingRow[]; // deadline binnen 14 dagen
  docsMissing: FilingRow[]; // stukken hadden binnen moeten zijn
  awaitingPayment: FilingRow[]; // ingediend, nog niet afgerond
};

export async function filingSignals(): Promise<FilingSignals> {
  const [open, filed] = await Promise.all([listFilings({ open: true }), listFilings({ status: ["filed"] })]);
  return {
    overdue: open.filter((f) => f.state === "overdue"),
    dueSoon: open.filter((f) => f.state === "due_soon"),
    docsMissing: open.filter((f) => !f.docsReceivedAt && f.docsDueDate && f.docsDueDate < today() && (f.status === "todo" || f.status === "waiting_docs")),
    awaitingPayment: filed,
  };
}

export type FilingOverview = FilingSignals & {
  open: FilingRow[];
  counts: { open: number; running: number; waitingDocs: number; inProgress: number; review: number; filed: number; doneThisYear: number };
  schedules: ScheduleRow[];
  bookkeepingWithoutSchedule: { clientId: string; clientName: string }[];
};

export async function filingOverview(): Promise<FilingOverview> {
  const t = today();
  const [signals, open, schedules, doneThisYear, bk] = await Promise.all([
    filingSignals(),
    listFilings({ open: true }),
    listSchedules(),
    db.select({ n: sql<number>`count(*)::int` }).from(filings).where(and(eq(filings.status, "done"), isNotNull(filings.doneAt), gte(filings.doneAt, `${t.slice(0, 4)}-01-01`))),
    db
      .select({ clientId: agreements.clientId, clientName: clients.name })
      .from(agreements)
      .innerJoin(clients, eq(agreements.clientId, clients.id))
      .leftJoin(filingSchedules, eq(filingSchedules.clientId, agreements.clientId))
      .where(and(eq(agreements.kind, "bookkeeping"), inArray(agreements.status, ["active", "cancelled"]), isNull(filingSchedules.id))),
  ]);
  const by = (s: FilingStatus) => open.filter((f) => f.status === s).length;
  return {
    ...signals,
    open,
    counts: {
      open: open.filter((f) => f.state !== "running").length,
      running: open.filter((f) => f.state === "running").length,
      waitingDocs: by("waiting_docs"),
      inProgress: by("in_progress"),
      review: by("review"),
      filed: signals.awaitingPayment.length,
      doneThisYear: doneThisYear[0]?.n ?? 0,
    },
    schedules,
    bookkeepingWithoutSchedule: [...new Map(bk.map((r) => [r.clientId, r])).values()],
  };
}

/** Aangiftes in het klantdossier: instellingen, open items en de laatste afgeronde. */
export async function clientFilings(clientId: string) {
  const [schedules, items] = await Promise.all([listSchedules({ clientId }), listFilings({ clientId, limit: 40 })]);
  return {
    schedules,
    open: items.filter((f) => f.state !== "closed").sort((a, b) => a.deadline.localeCompare(b.deadline)),
    closed: items.filter((f) => f.state === "closed").slice(0, 8),
  };
}

/** Voor MCP en Hermes: kort overzicht per item. */
export function slimFiling(f: FilingRow) {
  return {
    id: f.id,
    client: f.clientName,
    clientId: f.clientId,
    title: f.title,
    kind: f.kind,
    period: f.periodLabel,
    periodStart: f.periodStart,
    periodEnd: f.periodEnd,
    deadline: f.deadline,
    status: f.status,
    state: f.state,
    docsDueDate: f.docsDueDate,
    docsRequestedAt: f.docsRequestedAt,
    docsReceivedAt: f.docsReceivedAt,
    filedAt: f.filedAt,
    doneAt: f.doneAt,
    amountCents: f.amountCents,
    reference: f.reference,
    taskId: f.taskId,
    notes: f.notes,
  };
}
