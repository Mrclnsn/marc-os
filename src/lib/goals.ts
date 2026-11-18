import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { clients, goalEntries, goalMilestones, goals, habits, healthSamples, learningTopics, projects, quotes, type Goal, type GoalEntry, type GoalMilestone } from "@/db/schema";
import { revenueOverview } from "./agreements";
import { today, weekStart } from "./dates";
import {
  GOAL_AREAS,
  GOAL_MEASURES,
  GOAL_PER,
  GOAL_SOURCES,
  GOAL_STATUS,
  STATUS_TONE,
  evaluateGoal,
  fmtGoalValue,
  isGoalSource,
  periodBounds,
  periodLabel,
  sourceDef,
  type GoalEval,
  type GoalPer,
  type GoalUnit,
  type Measured,
} from "./goals-shared";
import { habitPeriodStats } from "./habits";
import { healthDays } from "./health";
import { learningMinutes } from "./learning";
import { getModules, MODULES, type Modules } from "./settings";
import { effectiveRates, listTimeEntries } from "./time";

/*
 * Doelen (gesprek 10): flexibel in de app in te richten, met een meetwijze en on-track-status.
 * De berekening zelf (verwacht tegenover werkelijk) staat in goals-shared.ts; hier wordt gemeten.
 * Meetwijzen die afhangen van een uitgeschakelde module (MRR, omzet, uren, uurtarief, offertes) tellen pas
 * mee als die module aan staat; tot die tijd is de status "Module uit".
 */

const optText = z.string().nullable().optional();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optId = z.string().uuid().nullable().optional();

export const goalInput = z.object({
  title: z.string().min(1),
  area: z.enum(Object.keys(GOAL_AREAS) as [keyof typeof GOAL_AREAS]).optional(),
  periodKind: z.enum(["year", "quarter", "month", "custom"]).optional(),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  parentId: optId,
  measure: z.enum(Object.keys(GOAL_MEASURES) as [keyof typeof GOAL_MEASURES]).optional(),
  source: z.string().nullable().optional(),
  habitId: optId,
  learningId: optId,
  targetValue: z.number().nullable().optional(),
  startValue: z.number().nullable().optional(),
  unit: optText,
  targetPer: z.enum(["day", "week", "month"]).nullable().optional(),
  direction: z.enum(["up", "down"]).nullable().optional(),
  curve: z.enum(["linear", "late", "early"]).optional(),
  featured: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  notes: optText,
});
export type GoalInput = z.infer<typeof goalInput>;

/** Periode invullen: bij jaar/kwartaal/maand vanaf de startdatum (standaard vandaag), bij eigen periode beide datums nodig. */
function fillPeriod<T extends Partial<GoalInput>>(data: T, cur?: Goal): T {
  const kind = (data.periodKind ?? cur?.periodKind ?? "year") as "year" | "quarter" | "month" | "custom";
  if (kind === "custom") {
    const start = data.startDate ?? cur?.startDate;
    const end = data.endDate ?? cur?.endDate;
    if (!start || !end) throw new Error("Kies bij een eigen periode een begin- en einddatum.");
    if (end < start) throw new Error("De einddatum ligt vóór de begindatum.");
    return data;
  }
  if (data.periodKind || data.startDate || !cur) {
    const b = periodBounds(kind, data.startDate ?? cur?.startDate ?? today());
    data.startDate = b.start;
    data.endDate = b.end;
  }
  return data;
}

function validate(g: Partial<GoalInput>) {
  const measure = g.measure ?? "manual";
  if (measure === "auto" || measure === "health") {
    if (!isGoalSource(g.source)) throw new Error("Kies wat er automatisch gemeten wordt.");
    if (GOAL_SOURCES[g.source].measure !== measure) throw new Error("Deze bron past niet bij de gekozen meetwijze.");
  }
  if (measure === "habit" && !g.habitId) throw new Error("Kies de gewoonte die je wilt meten.");
  if (["auto", "health", "habit", "manual"].includes(measure) && (g.targetValue == null || !Number.isFinite(g.targetValue))) throw new Error("Vul een doelwaarde in.");
}

