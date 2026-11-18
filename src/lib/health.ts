import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { habitChecks, habits, healthImports, healthSamples, healthSleep, healthWorkouts, settings, type HealthRule, type HealthSleep, type HealthWorkout } from "@/db/schema";
import { addDaysIso, today, weekStart } from "./dates";
import {
  DEFAULT_HEALTH_GOALS,
  METRICS,
  WORKOUT_KIND_KEYS,
  countsAsSession,
  parseHealthExport,
  workoutKind,
  type HealthGoals,
  type MetricKey,
} from "./health-shared";

/*
 * Gezondheid (gesprek 9): Apple Health komt binnen via de iPhone-app Health Auto Export, die elke dag (of vaker)
 * een JSON-zending stuurt naar POST /api/health/import met een eigen sleutel (los van de MCP-token).
 * Bewaard worden metingen per dag of uur (health_samples), slaap per nacht (health_sleep) en trainingen (health_workouts).
 * Na elke zending worden gewoontes met een gezondheidsregel automatisch afgevinkt (bron "health").
 */

/* ------------------------------------------------------------------ */
/* Instellingen: sleutel en doelen                                     */
/* ------------------------------------------------------------------ */

async function readSetting<T>(key: string): Promise<T | null> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  return (row?.value as T) ?? null;
}
async function writeSetting(key: string, value: unknown) {
  await db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

/** Sleutel voor Health Auto Export. Wordt bij het eerste gebruik aangemaakt. */
export async function getHealthToken(): Promise<string> {
  const cur = await readSetting<{ token: string }>("health_token");
  if (cur?.token) return cur.token;
  return regenerateHealthToken();
}

/** Nieuwe sleutel: de oude werkt direct niet meer (in Health Auto Export de header aanpassen). */
export async function regenerateHealthToken(): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await writeSetting("health_token", { token, createdAt: new Date().toISOString() });
  return token;
}

