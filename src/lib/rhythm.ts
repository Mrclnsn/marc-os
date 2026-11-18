import "server-only";
import { and, asc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { clients, projects, rhythmBlocks, rhythmOverrides, rhythms, tasks, type Rhythm, type RhythmBlock } from "@/db/schema";
import { getEvents, type CalendarEvent } from "./calendar";
import { addDaysIso, today } from "./dates";
import { BLOCK_KIND_KEYS, TIME_RE, isoWeekday, toMin, type BlockKind } from "./rhythm-shared";
import type { TaskWithRefs } from "./data";

/*
 * Dagritme en planning (gesprek 8).
 * Een dagritme is een sjabloon met vaste blokken; elke weekdag hoort bij hooguit één ritme,
 * en per datum kan een ander ritme (of een vrije dag) worden gekozen.
 * Taken worden ingepland op een datum en optioneel in een blok (timeblocking) en/of op een tijd.
 */

/* ------------------------------------------------------------------ */
/* Invoer                                                              */
/* ------------------------------------------------------------------ */

const time = z.string().regex(TIME_RE, "Gebruik HH:mm");
const weekdays = z.array(z.number().int().min(1).max(7));

export const rhythmInput = z.object({
  name: z.string().min(1),
  weekdays: weekdays.optional(),
  workStart: time.nullable().optional(),
  workEnd: time.nullable().optional(),
  sortOrder: z.number().int().optional(),
});
export type RhythmInput = z.infer<typeof rhythmInput>;

export const blockInput = z.object({
  rhythmId: z.string().uuid(),
  title: z.string().min(1),
  kind: z.enum(BLOCK_KIND_KEYS as [BlockKind, ...BlockKind[]]).optional(),
  area: z.enum(["zakelijk", "prive"]).nullable().optional(),
  startTime: time,
  endTime: time,
  remind: z.boolean().optional(),
  remindBefore: z.number().int().min(0).max(240).optional(),
  notes: z.string().nullable().optional(),
});
export type BlockInput = z.infer<typeof blockInput>;

function checkTimes(start?: string | null, end?: string | null, what = "Het blok") {
  if (start && end && toMin(end) <= toMin(start)) throw new Error(`${what} moet eindigen na het begin (${start} tot ${end}).`);
}

/* ------------------------------------------------------------------ */
/* Ritmes en blokken                                                   */
/* ------------------------------------------------------------------ */

export type RhythmWithBlocks = Rhythm & { blocks: RhythmBlock[] };

export async function listRhythms(): Promise<RhythmWithBlocks[]> {
  const [rs, bs] = await Promise.all([
    db.select().from(rhythms).orderBy(asc(rhythms.sortOrder), asc(rhythms.createdAt)),
    db.select().from(rhythmBlocks).orderBy(asc(rhythmBlocks.startTime), asc(rhythmBlocks.endTime)),
  ]);
  return rs.map((r) => ({ ...r, blocks: bs.filter((b) => b.rhythmId === r.id) }));
}

/** Een weekdag hoort bij hooguit één ritme: wie de dag krijgt, haalt hem weg bij de andere. */
async function claimWeekdays(rhythmId: string, days: number[]) {
  if (!days.length) return;
  const others = await db.select().from(rhythms).where(ne(rhythms.id, rhythmId));
  for (const o of others) {
    const left = o.weekdays.filter((d) => !days.includes(d));
    if (left.length !== o.weekdays.length) await db.update(rhythms).set({ weekdays: left }).where(eq(rhythms.id, o.id));
  }
}

export async function createRhythm(input: RhythmInput) {
  const data = rhythmInput.parse(input);
  checkTimes(data.workStart, data.workEnd, "De werkdag");
  const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${rhythms.sortOrder}), 0)` }).from(rhythms);
  const [row] = await db.insert(rhythms).values({ ...data, weekdays: [], sortOrder: data.sortOrder ?? Number(max) + 1 }).returning();
  if (data.weekdays?.length) {
    await claimWeekdays(row.id, data.weekdays);
    await db.update(rhythms).set({ weekdays: [...new Set(data.weekdays)].sort() }).where(eq(rhythms.id, row.id));
  }
  return row;
}

export async function updateRhythm(id: string, patch: Partial<RhythmInput>) {
  const data = rhythmInput.partial().parse(patch);
  const [cur] = await db.select().from(rhythms).where(eq(rhythms.id, id));
  if (!cur) throw new Error("Dagritme niet gevonden");
  checkTimes(data.workStart !== undefined ? data.workStart : cur.workStart, data.workEnd !== undefined ? data.workEnd : cur.workEnd, "De werkdag");
  if ((data.workStart == null) !== (data.workEnd == null) && data.workStart !== undefined && data.workEnd !== undefined) {
    throw new Error("Vul begin en einde van de werkdag allebei in, of laat ze allebei leeg.");
  }
  if (data.weekdays) {
    await claimWeekdays(id, data.weekdays);
    data.weekdays = [...new Set(data.weekdays)].sort();
  }
  const [row] = await db.update(rhythms).set(data).where(eq(rhythms.id, id)).returning();
  return row;
}

/** Verwijdert het ritme met zijn blokken. Taken in die blokken blijven op hun datum staan, zonder blok. */
export async function deleteRhythm(id: string) {
  await db.delete(rhythms).where(eq(rhythms.id, id));
}

export async function createBlock(input: BlockInput) {
  const data = blockInput.parse(input);
  checkTimes(data.startTime, data.endTime);
  const [row] = await db.insert(rhythmBlocks).values(data).returning();
  return row;
}

export async function updateBlock(id: string, patch: Partial<Omit<BlockInput, "rhythmId">>) {
  const data = blockInput.omit({ rhythmId: true }).partial().parse(patch);
  const [cur] = await db.select().from(rhythmBlocks).where(eq(rhythmBlocks.id, id));
  if (!cur) throw new Error("Blok niet gevonden");
  checkTimes(data.startTime ?? cur.startTime, data.endTime ?? cur.endTime);
  const [row] = await db.update(rhythmBlocks).set(data).where(eq(rhythmBlocks.id, id)).returning();
  return row;
}

export async function deleteBlock(id: string) {
  await db.delete(rhythmBlocks).where(eq(rhythmBlocks.id, id));
}

/** Een blok kopiëren naar een ander ritme (bijv. dagstart ook op vrijdag). */
export async function copyBlock(id: string, rhythmId: string) {
  const [cur] = await db.select().from(rhythmBlocks).where(eq(rhythmBlocks.id, id));
  if (!cur) throw new Error("Blok niet gevonden");
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = cur;
  void _id; void _c; void _u;
  const [row] = await db.insert(rhythmBlocks).values({ ...rest, rhythmId }).returning();
  return row;
}

/* ------------------------------------------------------------------ */
/* Welk ritme op welke dag                                             */
/* ------------------------------------------------------------------ */

export type DayRhythm = {
  date: string;
  rhythm: RhythmWithBlocks | null;
  /** true als er voor deze datum een ander ritme (of vrije dag) is gekozen */
  override: boolean;
  overrideNote: string | null;
  /** Werkdag voor "nog vrij"; null = geen werkdag */
  work: { start: string; end: string } | null;
  blocks: RhythmBlock[];
};

/** Ritme per datum voor een reeks datums (in één keer). */
export async function dayRhythms(dates: string[], all?: RhythmWithBlocks[]): Promise<Map<string, DayRhythm>> {
  const list = all ?? (await listRhythms());
  const overrides = dates.length ? await db.select().from(rhythmOverrides).where(inArray(rhythmOverrides.date, dates)) : [];
  const out = new Map<string, DayRhythm>();
  for (const date of dates) {
    const o = overrides.find((x) => x.date === date);
    const rhythm = o ? (list.find((r) => r.id === o.rhythmId) ?? null) : (list.find((r) => r.weekdays.includes(isoWeekday(date))) ?? null);
    out.set(date, {
      date,
      rhythm,
      override: !!o,
      overrideNote: o?.note ?? null,
      work: rhythm?.workStart && rhythm.workEnd ? { start: rhythm.workStart, end: rhythm.workEnd } : null,
      blocks: rhythm?.blocks ?? [],
    });
  }
  return out;
}

export async function dayRhythm(date: string): Promise<DayRhythm> {
  return (await dayRhythms([date])).get(date)!;
}

/**
 * Ander ritme voor één datum. rhythmId: id van een ritme, null = vrije dag (geen blokken), "default" = terug naar het standaardritme.
 */
export async function setDayRhythm(date: string, rhythmId: string | null | "default", note?: string | null) {
  if (rhythmId === "default") {
    await db.delete(rhythmOverrides).where(eq(rhythmOverrides.date, date));
    return;
  }
  await db
    .insert(rhythmOverrides)
    .values({ date, rhythmId, note: note ?? null })
    .onConflictDoUpdate({ target: rhythmOverrides.date, set: { rhythmId, note: note ?? null } });
}

export async function listOverrides(from: string) {
  return db
    .select({ date: rhythmOverrides.date, rhythmId: rhythmOverrides.rhythmId, note: rhythmOverrides.note, name: rhythms.name })
    .from(rhythmOverrides)
    .leftJoin(rhythms, eq(rhythmOverrides.rhythmId, rhythms.id))
    .where(gte(rhythmOverrides.date, from))
    .orderBy(asc(rhythmOverrides.date));
}

/* ------------------------------------------------------------------ */
/* Dag- en weekplanning                                                */
/* ------------------------------------------------------------------ */

const taskSelect = { task: tasks, clientName: clients.name, projectName: projects.name };
const when = sql`coalesce(${tasks.planDate}, ${tasks.dueDate})`;

async function openTasksBetween(from: string, to: string, area?: "zakelijk" | "prive"): Promise<TaskWithRefs[]> {
  const conds = [ne(tasks.status, "done"), sql`${when} >= ${from}`, sql`${when} <= ${to}`];
  if (area) conds.push(eq(tasks.area, area));
  const rows = await db
    .select(taskSelect)
    .from(tasks)
    .leftJoin(clients, eq(tasks.clientId, clients.id))
    .leftJoin(projects, eq(tasks.projectId, projects.id))
    .where(and(...conds))
    .orderBy(sql`${tasks.planTime} asc nulls last`, asc(tasks.priority), asc(tasks.createdAt));
  return rows.map((r) => ({ ...r.task, clientName: r.clientName, projectName: r.projectName }));
}

async function doneTasksOn(dates: string[]): Promise<TaskWithRefs[]> {
  if (!dates.length) return [];
  const rows = await db
    .select(taskSelect)
    .from(tasks)
    .leftJoin(clients, eq(tasks.clientId, clients.id))
    .leftJoin(projects, eq(tasks.projectId, projects.id))
    .where(and(eq(tasks.status, "done"), sql`(${tasks.completedAt} at time zone 'Europe/Amsterdam')::date in (${sql.join(dates.map((d) => sql`${d}::date`), sql`, `)})`));
  return rows.map((r) => ({ ...r.task, clientName: r.clientName, projectName: r.projectName }));
}

/** Taken zonder plek: open, zonder plandatum en zonder deadline. */
export async function unplacedTasks(area?: "zakelijk" | "prive", limit = 60): Promise<TaskWithRefs[]> {
  const conds = [ne(tasks.status, "done"), isNull(tasks.planDate), isNull(tasks.dueDate)];
  if (area) conds.push(eq(tasks.area, area));
  const rows = await db
    .select(taskSelect)
    .from(tasks)
    .leftJoin(clients, eq(tasks.clientId, clients.id))
    .leftJoin(projects, eq(tasks.projectId, projects.id))
    .where(and(...conds))
    .orderBy(asc(tasks.priority), asc(tasks.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r.task, clientName: r.clientName, projectName: r.projectName }));
}

/** Open taken met een deadline in de komende dagen die nog niet op een dag zijn ingepland. */
async function deadlinesWithoutPlan(from: string, to: string, area?: "zakelijk" | "prive"): Promise<TaskWithRefs[]> {
  const conds = [ne(tasks.status, "done"), isNull(tasks.planDate), gte(tasks.dueDate, from), lte(tasks.dueDate, to)];
  if (area) conds.push(eq(tasks.area, area));
  const rows = await db
    .select(taskSelect)
    .from(tasks)
    .leftJoin(clients, eq(tasks.clientId, clients.id))
    .leftJoin(projects, eq(tasks.projectId, projects.id))
    .where(and(...conds))
    .orderBy(asc(tasks.dueDate), asc(tasks.priority));
  return rows.map((r) => ({ ...r.task, clientName: r.clientName, projectName: r.projectName }));
}

export type PlannedBlock = RhythmBlock & {
  from: number;
  to: number;
  minutes: number;
  tasks: TaskWithRefs[];
  /** Som van de inschattingen van de open taken in dit blok */
  plannedMin: number;
  past: boolean;
  current: boolean;
};

export type DayPlan = DayRhythm & {
  weekday: number;
  isToday: boolean;
  blocksPlanned: PlannedBlock[];
  /** Ingepland op deze dag maar niet in een blok van het ritme van deze dag */
  loose: TaskWithRefs[];
  events: CalendarEvent[];
  /** Som van de inschattingen van alle open taken op deze dag */
  plannedMin: number;
  /** Beschikbare werktijd (werkdag min agenda), null zonder werkdag */
  workMin: number | null;
  done: number;
};

function nowMinutes(): number {
  const parts = new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Amsterdam", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  return (Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24) * 60 + Number(parts.find((p) => p.type === "minute")?.value ?? 0);
}

/** Minuten binnen [start, end) die niet door agenda-items bezet zijn. */
export function freeWithin(start: number, end: number, events: CalendarEvent[]): number {
  if (start >= end) return 0;
  const busy = events
    .filter((e) => !e.allDay && e.time && e.endTime)
    .map((e) => [Math.max(toMin(e.time!), start), Math.min(toMin(e.endTime!) || 24 * 60, end)] as const)
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let taken = 0;
  let cursor = start;
  for (const [a, b] of busy) {
    const from = Math.max(a, cursor);
    if (b > from) {
      taken += b - from;
      cursor = b;
    }
  }
  return end - start - taken;
}

function buildDay(rhythm: DayRhythm, dayTasks: TaskWithRefs[], doneTasks: TaskWithRefs[], events: CalendarEvent[], t: string, now: number): DayPlan {
  const ids = new Set(rhythm.blocks.map((b) => b.id));
  const isToday = rhythm.date === t;
  const blocksPlanned: PlannedBlock[] = rhythm.blocks.map((b) => {
    const from = toMin(b.startTime);
    const to = toMin(b.endTime);
    const inBlock = dayTasks.filter((x) => x.planBlockId === b.id);
    const done = doneTasks.filter((x) => x.planBlockId === b.id && x.planDate === rhythm.date);
    return {
      ...b,
      from,
      to,
      minutes: to - from,
      tasks: [...inBlock, ...done],
      plannedMin: inBlock.reduce((s, x) => s + (x.estimateMin ?? 0), 0),
      past: rhythm.date < t || (isToday && to <= now),
      current: isToday && from <= now && to > now,
    };
  });
  const loose = dayTasks.filter((x) => !x.planBlockId || !ids.has(x.planBlockId));
  const workMin = rhythm.work ? freeWithin(toMin(rhythm.work.start), toMin(rhythm.work.end), events) : null;
  return {
    ...rhythm,
    weekday: isoWeekday(rhythm.date),
    isToday,
    blocksPlanned,
    loose,
    events,
    plannedMin: dayTasks.reduce((s, x) => s + (x.estimateMin ?? 0), 0),
    workMin,
    done: doneTasks.filter((x) => x.planDate === rhythm.date).length,
  };
}

export type DayView = DayPlan & {
  overdue: TaskWithRefs[];
  deadlinesSoon: TaskWithRefs[];
  unplaced: TaskWithRefs[];
  calendarErrors: string[];
};

/** Alles voor de dagweergave van Planning. */
export async function getDayPlan(date: string, area?: "zakelijk" | "prive"): Promise<DayView> {
  const t = today();
  const [r, dayTasks, done, cal, overdue, soon, unplaced] = await Promise.all([
    dayRhythm(date),
    openTasksBetween(date, date, area),
    doneTasksOn([date]),
    getEvents(date, date),
    date === t ? openTasksBetween("1900-01-01", addDaysIso(t, -1), area) : Promise.resolve([]),
    deadlinesWithoutPlan(addDaysIso(date, 1), addDaysIso(date, 7), area),
    unplacedTasks(area),
  ]);
  const plan = buildDay(r, dayTasks, done, cal.events, t, nowMinutes());
  return { ...plan, overdue, deadlinesSoon: soon, unplaced, calendarErrors: cal.errors };
}

export type WeekView = {
  start: string;
  days: DayPlan[];
  unplaced: TaskWithRefs[];
  overdue: TaskWithRefs[];
  calendarErrors: string[];
};

/** Alles voor de weekweergave: zeven dagen (vanaf maandag) met ritme, agenda en ingeplande taken. */
export async function getWeekPlan(monday: string, area?: "zakelijk" | "prive"): Promise<WeekView> {
  const t = today();
  const dates = Array.from({ length: 7 }, (_, i) => addDaysIso(monday, i));
  const sunday = dates[6];
  const [rs, weekTasks, done, cal, unplaced, overdue] = await Promise.all([
    dayRhythms(dates),
    openTasksBetween(monday, sunday, area),
    doneTasksOn(dates),
    getEvents(monday, sunday),
    unplacedTasks(area),
    monday <= t && t <= sunday ? openTasksBetween("1900-01-01", addDaysIso(t, -1), area) : Promise.resolve([]),
  ]);
  const now = nowMinutes();
  const days = dates.map((d) =>
    buildDay(
      rs.get(d)!,
      weekTasks.filter((x) => (x.planDate ?? x.dueDate) === d),
      done,
      cal.events.filter((e) => e.date === d),
      t,
      now,
    ),
  );
  return { start: monday, days, unplaced, overdue, calendarErrors: cal.errors };
}

/* ------------------------------------------------------------------ */
/* Inplannen                                                           */
/* ------------------------------------------------------------------ */

/**
 * Taak inplannen: op een datum, optioneel in een blok en/of op een tijd.
 * date null = terug naar "zonder plek" (blok en tijd gaan dan ook weg).
 */
export async function planTask(id: string, slot: { date: string | null; blockId?: string | null; time?: string | null }) {
  const set: Partial<typeof tasks.$inferInsert> = { planDate: slot.date };
  if (slot.date === null) {
    set.planBlockId = null;
    set.planTime = null;
  } else {
    if (slot.blockId !== undefined) {
      if (slot.blockId) {
        const [b] = await db.select({ id: rhythmBlocks.id }).from(rhythmBlocks).where(eq(rhythmBlocks.id, slot.blockId));
        if (!b) throw new Error("Blok niet gevonden. Gebruik get_day_plan voor de blokken van die dag.");
      }
      set.planBlockId = slot.blockId;
    }
    if (slot.time !== undefined) {
      if (slot.time && !TIME_RE.test(slot.time)) throw new Error("Tijd als HH:mm");
      set.planTime = slot.time;
    }
  }
  const [row] = await db.update(tasks).set(set).where(eq(tasks.id, id)).returning();
  if (!row) throw new Error("Taak niet gevonden");
  return row;
}

/** Blok op naam zoeken binnen het ritme van een datum (voor de MCP: "diep werk"). Bij twee blokken met dezelfde naam het eerste dat nog niet voorbij is. */
export async function findBlockOnDate(date: string, ref: string): Promise<RhythmBlock | null> {
  const r = await dayRhythm(date);
  if (/^[0-9a-f-]{36}$/i.test(ref)) return r.blocks.find((b) => b.id === ref) ?? null;
  const q = ref.trim().toLowerCase();
  const matches = r.blocks.filter((b) => b.title.toLowerCase() === q || b.kind === q.replace(/\s+/g, "_") || b.title.toLowerCase().includes(q));
  if (!matches.length) return null;
  if (date === today()) {
    const now = nowMinutes();
    return matches.find((b) => toMin(b.endTime) > now) ?? matches[0];
  }
  return matches[0];
}

/** Blok dat nu loopt en het volgende blok vandaag (voor de cockpit en de briefing). */
export function currentAndNext(blocks: RhythmBlock[], now: number) {
  const sorted = [...blocks].sort((a, b) => a.startTime.localeCompare(b.startTime));
  return {
    current: sorted.find((b) => toMin(b.startTime) <= now && toMin(b.endTime) > now) ?? null,
    next: sorted.find((b) => toMin(b.startTime) > now) ?? null,
  };
}

/** Voor de MCP en de briefing: blokken van vandaag met de titels van de taken erin. */
export async function blockTaskTitles(date: string): Promise<Map<string, string[]>> {
  const rows = await db
    .select({ blockId: tasks.planBlockId, title: tasks.title })
    .from(tasks)
    .where(and(ne(tasks.status, "done"), or(eq(tasks.planDate, date), and(isNull(tasks.planDate), eq(tasks.dueDate, date)))));
  const out = new Map<string, string[]>();
  for (const r of rows) if (r.blockId) out.set(r.blockId, [...(out.get(r.blockId) ?? []), r.title]);
  return out;
}

export { nowMinutes };