/** Standaardwaarden per meetwijze: eenheid, per week/maand, en de startwaarde bij een stand (zodat de voortgang klopt). */
async function withDefaults<T extends Partial<GoalInput>>(data: T, isNew: boolean): Promise<T> {
  const measure = data.measure;
  if (measure && measure !== "auto" && measure !== "health") data.source = null;
  if (measure && measure !== "habit") data.habitId = null;
  if (measure && !(measure === "auto" && data.source === "learning_hours")) data.learningId = null;
  const def = sourceDef(data.source);
  if (def) {
    if (def.agg !== "sum") data.targetPer = null;
    else if (isNew && data.targetPer === undefined) data.targetPer = def.defaultPer ?? null;
    if (data.unit === undefined) data.unit = def.unit === "num" ? (def.noun ?? null) : def.unit;
  } else if (measure === "habit") {
    data.unit = "pct";
    data.targetPer = null;
    if (data.targetValue == null) data.targetValue = 80;
  } else if (measure && measure !== "manual") {
    data.targetPer = null;
  }
  return data;
}

export async function createGoal(input: GoalInput) {
  const parsed = goalInput.parse(input);
  // Gebied: van het bovenliggende doel, anders passend bij de meetwijze
  if (!parsed.area) {
    const [parent] = parsed.parentId ? await db.select({ area: goals.area }).from(goals).where(eq(goals.id, parsed.parentId)) : [];
    const src = sourceDef(parsed.source);
    parsed.area = (parent?.area as GoalInput["area"]) ?? (parsed.measure === "health" ? "gezondheid" : parsed.source === "learning_hours" ? "leren" : parsed.measure === "habit" ? "prive" : src ? "zakelijk" : undefined);
  }
  const data = fillPeriod(await withDefaults({ measure: "manual" as const, ...parsed }, true));
  if (data.measure === "habit" && data.targetValue == null) data.targetValue = 80;
  validate(data);
  if (data.parentId) await assertParent(data.parentId, null);
  // Stand: startwaarde vastleggen bij het aanmaken, zodat "van X naar Y" klopt
  const modules = await getModules();
  const def = sourceDef(data.source);
  // Alleen als de module aan staat; anders volgt de start later uit de eerste meting (of vul hem zelf in)
  if (data.startValue == null && (data.measure === "auto" || data.measure === "health") && def?.agg === "level" && (def.modules ?? []).every((k) => modules[k])) {
    const m = await measureSource(data.source!, { start: data.startDate!, end: data.endDate!, learningId: null }, makeCtx(modules), true);
    if (m.kind === "level" && m.value != null) data.startValue = m.value;
  }
  const [row] = await db
    .insert(goals)
    .values({ ...data, title: data.title, startDate: data.startDate!, endDate: data.endDate! })
    .returning();
  if (row.featured) await setFeatured(row.id);
  return row;
}

export async function updateGoal(id: string, patch: Partial<GoalInput>) {
  const [cur] = await db.select().from(goals).where(eq(goals.id, id));
  if (!cur) throw new Error("Doel niet gevonden");
  const data = fillPeriod(await withDefaults(goalInput.partial().parse(patch), false), cur);
  // Andere bron: eenheid opnieuw bepalen
  if (data.source !== undefined && data.source !== cur.source && data.unit === undefined) {
    const def = sourceDef(data.source);
    data.unit = def ? (def.unit === "num" ? (def.noun ?? null) : def.unit) : null;
  }
  const merged = { ...cur, ...data } as Partial<GoalInput>;
  validate(merged);
  if (data.parentId) await assertParent(data.parentId, id);
  const [row] = await db.update(goals).set(data).where(eq(goals.id, id)).returning();
  if (data.featured) await setFeatured(id);
  return row;
}

/** Een doel kan niet onder zichzelf of onder een van zijn subdoelen hangen. */
async function assertParent(parentId: string, id: string | null) {
  if (parentId === id) throw new Error("Een doel kan niet zijn eigen bovenliggend doel zijn.");
  const all = await db.select({ id: goals.id, parentId: goals.parentId }).from(goals);
  if (!all.some((g) => g.id === parentId)) throw new Error("Bovenliggend doel niet gevonden.");
  let p: string | null = parentId;
  for (let i = 0; p && i < 20; i++) {
    if (p === id) throw new Error("Dat zou een kring maken: kies een ander bovenliggend doel.");
    p = all.find((g) => g.id === p)?.parentId ?? null;
  }
}

