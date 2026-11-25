import "server-only";
import { and, asc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { habitChecks, habits, rhythmBlocks, type Habit } from "@/db/schema";
import { addDaysIso, today, weekStart } from "./dates";
import { frequencyLabel, habitMoment, habitWhenLabel, HABIT_MOMENT_KEYS, isoWeekday, momentOfTime, type HabitMoment } from "./rhythm-shared";

/*
 * Gewoontes (gesprek 8): afvinken per dag, met reeks (streak) en percentage per week en maand.
 *
 * Frequenties:
 *   daily   elke dag
 *   days    vaste weekdagen (bijv. ma, wo, vr)
 *   weekly  x keer per week, op welke dag dan ook
 *
 * Reeks: daily en days tellen opeenvolgende dagen waarop de gewoonte moest en gedaan is;
 * weekly telt opeenvolgende weken waarin het weekdoel is gehaald.
 * Vandaag (of deze week) breekt de reeks nog niet zolang de dag (week) loopt.
 *
 * Percentage: gedaan / verwacht tot en met vandaag. Vandaag telt alleen mee als hij al is afgevinkt,
 * zodat je 's ochtends niet op 0% staat. Bij weekly: aantal keer tegenover het weekdoel (naar rato in de maand).
 */

export const habitInput = z.object({
  title: z.string().min(1),
  area: z.enum(["zakelijk", "prive"]).optional(),
  frequency: z.enum(["daily", "weekly", "days"]).optional(),
  timesPerWeek: z.number().int().min(1).max(7).nullable().optional(),
  weekdays: z.array(z.number().int().min(1).max(7)).optional(),
  blockId: z.string().uuid().nullable().optional(),
  /** Vast tijdstip HH:mm (optioneel) */
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Tijd als UU:MM").nullable().optional(),
  /** Dagdeel zonder vast tijdstip */
  moment: z.enum(["ochtend", "middag", "avond"]).nullable().optional(),
  /** Pushmelding op het tijdstip */
  remind: z.boolean().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sortOrder: z.number().int().optional(),
  notes: z.string().nullable().optional(),
  /** Automatisch afvinken uit Apple Health (gesprek 9); null = alleen met de hand */
  healthRule: z
    .object({
      metric: z.enum(["workout", "steps", "exercise", "active_energy", "sleep"]),
      min: z.number().min(0),
      kind: z.string().nullable().optional(),
      minMinutes: z.number().int().min(0).nullable().optional(),
    })
    .nullable()
    .optional(),
});
export type HabitInput = z.infer<typeof habitInput>;

/** Tijdstip en dagdeel netjes houden: met een tijd volgt het dagdeel daaruit; herinnering alleen met een tijd. */
function normalizeTime<T extends { time?: string | null; moment?: string | null; remind?: boolean }>(d: T, cur?: { time: string | null }): T {
  const time = d.time !== undefined ? d.time : (cur?.time ?? null);
  if (d.time !== undefined && d.time) d.moment = momentOfTime(d.time);
  if (!time && d.remind) d.remind = false;
  if (d.time === null && d.remind === undefined) d.remind = false;
  return d;
}

function validate(h: { frequency?: string; timesPerWeek?: number | null; weekdays?: number[] }) {
  if (h.frequency === "weekly" && !h.timesPerWeek) throw new Error("Hoe vaak per week? Vul een aantal in (1 tot 7).");
  if (h.frequency === "days" && !h.weekdays?.length) throw new Error("Kies op welke dagen.");
}

export async function createHabit(input: HabitInput) {
  const data = normalizeTime(habitInput.parse(input));
  const merged = { frequency: data.frequency ?? "daily", timesPerWeek: data.timesPerWeek ?? null, weekdays: data.weekdays ?? [] };
  validate(merged);
  const [row] = await db
    .insert(habits)
    .values({ ...data, ...merged, weekdays: [...new Set(merged.weekdays)].sort(), startDate: data.startDate ?? today() })
    .returning();
  if (row.healthRule) await reapplyHealth(row.id);
  return row;
}

export async function updateHabit(id: string, patch: Partial<HabitInput>) {
  const [cur] = await db.select().from(habits).where(eq(habits.id, id));
  if (!cur) throw new Error("Gewoonte niet gevonden");
  const data = normalizeTime(habitInput.partial().parse(patch), cur);
  validate({ frequency: data.frequency ?? cur.frequency, timesPerWeek: data.timesPerWeek !== undefined ? data.timesPerWeek : cur.timesPerWeek, weekdays: data.weekdays ?? cur.weekdays });
  if (data.weekdays) data.weekdays = [...new Set(data.weekdays)].sort();
  const [row] = await db.update(habits).set(data).where(eq(habits.id, id)).returning();
  if (data.healthRule !== undefined) await reapplyHealth(id);
  return row;
}

/**
 * Na het instellen of wijzigen van een gezondheidsregel de laatste 28 dagen opnieuw bekijken.
 * Zonder regel blijven eerdere automatische vinkjes staan (ze waren terecht).
 */
async function reapplyHealth(id: string) {
  const { applyHealthRules } = await import("./health");
  await applyHealthRules({ habitId: id });
}

/** Stoppen met een gewoonte: verdwijnt uit de cockpit, de historie blijft. */
export async function archiveHabit(id: string, archived = true) {
  await db.update(habits).set({ archivedAt: archived ? new Date() : null }).where(eq(habits.id, id));
}

export async function deleteHabit(id: string) {
  await db.delete(habits).where(eq(habits.id, id));
}

/** Afvinken (done=true) of het vinkje weghalen voor een dag. */
export async function checkHabit(id: string, date: string, done = true, source = "app") {
  const [h] = await db.select({ id: habits.id, startDate: habits.startDate }).from(habits).where(eq(habits.id, id));
  if (!h) throw new Error("Gewoonte niet gevonden");
  if (date > today()) throw new Error("Je kunt een gewoonte niet vooruit afvinken.");
  // Een vinkje van vóór de startdatum (bijv. de eerste dagen nog bijwerken) schuift de start mee
  if (done && date < h.startDate) await db.update(habits).set({ startDate: date }).where(eq(habits.id, id));
  if (done) await db.insert(habitChecks).values({ habitId: id, date, source }).onConflictDoNothing();
  else await db.delete(habitChecks).where(and(eq(habitChecks.habitId, id), eq(habitChecks.date, date)));
}

/** Gewoonte op naam (voor de MCP en straks WhatsApp: "sport gedaan"). */
export async function findHabit(ref: string): Promise<Habit | null> {
  if (/^[0-9a-f-]{36}$/i.test(ref)) {
    const [h] = await db.select().from(habits).where(eq(habits.id, ref));
    return h ?? null;
  }
  const list = await db.select().from(habits).where(isNull(habits.archivedAt));
  const q = ref.trim().toLowerCase();
  return list.find((h) => h.title.toLowerCase() === q) ?? list.find((h) => h.title.toLowerCase().includes(q)) ?? list.find((h) => q.includes(h.title.toLowerCase())) ?? null;
}

/* ------------------------------------------------------------------ */
/* Statistieken                                                        */
/* ------------------------------------------------------------------ */

export type HabitDay = { date: string; due: boolean; done: boolean };

export type HabitStats = Habit & {
  blockTitle: string | null;
  blockStart: string | null;
  frequencyLabel: string;
  /** Dagen plus tijdstip of dagdeel, bijv. "werkdagen om 07:30" */
  whenLabel: string;
  /** Dagdeel voor de groepering (uit tijd, gekozen dagdeel of blok); null = op elk moment */
  momentKey: HabitMoment | null;
  /** Moet vandaag (daily, days) of nog nodig deze week (weekly) */
  dueToday: boolean;
  doneToday: boolean;
  streak: number;
  streakUnit: "dagen" | "weken";
  week: { done: number; target: number; pct: number | null };
  month: { done: number; target: number; pct: number | null };
  /** Laatste 28 dagen, oudste eerst */
  history: HabitDay[];
};

const isDueDay = (h: Habit, date: string) => date >= h.startDate && (h.frequency === "days" ? h.weekdays.includes(isoWeekday(date)) : true);

function statsFor(h: Habit, checked: Set<string>, t: string): Omit<HabitStats, keyof Habit | "blockTitle" | "blockStart" | "whenLabel" | "momentKey"> {
  const doneToday = checked.has(t);
  const monday = weekStart(t);
  const monthStart = `${t.slice(0, 8)}01`;
  const countIn = (from: string, to: string) => [...checked].filter((d) => d >= from && d <= to).length;

  let streak = 0;
  let dueToday: boolean;
  let week: HabitStats["week"];
  let month: HabitStats["month"];

  if (h.frequency === "weekly") {
    const target = h.timesPerWeek ?? 1;
    const thisWeek = countIn(monday, t);
    dueToday = t >= h.startDate && (thisWeek < target || doneToday);
    // Reeks in weken: deze week telt als het doel al gehaald is
    let ws = thisWeek >= target ? monday : addDaysIso(monday, -7);
    while (addDaysIso(ws, 6) >= h.startDate && streak < 520) {
      if (countIn(ws, addDaysIso(ws, 6)) >= target) streak++;
      else break;
      ws = addDaysIso(ws, -7);
    }
    week = { done: thisWeek, target, pct: Math.round((Math.min(thisWeek, target) / target) * 100) };
    const from = monthStart > h.startDate ? monthStart : h.startDate;
    const days = from <= t ? Math.round((Date.parse(t) - Date.parse(from)) / 86_400_000) + 1 : 0;
    const expected = (target * days) / 7;
    const doneMonth = countIn(monthStart, t);
    month = { done: doneMonth, target: Math.ceil(expected), pct: expected > 0 ? Math.min(100, Math.round((doneMonth / expected) * 100)) : null };
  } else {
    dueToday = isDueDay(h, t);
    // Reeks in dagen: alleen dagen waarop de gewoonte moest
    let d = dueToday && !doneToday ? addDaysIso(t, -1) : t;
    for (let i = 0; i < 3660 && d >= h.startDate; i++) {
      if (isDueDay(h, d)) {
        if (checked.has(d)) streak++;
        else break;
      }
      d = addDaysIso(d, -1);
    }
    const pctBetween = (from: string) => {
      let target = 0;
      let done = 0;
      for (let x = from; x <= t; x = addDaysIso(x, 1)) {
        if (!isDueDay(h, x)) continue;
        if (x === t && !doneToday) continue;
        target++;
        if (checked.has(x)) done++;
      }
      return { done, target, pct: target ? Math.round((done / target) * 100) : null };
    };
    week = pctBetween(monday);
    month = pctBetween(monthStart);
  }

  const history: HabitDay[] = Array.from({ length: 28 }, (_, i) => {
    const date = addDaysIso(t, i - 27);
    return { date, due: h.frequency === "weekly" ? date >= h.startDate : isDueDay(h, date), done: checked.has(date) };
  });

  return {
    frequencyLabel: frequencyLabel(h),
    dueToday,
    doneToday,
    streak,
    streakUnit: h.frequency === "weekly" ? "weken" : "dagen",
    week,
    month,
    history,
  };
}

/** Gewoontes met reeks en percentages. Standaard alleen de actieve. */
export async function listHabits(opts: { includeArchived?: boolean; date?: string } = {}): Promise<HabitStats[]> {
  const t = opts.date ?? today();
  const list = await db
    .select({ habit: habits, blockTitle: rhythmBlocks.title, blockStart: rhythmBlocks.startTime })
    .from(habits)
    .leftJoin(rhythmBlocks, eq(habits.blockId, rhythmBlocks.id))
    .where(opts.includeArchived ? undefined : isNull(habits.archivedAt))
    .orderBy(asc(habits.sortOrder), asc(habits.createdAt));
  if (!list.length) return [];
  // Genoeg historie voor reeksen tot een jaar plus de maand; langere reeksen tellen door vanaf de oudste check
  const earliest = list.reduce((m, r) => (r.habit.startDate < m ? r.habit.startDate : m), t);
  const from = earliest > addDaysIso(t, -400) ? earliest : addDaysIso(t, -400);
  const checks = await db
    .select({ habitId: habitChecks.habitId, date: habitChecks.date })
    .from(habitChecks)
    .where(and(inArray(habitChecks.habitId, list.map((r) => r.habit.id)), gte(habitChecks.date, from), lte(habitChecks.date, t)));
  const out = list.map(({ habit, blockTitle, blockStart }) => {
    const set = new Set(checks.filter((c) => c.habitId === habit.id).map((c) => c.date));
    return { ...habit, blockTitle, blockStart, ...statsFor(habit, set, t), whenLabel: habitWhenLabel(habit), momentKey: habitMoment({ ...habit, blockStart }) };
  });
  // Volgorde van de dag: ochtend, middag, avond, dan "op elk moment"; binnen een dagdeel op tijd
  const rank = (h: (typeof out)[number]) => (h.momentKey ? HABIT_MOMENT_KEYS.indexOf(h.momentKey) : 3);
  return out.sort((a, b) => rank(a) - rank(b) || (a.time ?? a.blockStart ?? "99").localeCompare(b.time ?? b.blockStart ?? "99") || a.sortOrder - b.sortOrder);
}

/** Samenvatting voor de cockpit en meldingen: hoeveel van de gewoontes van vandaag zijn gedaan. */
export function habitSummary(list: HabitStats[]) {
  const today_ = list.filter((h) => h.dueToday || h.doneToday);
  const done = today_.filter((h) => h.doneToday).length;
  const weekPcts = list.map((h) => h.week.pct).filter((p): p is number => p !== null);
  return {
    total: today_.length,
    done,
    open: today_.filter((h) => !h.doneToday),
    weekPct: weekPcts.length ? Math.round(weekPcts.reduce((s, p) => s + p, 0) / weekPcts.length) : null,
  };
}

/**
 * Percentage over een eigen periode (doelen, gesprek 10): gedaan tegenover verwacht van `from` tot en met `to`
 * (maar niet na vandaag). Vandaag telt alleen mee als hij al is afgevinkt, net als bij week en maand.
 */
export async function habitPeriodStats(id: string, from: string, to: string): Promise<{ title: string; done: number; expected: number; pct: number | null; streak: number; streakUnit: string } | null> {
  const t = today();
  const stats = (await listHabits({ includeArchived: true, date: t })).find((h) => h.id === id);
  if (!stats) return null;
  const h = stats as Habit;
  const begin = from > h.startDate ? from : h.startDate;
  const end = to < t ? to : t;
  if (begin > end) return { title: h.title, done: 0, expected: 0, pct: null, streak: stats.streak, streakUnit: stats.streakUnit };
  const rows = await db
    .select({ date: habitChecks.date })
    .from(habitChecks)
    .where(and(eq(habitChecks.habitId, id), gte(habitChecks.date, begin), lte(habitChecks.date, end)));
  const checked = new Set(rows.map((r) => r.date));
  let expected = 0;
  let days = 0;
  for (let d = begin; d <= end; d = addDaysIso(d, 1)) {
    if (d === t && !checked.has(d)) continue;
    days++;
    if (h.frequency !== "weekly" && isDueDay(h, d)) expected++;
  }
  if (h.frequency === "weekly") expected = ((h.timesPerWeek ?? 1) * days) / 7;
  const done = checked.size;
  return { title: h.title, done, expected: Math.round(expected * 10) / 10, pct: expected > 0 ? Math.min(100, Math.round((done / expected) * 100)) : null, streak: stats.streak, streakUnit: stats.streakUnit };
}