export async function healthTokenOk(token: string | null | undefined): Promise<boolean> {
  if (!token) return false;
  const cur = await readSetting<{ token: string }>("health_token");
  if (!cur?.token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(cur.token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const healthGoalsInput = z.object({
  sessionsPerWeek: z.number().int().min(0).max(21),
  stepsPerDay: z.number().int().min(0).max(100000),
  exercisePerDay: z.number().int().min(0).max(600),
  sleepHours: z.number().min(0).max(14),
  kcalPerDay: z.number().int().min(0).max(10000).nullable(),
  proteinPerDay: z.number().int().min(0).max(1000).nullable(),
  weightKg: z.number().min(20).max(400).nullable(),
});

export async function getHealthGoals(): Promise<HealthGoals> {
  const stored = (await readSetting<Partial<HealthGoals>>("health_goals")) ?? {};
  return { ...DEFAULT_HEALTH_GOALS, ...stored };
}

export async function setHealthGoals(patch: Partial<HealthGoals>): Promise<HealthGoals> {
  const next = healthGoalsInput.parse({ ...(await getHealthGoals()), ...patch });
  await writeSetting("health_goals", next);
  return next;
}

/* ------------------------------------------------------------------ */
/* Ontvangen                                                           */
/* ------------------------------------------------------------------ */

export type ImportResult = { samples: number; workouts: number; sleep: number; from: string | null; to: string | null; skipped: string[]; habitsChecked: number; habitsUnchecked: number };

const chunk = <T,>(arr: T[], n: number) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

/** Een zending van Health Auto Export verwerken. Opnieuw sturen is veilig: alles wordt overschreven, niets dubbel. */
export async function importHealth(body: unknown): Promise<ImportResult> {
  let parsed;
  try {
    parsed = parseHealthExport(body);
  } catch (e) {
    await db.insert(healthImports).values({ error: `Niet te lezen: ${e instanceof Error ? e.message : String(e)}` });
    throw e;
  }
  const t = today();
  const { samples, sleep, workouts, skipped } = parsed;

  // Metingen: uniek per meting en tijdstip
  for (const part of chunk(samples, 400)) {
    if (!part.length) continue;
    await db
      .insert(healthSamples)
      .values(part.map((s) => ({ metric: s.metric, date: s.date, at: s.at, qty: s.qty, unit: s.unit, source: s.source })))
      .onConflictDoUpdate({
        target: [healthSamples.metric, healthSamples.at],
        set: { qty: sql`excluded.qty`, unit: sql`excluded.unit`, source: sql`excluded.source`, date: sql`excluded.date`, receivedAt: new Date() },
      });
  }
  // Waarde per hele dag: oudere uurwaarden van die dag vervallen (anders telt het dubbel)
  const dayLevel = new Map<MetricKey, { dates: string[]; ats: Date[] }>();
  for (const s of samples.filter((x) => x.dayLevel)) {
    const cur = dayLevel.get(s.metric) ?? { dates: [], ats: [] };
    cur.dates.push(s.date);
    cur.ats.push(s.at);
    dayLevel.set(s.metric, cur);
  }
  for (const [metric, { dates, ats }] of dayLevel) {
    await db.delete(healthSamples).where(and(eq(healthSamples.metric, metric), inArray(healthSamples.date, dates), notInArray(healthSamples.at, ats)));
  }

  for (const s of sleep) {
    const values = { ...s, receivedAt: new Date() };
    await db.insert(healthSleep).values(values).onConflictDoUpdate({ target: healthSleep.date, set: values });
  }

  for (const w of workouts) {
    const values = { ...w, source: "health" as const };
    const update = { ...values, externalId: undefined };
    await db
      .insert(healthWorkouts)
      .values(values)
      .onConflictDoUpdate({ target: healthWorkouts.externalId, set: { ...update, updatedAt: new Date() } });
  }

  const dates = [...new Set([...samples.map((s) => s.date), ...sleep.map((s) => s.date), ...workouts.map((w) => w.date)])].filter((d) => d <= t).sort();
  const from = dates[0] ?? null;
  const to = dates.at(-1) ?? null;
  const habitsResult = await applyHealthRules({ dates });
  await db.insert(healthImports).values({ samples: samples.length, workouts: workouts.length, sleep: sleep.length, fromDate: from, toDate: to, skipped });
  // Logboek klein houden
  await db.execute(sql`delete from health_imports where id not in (select id from health_imports order by received_at desc limit 200)`);
  return { samples: samples.length, workouts: workouts.length, sleep: sleep.length, from, to, skipped, ...habitsResult };
}

export async function listHealthImports(limit = 10) {
  return db.select().from(healthImports).orderBy(desc(healthImports.receivedAt)).limit(limit);
}

/** Laatste geslaagde zending; null als er nog nooit iets binnenkwam. */
export async function lastHealthImport() {
  const [row] = await db.select().from(healthImports).where(isNull(healthImports.error)).orderBy(desc(healthImports.receivedAt)).limit(1);
  return row ?? null;
}

/* ------------------------------------------------------------------ */
/* Trainingen met de hand                                              */
/* ------------------------------------------------------------------ */

export const workoutInput = z.object({
  name: z.string().min(1),
  kind: z.enum(WORKOUT_KIND_KEYS as [string, ...string[]]).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  durationMin: z.number().int().min(1).max(24 * 60),
  activeKcal: z.number().int().min(0).nullable().optional(),
  distanceKm: z.number().min(0).nullable().optional(),
  notes: z.string().nullable().optional(),
  source: z.enum(["app", "mcp", "whatsapp"]).optional(),
});
export type WorkoutInput = z.infer<typeof workoutInput>;

/** Training vastleggen die niet via Apple Health binnenkomt (bijv. als Virtuagym niet naar Apple Health schrijft). */
export async function addWorkout(input: WorkoutInput): Promise<HealthWorkout> {
  const d = workoutInput.parse(input);
  if (d.date > today()) throw new Error("Een training kan niet in de toekomst liggen.");
  const [row] = await db
    .insert(healthWorkouts)
    .values({
      name: d.name.trim(),
      kind: d.kind ?? workoutKind(d.name),
      date: d.date,
      startAt: d.time ? localTimestamp(d.date, d.time) : null,
      durationMin: d.durationMin,
      activeKcal: d.activeKcal ?? null,
      distanceKm: d.distanceKm ?? null,
      notes: d.notes ?? null,
      source: d.source ?? "app",
    })
    .returning();
  await applyHealthRules({ dates: [d.date] });
  return row;
}

export async function updateWorkout(id: string, patch: { kind?: string; notes?: string | null; name?: string }) {
  const [row] = await db.update(healthWorkouts).set({ ...patch, updatedAt: new Date() }).where(eq(healthWorkouts.id, id)).returning();
  if (!row) throw new Error("Training niet gevonden");
  await applyHealthRules({ dates: [row.date] });
  return row;
}

/** Training verwijderen. Uit Apple Health komt hij terug bij de volgende zending, tenzij hij daar ook weg is. */
export async function deleteWorkout(id: string) {
  const [row] = await db.delete(healthWorkouts).where(eq(healthWorkouts.id, id)).returning();
  if (row) await applyHealthRules({ dates: [row.date] });
  return row ?? null;
}

function localTimestamp(date: string, time: string): Date {
  // Nederlandse tijd naar UTC, via de verschuiving op die dag
  const guess = new Date(`${date}T${time}:00Z`);
  const offset = new Date(guess.toLocaleString("en-US", { timeZone: "Europe/Amsterdam" })).getTime() - new Date(guess.toLocaleString("en-US", { timeZone: "UTC" })).getTime();
  return new Date(guess.getTime() - offset);
}

/* ------------------------------------------------------------------ */
/* Per dag en per week                                                 */
/* ------------------------------------------------------------------ */

export type HealthDay = {
  date: string;
  values: Partial<Record<MetricKey, number>>;
  sleep: HealthSleep | null;
  workouts: HealthWorkout[];
  /** Trainingen die meetellen als sportsessie */
  sessions: number;
  hasData: boolean;
};

/** Alle dagen van `from` tot en met `to`, ook dagen zonder gegevens. */
export async function healthDays(from: string, to: string): Promise<HealthDay[]> {
  const [samples, sleeps, workouts] = await Promise.all([
    db.select({ metric: healthSamples.metric, date: healthSamples.date, at: healthSamples.at, qty: healthSamples.qty }).from(healthSamples).where(and(gte(healthSamples.date, from), lte(healthSamples.date, to))),
    db.select().from(healthSleep).where(and(gte(healthSleep.date, from), lte(healthSleep.date, to))),
    db.select().from(healthWorkouts).where(and(gte(healthWorkouts.date, from), lte(healthWorkouts.date, to))).orderBy(asc(healthWorkouts.date), asc(healthWorkouts.startAt)),
  ]);
  const acc = new Map<string, Map<MetricKey, { sum: number; n: number; last: number; lastAt: number }>>();
  for (const s of samples) {
    const key = s.metric as MetricKey;
    if (!(key in METRICS)) continue;
    const day = acc.get(s.date) ?? new Map();
    const cur = day.get(key) ?? { sum: 0, n: 0, last: 0, lastAt: -Infinity };
    cur.sum += s.qty;
    cur.n++;
    if (s.at.getTime() >= cur.lastAt) {
      cur.last = s.qty;
      cur.lastAt = s.at.getTime();
    }
    day.set(key, cur);
    acc.set(s.date, day);
  }
  const out: HealthDay[] = [];
  for (let d = from; d <= to; d = addDaysIso(d, 1)) {
    const values: HealthDay["values"] = {};
    for (const [key, v] of acc.get(d) ?? []) {
      const agg = METRICS[key].agg;
      values[key] = agg === "sum" ? v.sum : agg === "avg" ? v.sum / v.n : v.last;
    }
    const sleep = sleeps.find((s) => s.date === d) ?? null;
    const ws = workouts.filter((w) => w.date === d);
    out.push({ date: d, values, sleep, workouts: ws, sessions: ws.filter(countsAsSession).length, hasData: Object.keys(values).length > 0 || !!sleep || ws.length > 0 });
  }
  return out;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

export type HealthWeek = {
  start: string;
  end: string;
  days: HealthDay[];
  goals: HealthGoals;
  sessions: number;
  workouts: number;
  workoutMin: number;
  /** Gemiddelden over de dagen mét gegevens (vandaag telt pas mee als de dag voorbij is, behalve voeding en slaap) */
  avgSteps: number | null;
  avgExercise: number | null;
  avgSleepMin: number | null;
  avgIntake: number | null;
  avgProtein: number | null;
  avgCarbs: number | null;
  avgFat: number | null;
  activeKcal: number;
  distanceKm: number;
  /** Laatste gewicht in of vóór deze week, en het verschil met de week ervoor */
  weight: number | null;
  weightChange: number | null;
  daysStepGoal: number;
  daysSleepGoal: number;
};

/** Laatste gewicht op of vóór een datum. */
async function weightOn(date: string): Promise<number | null> {
  const [row] = await db
    .select({ qty: healthSamples.qty })
    .from(healthSamples)
    .where(and(eq(healthSamples.metric, "weight"), lte(healthSamples.date, date)))
    .orderBy(desc(healthSamples.at))
    .limit(1);
  return row?.qty ?? null;
}

export async function healthWeek(anyDate: string = today()): Promise<HealthWeek> {
  const t = today();
  const start = weekStart(anyDate);
  const end = addDaysIso(start, 6);
  const [days, goals, weight, prevWeight] = await Promise.all([healthDays(start, end), getHealthGoals(), weightOn(end < t ? end : t), weightOn(addDaysIso(start, -1))]);
  // Stappen en beweging van vandaag zijn nog niet af: niet meetellen in het gemiddelde
  const finished = days.filter((d) => d.date < t);
  const val = (list: HealthDay[], k: MetricKey) => list.map((d) => d.values[k]).filter((v): v is number => v != null);
  const sleepMins = days.map((d) => d.sleep?.totalMin).filter((v): v is number => v != null && v > 0);
  const all = days.flatMap((d) => d.workouts);
  return {
    start,
    end,
    days,
    goals,
    sessions: days.reduce((s, d) => s + d.sessions, 0),
    workouts: all.length,
    workoutMin: all.reduce((s, w) => s + w.durationMin, 0),
    avgSteps: avg(val(finished, "steps")),
    avgExercise: avg(val(finished, "exercise")),
    avgSleepMin: avg(sleepMins),
    avgIntake: avg(val(finished, "intake_kcal")),
    avgProtein: avg(val(finished, "protein")),
    avgCarbs: avg(val(finished, "carbs")),
    avgFat: avg(val(finished, "fat")),
    activeKcal: val(days, "active_energy").reduce((s, x) => s + x, 0),
    distanceKm: val(days, "distance").reduce((s, x) => s + x, 0),
    weight,
    weightChange: weight != null && prevWeight != null && start <= t ? weight - prevWeight : null,
    daysStepGoal: val(days, "steps").filter((v) => goals.stepsPerDay && v >= goals.stepsPerDay).length,
    daysSleepGoal: sleepMins.filter((m) => goals.sleepHours && m >= goals.sleepHours * 60).length,
  };
}

export type HealthTrendWeek = { start: string; sessions: number; avgSteps: number | null; avgSleepMin: number | null; avgIntake: number | null; weight: number | null };

/** Weektrends: de laatste `weeks` weken, oudste eerst. */
export async function healthTrend(weeks = 8, anyDate: string = today()): Promise<HealthTrendWeek[]> {
  const t = today();
  const lastStart = weekStart(anyDate);
  const first = addDaysIso(lastStart, -7 * (weeks - 1));
  const days = await healthDays(first, addDaysIso(lastStart, 6));
  const out: HealthTrendWeek[] = [];
  for (let i = 0; i < weeks; i++) {
    const s = addDaysIso(first, i * 7);
    const e = addDaysIso(s, 6);
    const wd = days.filter((d) => d.date >= s && d.date <= e);
    const done = wd.filter((d) => d.date < t);
    const vals = (k: MetricKey) => done.map((d) => d.values[k]).filter((v): v is number => v != null);
    const weights = wd.filter((d) => d.values.weight != null);
    out.push({
      start: s,
      sessions: wd.reduce((x, d) => x + d.sessions, 0),
      avgSteps: avg(vals("steps")),
      avgSleepMin: avg(wd.map((d) => d.sleep?.totalMin).filter((v): v is number => v != null && v > 0)),
      avgIntake: avg(vals("intake_kcal")),
      weight: weights.at(-1)?.values.weight ?? null,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Gewoontes automatisch afvinken                                      */
/* ------------------------------------------------------------------ */

export const healthRuleInput = z
  .object({
    metric: z.enum(["workout", "steps", "exercise", "active_energy", "sleep"]),
    min: z.number().min(0),
    kind: z.string().nullable().optional(),
    minMinutes: z.number().int().min(0).nullable().optional(),
  })
  .nullable();

/** Voldoet een dag aan de regel? */
export function ruleMet(rule: HealthRule, day: HealthDay): boolean {
  switch (rule.metric) {
    case "workout": {
      const matching = day.workouts.filter((w) =>
        rule.kind ? w.kind === rule.kind && w.durationMin >= (rule.minMinutes ?? 0) : rule.minMinutes ? w.kind !== "wandelen" && w.durationMin >= rule.minMinutes : countsAsSession(w),
      );
      return matching.length >= Math.max(1, rule.min);
    }
    case "steps":
      return (day.values.steps ?? 0) >= rule.min;
    case "exercise":
      return (day.values.exercise ?? 0) >= rule.min;
    case "active_energy":
      return (day.values.active_energy ?? 0) >= rule.min;
    case "sleep":
      return (day.sleep?.totalMin ?? 0) >= rule.min * 60;
  }
}

/**
 * Gewoontes met een gezondheidsregel bijwerken voor de gegeven dagen (standaard de laatste 28).
 * Regel gehaald → vinkje met bron "health". Niet (meer) gehaald → alleen een vinkje met bron "health" verdwijnt;
 * met de hand afgevinkt blijft altijd staan. Niet vóór de startdatum van de gewoonte, niet na vandaag.
 */
export async function applyHealthRules(opts: { dates?: string[]; habitId?: string } = {}): Promise<{ habitsChecked: number; habitsUnchecked: number }> {
  const t = today();
  const list = await db
    .select()
    .from(habits)
    .where(and(isNull(habits.archivedAt), isNotNull(habits.healthRule), opts.habitId ? eq(habits.id, opts.habitId) : undefined));
  const withRule = list.filter((h) => h.healthRule && h.healthRule.metric);
  if (!withRule.length) return { habitsChecked: 0, habitsUnchecked: 0 };
  const dates = (opts.dates ?? Array.from({ length: 28 }, (_, i) => addDaysIso(t, -i))).filter((d) => d <= t).sort();
  if (!dates.length) return { habitsChecked: 0, habitsUnchecked: 0 };
  const days = new Map((await healthDays(dates[0], dates.at(-1)!)).map((d) => [d.date, d]));
  const checks = await db
    .select()
    .from(habitChecks)
    .where(and(inArray(habitChecks.habitId, withRule.map((h) => h.id)), inArray(habitChecks.date, dates)));
  let checked = 0;
  let unchecked = 0;
  for (const h of withRule) {
    for (const d of dates) {
      if (d < h.startDate) continue;
      const day = days.get(d);
      if (!day) continue;
      const existing = checks.find((c) => c.habitId === h.id && c.date === d);
      const met = ruleMet(h.healthRule!, day);
      if (met && !existing) {
        await db.insert(habitChecks).values({ habitId: h.id, date: d, source: "health" }).onConflictDoNothing();
        checked++;
      } else if (!met && existing?.source === "health") {
        await db.delete(habitChecks).where(eq(habitChecks.id, existing.id));
        unchecked++;
      }
    }
  }
  return { habitsChecked: checked, habitsUnchecked: unchecked };
}

/* ------------------------------------------------------------------ */
/* Voor cockpit, overzicht en MCP                                      */
/* ------------------------------------------------------------------ */

export type HealthSnapshot = {
  configured: boolean;
  lastReceived: Date | null;
  /** Geen zending meer sinds meer dan 36 uur */
  stale: boolean;
  today: HealthDay;
  yesterday: HealthDay;
  week: { sessions: number; goal: number; workouts: number; avgSteps: number | null; avgSleepMin: number | null };
};

export async function healthSnapshot(t: string = today()): Promise<HealthSnapshot> {
  const [last, days, week] = await Promise.all([lastHealthImport(), healthDays(addDaysIso(t, -1), t), healthWeek(t)]);
  const lastReceived = last?.receivedAt ?? null;
  return {
    configured: !!last,
    lastReceived,
    stale: !!lastReceived && Date.now() - lastReceived.getTime() > 36 * 3600 * 1000,
    yesterday: days[0],
    today: days[1],
    week: { sessions: week.sessions, goal: week.goals.sessionsPerWeek, workouts: week.workouts, avgSteps: week.avgSteps, avgSleepMin: week.avgSleepMin },
  };
}

/** Compacte weergave voor de MCP (Claude, straks Hermes). */
export function slimHealthDay(d: HealthDay) {
  const r = (v: number | undefined, dec = 0) => (v == null ? undefined : Math.round(v * 10 ** dec) / 10 ** dec);
  return {
    date: d.date,
    steps: r(d.values.steps),
    exerciseMin: r(d.values.exercise),
    activeKcal: r(d.values.active_energy),
    distanceKm: r(d.values.distance, 1),
    restingHr: r(d.values.resting_hr),
    weightKg: r(d.values.weight, 1),
    bodyFatPct: r(d.values.body_fat, 1),
    nutrition:
      d.values.intake_kcal != null || d.values.protein != null
        ? { kcal: r(d.values.intake_kcal), proteinG: r(d.values.protein), carbsG: r(d.values.carbs), fatG: r(d.values.fat), fiberG: r(d.values.fiber), waterMl: r(d.values.water) }
        : undefined,
    sleep: d.sleep ? { totalMin: d.sleep.totalMin, deepMin: d.sleep.deepMin, remMin: d.sleep.remMin, awakeMin: d.sleep.awakeMin } : undefined,
    workouts: d.workouts.length
      ? d.workouts.map((w) => ({ id: w.id, name: w.name, kind: w.kind, durationMin: w.durationMin, activeKcal: w.activeKcal, distanceKm: w.distanceKm, avgHr: w.avgHr, source: w.source, countsAsSession: countsAsSession(w) }))
      : undefined,
    hasData: d.hasData,
  };
}