/** Hoofddoel in de doelbalk van de cockpit: hooguit één. */
export async function setFeatured(id: string | null) {
  await db.update(goals).set({ featured: false }).where(id ? ne(goals.id, id) : undefined);
  if (id) await db.update(goals).set({ featured: true }).where(eq(goals.id, id));
}

export async function archiveGoal(id: string, archived = true) {
  await db.update(goals).set({ archivedAt: archived ? new Date() : null, ...(archived ? { featured: false } : {}) }).where(eq(goals.id, id));
}

export async function deleteGoal(id: string) {
  const [row] = await db.delete(goals).where(eq(goals.id, id)).returning();
  return row ?? null;
}

/* ---------------- Handmatige metingen ---------------- */

export async function logGoalValue(goalId: string, value: number, date = today(), note: string | null = null, source = "app") {
  const [g] = await db.select().from(goals).where(eq(goals.id, goalId));
  if (!g) throw new Error("Doel niet gevonden");
  if (g.measure !== "manual") throw new Error("Dit doel wordt automatisch gemeten; een getal invullen kan alleen bij een handmatig doel.");
  if (!Number.isFinite(value)) throw new Error("Vul een getal in.");
  if (date > today()) throw new Error("Een meting kan niet in de toekomst liggen.");
  const [row] = await db
    .insert(goalEntries)
    .values({ goalId, date, value, note, source })
    .onConflictDoUpdate({ target: [goalEntries.goalId, goalEntries.date], set: { value, note, source } })
    .returning();
  return row;
}

export async function deleteGoalEntry(id: string) {
  await db.delete(goalEntries).where(eq(goalEntries.id, id));
}

/* ---------------- Mijlpalen ---------------- */

export const milestoneInput = z.object({
  title: z.string().min(1),
  dueDate: isoDate.nullable().optional(),
  done: z.boolean().optional(),
  projectId: optId,
  sortOrder: z.number().int().optional(),
});

export async function addMilestone(goalId: string, input: z.infer<typeof milestoneInput>) {
  const data = milestoneInput.parse(input);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(goalMilestones).where(eq(goalMilestones.goalId, goalId));
  const [row] = await db
    .insert(goalMilestones)
    .values({ goalId, ...data, sortOrder: data.sortOrder ?? n, doneAt: data.done ? today() : null })
    .returning();
  return row;
}

export async function updateMilestone(id: string, patch: Partial<z.infer<typeof milestoneInput>>) {
  const data = milestoneInput.partial().parse(patch);
  const [row] = await db
    .update(goalMilestones)
    .set({ ...data, ...(data.done !== undefined ? { doneAt: data.done ? today() : null } : {}) })
    .where(eq(goalMilestones.id, id))
    .returning();
  return row ?? null;
}

export async function deleteMilestone(id: string) {
  await db.delete(goalMilestones).where(eq(goalMilestones.id, id));
}

/* ------------------------------------------------------------------ */
/* Meten                                                               */
/* ------------------------------------------------------------------ */

type Ctx = { t: string; modules: Modules; cache: Map<string, Promise<unknown>> };
const makeCtx = (modules: Modules): Ctx => ({ t: today(), modules, cache: new Map() });
function memo<T>(ctx: Ctx, key: string, fn: () => Promise<T>): Promise<T> {
  if (!ctx.cache.has(key)) ctx.cache.set(key, fn());
  return ctx.cache.get(key) as Promise<T>;
}

/** Som van een optellende bron tussen twee datums. */
async function sumSource(source: string, from: string, to: string, ctx: Ctx, learningId: string | null): Promise<number> {
  switch (source) {
    case "revenue":
      return memo(ctx, `rev:${from}:${to}`, async () => (await effectiveRates("year", ctx.t, { from, to, clampToTracking: false })).totals.revenueCents / 100);
    case "billable_hours":
      return memo(ctx, `bh:${from}:${to}`, async () => (await listTimeEntries({ from, to, area: "zakelijk" })).filter((e) => e.billable).reduce((s, e) => s + e.minutes, 0) / 60);
    case "quotes_won":
      return memo(ctx, `qw:${from}:${to}`, async () => {
        const [r] = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(quotes)
          .where(and(eq(quotes.status, "accepted"), gte(quotes.decidedAt, from), lte(quotes.decidedAt, to)));
        return r?.n ?? 0;
      });
    case "tasks_done":
      return memo(ctx, `td:${from}:${to}`, async () => {
        const { completedBetween } = await import("./data");
        return (await completedBetween(from, to)).length;
      });
    case "learning_hours":
      return memo(ctx, `lh:${from}:${to}:${learningId ?? ""}`, async () => (await learningMinutes(from, to, learningId)) / 60);
    case "health_sessions":
      return memo(ctx, `hs:${from}:${to}`, async () => (await healthDays(from, to)).reduce((s, d) => s + d.sessions, 0));
    default:
      return 0;
  }
}

/** Meet een automatische bron over [start, min(vandaag, einde)]. `forStart`: alleen de huidige stand (bij aanmaken). */
async function measureSource(source: string, g: { start: string; end: string; learningId: string | null; per?: string | null }, ctx: Ctx, forStart = false): Promise<Measured> {
  const def = sourceDef(source)!;
  const t = ctx.t;
  const to = g.end < t ? g.end : t;
  switch (source) {
    case "mrr": {
      const r = await memo(ctx, "mrr", () => revenueOverview(1));
      return { kind: "level", value: r.mrrCents / 100, start: null };
    }
    case "active_clients": {
      const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(clients).where(eq(clients.status, "active"));
      return { kind: "level", value: r?.n ?? 0, start: null };
    }
    case "weight": {
      const at = async (d: string) =>
        (await db.select({ qty: healthSamples.qty }).from(healthSamples).where(and(eq(healthSamples.metric, "weight"), lte(healthSamples.date, d))).orderBy(desc(healthSamples.at)).limit(1))[0]?.qty ?? null;
      const value = await at(to);
      if (forStart) return { kind: "level", value, start: null };
      // Start: laatste weging vóór of op de startdatum, anders de eerste weging in de periode
      let start = await at(g.start);
      if (start == null) {
        const [first] = await db.select({ qty: healthSamples.qty }).from(healthSamples).where(and(eq(healthSamples.metric, "weight"), gte(healthSamples.date, g.start), lte(healthSamples.date, to))).orderBy(asc(healthSamples.at)).limit(1);
        start = first?.qty ?? null;
      }
      return { kind: "level", value: value == null ? null : Math.round(value * 10) / 10, start: start == null ? null : Math.round(start * 10) / 10 };
    }
    case "effective_rate": {
      const r = await memo(ctx, `er:${g.start}:${to}`, () => effectiveRates("year", t, { from: g.start, to, clampToTracking: true }));
      return { kind: "avg", value: r.totals.rateCents == null ? null : r.totals.rateCents / 100 };
    }
    case "health_steps":
    case "health_exercise":
    case "health_sleep": {
      // Afgelopen dagen (vandaag is nog niet af); slaap: alle nachten met gegevens, ook vannacht
      const days = await memo(ctx, `hd:${g.start}:${to}`, () => healthDays(g.start, to));
      const vals =
        source === "health_sleep"
          ? days.map((d) => (d.sleep?.totalMin ? d.sleep.totalMin / 60 : null))
          : days.filter((d) => d.date < t).map((d) => d.values[source === "health_steps" ? "steps" : "exercise"] ?? null);
      const list = vals.filter((v): v is number => v != null && v > 0);
      return { kind: "avg", value: list.length ? Math.round((list.reduce((s, x) => s + x, 0) / list.length) * 10) / 10 : null, count: list.length };
    }
  }
  if (def.agg === "sum") {
    const total = await sumSource(source, g.start, to, ctx, g.learningId);
    let current: { label: string; value: number } | null = null;
    // Bij een doel per week of maand: ook de stand van deze week/maand
    if ((g.per === "week" || g.per === "month") && t <= g.end && t >= g.start) {
      const from = g.per === "week" ? weekStart(t) : `${t.slice(0, 7)}-01`;
      const f = from > g.start ? from : g.start;
      current = { label: g.per === "week" ? "Deze week" : "Deze maand", value: Math.round((await sumSource(source, f, t, ctx, g.learningId)) * 10) / 10 };
    }
    return { kind: "sum", total: Math.round(total * 100) / 100, current };
  }
  return { kind: "avg", value: null };
}

export type GoalRow = Goal & {
  eval: GoalEval;
  periodLabel: string;
  areaLabel: string;
  measureLabel: string;
  sourceLabel: string | null;
  /** Notatie van waarden (eur, hours, kg, pct, num) en het zelfstandig naamwoord ("sessies") */
  unitType: GoalUnit | string | null;
  noun: string | null;
  parentTitle: string | null;
  habitTitle: string | null;
  learningTitle: string | null;
  childIds: string[];
  milestones: { done: number; total: number };
  /** Wacht op een module die uit staat */
  inactiveModules: string[];
};

type Loaded = { list: Goal[]; ms: GoalMilestone[]; entries: GoalEntry[]; projectsDone: Set<string>; habitTitles: Map<string, string>; learningTitles: Map<string, string> };

async function loadAll(includeArchived: boolean): Promise<Loaded> {
  const list = await db
    .select()
    .from(goals)
    .where(includeArchived ? undefined : isNull(goals.archivedAt))
    .orderBy(desc(goals.featured), asc(goals.sortOrder), asc(goals.createdAt));
  const ids = list.map((g) => g.id);
  const [ms, entries, ps, hs, ls] = await Promise.all([
    ids.length ? db.select().from(goalMilestones).where(inArray(goalMilestones.goalId, ids)).orderBy(asc(goalMilestones.sortOrder), asc(goalMilestones.createdAt)) : [],
    ids.length ? db.select().from(goalEntries).where(inArray(goalEntries.goalId, ids)).orderBy(asc(goalEntries.date)) : [],
    db.select({ id: projects.id }).from(projects).where(eq(projects.status, "done")),
    db.select({ id: habits.id, title: habits.title }).from(habits),
    db.select({ id: learningTopics.id, title: learningTopics.title }).from(learningTopics),
  ]);
  return {
    list,
    ms,
    entries,
    projectsDone: new Set(ps.map((p) => p.id)),
    habitTitles: new Map(hs.map((h) => [h.id, h.title])),
    learningTitles: new Map(ls.map((l) => [l.id, l.title])),
  };
}

const milestoneDone = (m: GoalMilestone, projectsDone: Set<string>) => m.done || (!!m.projectId && projectsDone.has(m.projectId));

async function evaluate(g: Goal, all: Loaded, ctx: Ctx, rows: Map<string, GoalRow>, depth = 0): Promise<GoalRow> {
  const cached = rows.get(g.id);
  if (cached) return cached;
  const def = sourceDef(g.source);
  const children = all.list.filter((c) => c.parentId === g.id);
  const myMs = all.ms.filter((m) => m.goalId === g.id);
  const msDone = myMs.filter((m) => milestoneDone(m, all.projectsDone)).length;
  const inactiveModules = (def?.modules ?? []).filter((k) => !ctx.modules[k]).map((k) => MODULES[k].label);
  let unitType: GoalUnit | string | null = g.unit;
  let noun: string | null = null;
  if (def) {
    unitType = def.unit;
    noun = def.noun ?? null;
  } else if (g.measure === "habit") unitType = "pct";
  else if (g.measure === "manual") {
    unitType = g.unit && ["eur", "eur_h", "hours", "kg", "pct"].includes(g.unit) ? g.unit : "num";
    noun = unitType === "num" ? g.unit : null;
  }

  let ev: GoalEval;
  try {
    let m: Measured;
    if (inactiveModules.length) {
      m = { kind: "avg", value: null };
    } else if ((g.measure === "auto" || g.measure === "health") && def) {
      m = await measureSource(g.source!, { start: g.startDate, end: g.endDate, learningId: g.learningId, per: g.targetPer }, ctx);
      // Stand: de vastgelegde startwaarde gaat voor (bij gewicht anders de weging rond de start)
      if (m.kind === "level") m.start = g.startValue ?? m.start;
    } else if (g.measure === "habit") {
      const s = g.habitId ? await habitPeriodStats(g.habitId, g.startDate, g.endDate) : null;
      m = { kind: "avg", value: s?.pct ?? null, count: undefined };
    } else if (g.measure === "manual") {
      const mine = all.entries.filter((e) => e.goalId === g.id && e.date <= ctx.t);
      const last = mine.at(-1);
      const first = mine.find((e) => e.date >= g.startDate) ?? mine[0];
      m = { kind: "level", value: last?.value ?? null, start: g.startValue ?? (mine.filter((e) => e.date <= g.startDate).at(-1)?.value ?? first?.value ?? null) };
    } else if (g.measure === "milestones") {
      const dated = myMs.filter((x) => x.dueDate);
      const expected = myMs.length && dated.length === myMs.length ? dated.filter((x) => x.dueDate! < ctx.t).length / myMs.length : null;
      m = { kind: "fraction", done: msDone, total: myMs.length, expected, noun: "mijlpalen" };
    } else {
      // Subdoelen: gemiddelde voortgang (hooguit 100% per subdoel)
      const evs = depth < 4 ? await Promise.all(children.filter((c) => !c.archivedAt).map((c) => evaluate(c, all, ctx, rows, depth + 1))) : [];
      const done = evs.reduce((s, r) => s + Math.min(1, (r.eval.pct ?? 0) / 100), 0);
      m = { kind: "fraction", done: Math.round(done * 100) / 100, total: evs.length, noun: "subdoelen" };
    }
    ev = evaluateGoal(g, m, unitType, noun, ctx.t);
    if (inactiveModules.length) {
      ev = { ...ev, status: "inactive", valueLabel: "–", pct: null, expectedPct: null, ratio: null, needed: null, summary: `Telt mee zodra de module ${inactiveModules.join(" en ")} aan staat (Instellingen → Modules).` };
    } else if (g.measure === "habit" && g.habitId) {
      const title = all.habitTitles.get(g.habitId);
      ev = { ...ev, summary: `${title ? `${title}: ` : ""}${ev.summary.replace("Gemiddeld", "gedaan").replace(/, doel/, " van wat moest, doel")}` };
    }
  } catch (e) {
    ev = { status: "no_data", valueLabel: "–", targetLabel: fmtGoalValue(g.targetValue, unitType, noun), pct: null, expectedPct: null, ratio: null, timeFraction: 0, daysLeft: 0, summary: `Meten lukte niet: ${e instanceof Error ? e.message : String(e)}`, needed: null };
  }

  const row: GoalRow = {
    ...g,
    eval: ev,
    periodLabel: periodLabel(g),
    areaLabel: GOAL_AREAS[g.area as keyof typeof GOAL_AREAS] ?? g.area,
    measureLabel: GOAL_MEASURES[g.measure as keyof typeof GOAL_MEASURES] ?? g.measure,
    sourceLabel: def?.label ?? null,
    unitType,
    noun,
    parentTitle: all.list.find((p) => p.id === g.parentId)?.title ?? null,
    habitTitle: g.habitId ? (all.habitTitles.get(g.habitId) ?? null) : null,
    learningTitle: g.learningId ? (all.learningTitles.get(g.learningId) ?? null) : null,
    childIds: children.map((c) => c.id),
    milestones: { done: msDone, total: myMs.length },
    inactiveModules,
  };
  rows.set(g.id, row);
  return row;
}

/** Alle doelen met status. Standaard zonder gearchiveerde. Volgorde: hoofddoel, lopend, komend, afgelopen. */
export async function listGoals(opts: { includeArchived?: boolean } = {}): Promise<GoalRow[]> {
  const ctx = makeCtx(await getModules());
  const all = await loadAll(!!opts.includeArchived);
  const rows = new Map<string, GoalRow>();
  const out: GoalRow[] = [];
  for (const g of all.list) out.push(await evaluate(g, all, ctx, rows));
  const phase = (r: GoalRow) => (r.archivedAt ? 3 : r.startDate > ctx.t ? 1 : r.endDate < ctx.t ? 2 : 0);
  return out.sort((a, b) => phase(a) - phase(b) || Number(b.featured) - Number(a.featured) || a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime());
}

export type GoalDetail = GoalRow & { entries: GoalEntry[]; milestoneList: (GoalMilestone & { isDone: boolean; projectName: string | null })[]; children: GoalRow[] };

export async function getGoal(id: string): Promise<GoalDetail | null> {
  const ctx = makeCtx(await getModules());
  const all = await loadAll(true);
  const g = all.list.find((x) => x.id === id);
  if (!g) return null;
  const rows = new Map<string, GoalRow>();
  const row = await evaluate(g, all, ctx, rows);
  const children = await Promise.all(all.list.filter((c) => c.parentId === id).map((c) => evaluate(c, all, ctx, rows)));
  const myMs = all.ms.filter((m) => m.goalId === id);
  const pids = myMs.map((m) => m.projectId).filter((x): x is string => !!x);
  const pnames = pids.length ? await db.select({ id: projects.id, name: projects.name }).from(projects).where(inArray(projects.id, pids)) : [];
  return {
    ...row,
    entries: all.entries.filter((e) => e.goalId === id).reverse(),
    milestoneList: myMs.map((m) => ({ ...m, isDone: milestoneDone(m, all.projectsDone), projectName: pnames.find((p) => p.id === m.projectId)?.name ?? null })),
    children,
  };
}

/** Op id of (deel van de) titel, voor de MCP en straks WhatsApp. */
export async function findGoal(ref: string): Promise<Goal | null> {
  if (/^[0-9a-f-]{36}$/i.test(ref)) {
    const [g] = await db.select().from(goals).where(eq(goals.id, ref));
    return g ?? null;
  }
  const list = await db.select().from(goals).where(isNull(goals.archivedAt));
  const q = ref.trim().toLowerCase();
  return list.find((g) => g.title.toLowerCase() === q) ?? list.find((g) => g.title.toLowerCase().includes(q)) ?? list.find((g) => q.includes(g.title.toLowerCase())) ?? null;
}

/* ---------------- Voor cockpit, overzicht en weekreview ---------------- */

export type GoalBarData = {
  goal: GoalRow | null;
  /** Lopende doelen per toon: goed (voor/op schema/gehaald), let op (achter), slecht (risico) */
  counts: { good: number; warn: number; bad: number; total: number };
  atRisk: GoalRow[];
};

/** Het hoofddoel (gekozen, anders het eerste lopende doel bovenaan) en hoe de andere lopende doelen ervoor staan. */
export async function goalBar(): Promise<GoalBarData> {
  const list = await listGoals();
  const t = today();
  const running = list.filter((g) => g.startDate <= t && g.endDate >= t);
  const goal = running.find((g) => g.featured) ?? list.find((g) => g.featured) ?? running.find((g) => !g.parentId) ?? null;
  const counts = { good: 0, warn: 0, bad: 0, total: 0 };
  for (const g of running) {
    if (g.eval.status === "inactive" || g.eval.status === "no_data") continue;
    const tone = STATUS_TONE[g.eval.status];
    counts.total++;
    if (tone === "good") counts.good++;
    else if (tone === "warn") counts.warn++;
    else if (tone === "bad") counts.bad++;
  }
  return { goal, counts, atRisk: running.filter((g) => g.eval.status === "at_risk") };
}

/** Compacte weergave voor de MCP (Claude, straks Hermes). */
export function slimGoal(g: GoalRow) {
  return {
    id: g.id,
    title: g.title,
    area: g.area,
    period: g.periodLabel,
    startDate: g.startDate,
    endDate: g.endDate,
    parent: g.parentTitle,
    measure: g.measure,
    source: g.source ?? undefined,
    habit: g.habitTitle ?? undefined,
    learning: g.learningTitle ?? undefined,
    target: g.eval.targetLabel,
    targetValue: g.targetValue,
    targetPer: g.targetPer ? GOAL_PER[g.targetPer as GoalPer] : undefined,
    startValue: g.startValue ?? undefined,
    current: g.eval.valueLabel,
    status: g.eval.status,
    statusLabel: GOAL_STATUS[g.eval.status],
    progressPct: g.eval.pct,
    expectedPct: g.eval.expectedPct,
    ratio: g.eval.ratio == null ? null : Math.round(g.eval.ratio * 100) / 100,
    daysLeft: g.eval.daysLeft,
    summary: g.eval.summary,
    needed: g.eval.needed ?? undefined,
    milestones: g.milestones.total ? g.milestones : undefined,
    subgoals: g.childIds.length || undefined,
    featured: g.featured || undefined,
    archived: g.archivedAt ? true : undefined,
  };
}

/** Alleen de doelen die nu lopen (voor get_overview). */
export async function runningGoals() {
  const t = today();
  return (await listGoals()).filter((g) => g.startDate <= t && g.endDate >= t);
}

