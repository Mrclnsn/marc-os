import "server-only";
import { and, asc, desc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { learningSessions, learningTopics, sources, tasks, type LearningSession, type LearningTopic } from "@/db/schema";
import { addDaysIso, today, weekStart } from "./dates";
import { LEARNING_KINDS, LEARNING_STATUS, learningPct, learningProgressLabel } from "./learning-shared";

/*
 * Leren (gesprek 10): leeronderwerpen (cursus, boek, vaardigheid, certificering) met doel, status,
 * voortgang, bestede tijd, een leerplan (taken met learningId), bronnen (sources.learningId)
 * en notities via [[leren:Titel]].
 * Tijd wordt per onderwerp vastgelegd (learning_sessions), los van de module Uren, zodat het ook werkt
 * zolang die module uit staat. Doelen kunnen "uren leren" meten (alle onderwerpen of één).
 */

const optText = z.string().nullable().optional();
const optDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();

export const learningInput = z.object({
  title: z.string().min(1),
  kind: z.enum(Object.keys(LEARNING_KINDS) as [keyof typeof LEARNING_KINDS]).optional(),
  area: z.enum(["zakelijk", "prive"]).optional(),
  status: z.enum(Object.keys(LEARNING_STATUS) as [keyof typeof LEARNING_STATUS]).optional(),
  goal: optText,
  url: optText,
  progressDone: z.number().min(0).optional(),
  progressTotal: z.number().min(0).nullable().optional(),
  progressUnit: optText,
  hoursTarget: z.number().min(0).nullable().optional(),
  startDate: optDate,
  targetDate: optDate,
  finishedAt: optDate,
  notes: optText,
  sortOrder: z.number().int().optional(),
});
export type LearningInput = z.infer<typeof learningInput>;

/** Status afgerond vult de einddatum; terug naar bezig maakt hem weer leeg. Bezig zonder start: start vandaag. */
function statusDates<T extends Partial<LearningInput>>(data: T, cur?: LearningTopic): T {
  const status = data.status ?? cur?.status;
  if (data.status === "afgerond" && data.finishedAt === undefined && !cur?.finishedAt) data.finishedAt = today();
  if (data.status && data.status !== "afgerond" && data.finishedAt === undefined && cur?.finishedAt) data.finishedAt = null;
  if (status === "bezig" && !data.startDate && !cur?.startDate) data.startDate = today();
  if (data.progressUnit !== undefined) data.progressUnit = data.progressUnit?.trim() || null;
  return data;
}

export async function createLearning(input: LearningInput) {
  const data = statusDates({ status: "bezig" as const, ...learningInput.parse(input) });
  const [row] = await db.insert(learningTopics).values(data).returning();
  await afterChange(row.id, row.notes);
  return row;
}

export async function updateLearning(id: string, patch: Partial<LearningInput>) {
  const [cur] = await db.select().from(learningTopics).where(eq(learningTopics.id, id));
  if (!cur) throw new Error("Leeronderwerp niet gevonden");
  const data = statusDates(learningInput.partial().parse(patch), cur);
  const [row] = await db.update(learningTopics).set(data).where(eq(learningTopics.id, id)).returning();
  if (data.notes !== undefined) await afterChange(id, row.notes);
  return row;
}

export async function deleteLearning(id: string) {
  const { deleteLinksFrom } = await import("./brain");
  await deleteLinksFrom("learning", id);
  await db.delete(learningTopics).where(eq(learningTopics.id, id));
}

/** Aantekeningen mogen [[links]] bevatten: bijhouden zoals bij notities en bronnen. */
async function afterChange(id: string, notes: string | null) {
  const { syncLinks } = await import("./brain");
  await syncLinks("learning", id, notes);
}

/** Tijd vastleggen: minuten op een dag. */
export async function logLearning(input: { topicId: string; minutes: number; date?: string; note?: string | null; source?: string }) {
  if (!Number.isFinite(input.minutes) || input.minutes <= 0) throw new Error("Hoe lang? Bijv. 45, 1:30 of 1u.");
  if (input.minutes > 24 * 60) throw new Error("Meer dan 24 uur op één dag kan niet.");
  const date = input.date ?? today();
  if (date > today()) throw new Error("Tijd vastleggen kan niet vooruit.");
  const [topic] = await db.select().from(learningTopics).where(eq(learningTopics.id, input.topicId));
  if (!topic) throw new Error("Leeronderwerp niet gevonden");
  const [row] = await db
    .insert(learningSessions)
    .values({ topicId: input.topicId, minutes: Math.round(input.minutes), date, note: input.note ?? null, source: input.source ?? "app" })
    .returning();
  // Eerste keer tijd bij een idee: dan ben je ermee bezig
  if (topic.status === "idee") await updateLearning(topic.id, { status: "bezig" });
  return row;
}

export async function deleteLearningSession(id: string) {
  const [row] = await db.delete(learningSessions).where(eq(learningSessions.id, id)).returning();
  return row ?? null;
}

/** Minuten leren tussen twee datums (alle onderwerpen of één). */
export async function learningMinutes(from: string, to: string, topicId?: string | null): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`coalesce(sum(${learningSessions.minutes}), 0)::int` })
    .from(learningSessions)
    .where(and(gte(learningSessions.date, from), lte(learningSessions.date, to), topicId ? eq(learningSessions.topicId, topicId) : undefined));
  return r?.n ?? 0;
}

/* ------------------------------------------------------------------ */
/* Overzicht                                                           */
/* ------------------------------------------------------------------ */

export type LearningRow = LearningTopic & {
  kindLabel: string;
  statusLabel: string;
  pct: number;
  progressLabel: string;
  minutesTotal: number;
  minutesWeek: number;
  minutesMonth: number;
  lastDate: string | null;
  openSteps: number;
  doneSteps: number;
  sourcesCount: number;
};

const STATUS_ORDER: Record<string, number> = { bezig: 0, idee: 1, gepauzeerd: 2, afgerond: 3 };

export async function listLearning(filter: { status?: string[] } = {}): Promise<LearningRow[]> {
  const t = today();
  const wk = weekStart(t);
  const month = `${t.slice(0, 7)}-01`;
  const topics = await db
    .select()
    .from(learningTopics)
    .where(filter.status?.length ? inArray(learningTopics.status, filter.status) : undefined)
    .orderBy(asc(learningTopics.sortOrder), desc(learningTopics.updatedAt));
  if (!topics.length) return [];
  const ids = topics.map((x) => x.id);
  const [mins, steps, srcs] = await Promise.all([
    db
      .select({
        id: learningSessions.topicId,
        total: sql<number>`sum(${learningSessions.minutes})::int`,
        week: sql<number>`coalesce(sum(${learningSessions.minutes}) filter (where ${learningSessions.date} >= ${wk}), 0)::int`,
        month: sql<number>`coalesce(sum(${learningSessions.minutes}) filter (where ${learningSessions.date} >= ${month}), 0)::int`,
        last: sql<string | null>`max(${learningSessions.date})`,
      })
      .from(learningSessions)
      .where(inArray(learningSessions.topicId, ids))
      .groupBy(learningSessions.topicId),
    db
      .select({ id: tasks.learningId, open: sql<number>`count(*) filter (where ${tasks.status} <> 'done')::int`, done: sql<number>`count(*) filter (where ${tasks.status} = 'done')::int` })
      .from(tasks)
      .where(inArray(tasks.learningId, ids))
      .groupBy(tasks.learningId),
    db.select({ id: sources.learningId, n: sql<number>`count(*)::int` }).from(sources).where(inArray(sources.learningId, ids)).groupBy(sources.learningId),
  ]);
  const rows = topics.map((x) => {
    const m = mins.find((r) => r.id === x.id);
    const s = steps.find((r) => r.id === x.id);
    return {
      ...x,
      kindLabel: LEARNING_KINDS[x.kind as keyof typeof LEARNING_KINDS] ?? x.kind,
      statusLabel: LEARNING_STATUS[x.status as keyof typeof LEARNING_STATUS] ?? x.status,
      pct: learningPct(x),
      progressLabel: learningProgressLabel(x),
      minutesTotal: m?.total ?? 0,
      minutesWeek: m?.week ?? 0,
      minutesMonth: m?.month ?? 0,
      lastDate: m?.last ?? null,
      openSteps: s?.open ?? 0,
      doneSteps: s?.done ?? 0,
      sourcesCount: srcs.find((r) => r.id === x.id)?.n ?? 0,
    };
  });
  return rows.sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || a.sortOrder - b.sortOrder);
}

export async function getLearning(id: string) {
  const row = (await listLearning()).find((x) => x.id === id);
  if (!row) return null;
  const [sessions, steps, srcs] = await Promise.all([
    db.select().from(learningSessions).where(eq(learningSessions.topicId, id)).orderBy(desc(learningSessions.date), desc(learningSessions.createdAt)).limit(100),
    db.select().from(tasks).where(eq(tasks.learningId, id)).orderBy(asc(tasks.status), asc(tasks.planDate), asc(tasks.createdAt)),
    db.select().from(sources).where(eq(sources.learningId, id)).orderBy(desc(sources.createdAt)),
  ]);
  return { ...row, sessions: sessions as LearningSession[], steps, sources: srcs };
}

/** Op id of (deel van de) titel, voor de MCP en straks WhatsApp ("1 uur aan de cursus"). */
export async function findLearning(ref: string): Promise<LearningTopic | null> {
  if (/^[0-9a-f-]{36}$/i.test(ref)) {
    const [r] = await db.select().from(learningTopics).where(eq(learningTopics.id, ref));
    return r ?? null;
  }
  const list = await db.select().from(learningTopics).orderBy(asc(learningTopics.status));
  const q = ref.trim().toLowerCase();
  const open = list.filter((x) => x.status !== "afgerond");
  const pick = (xs: LearningTopic[]) => xs.find((x) => x.title.toLowerCase() === q) ?? xs.find((x) => x.title.toLowerCase().includes(q)) ?? xs.find((x) => q.includes(x.title.toLowerCase()));
  return pick(open) ?? pick(list) ?? null;
}

/** Samenvatting voor overzicht, briefing en weekreview. */
export async function learningSummary() {
  const t = today();
  const wk = weekStart(t);
  const [week, lastWeek, active] = await Promise.all([
    learningMinutes(wk, t),
    learningMinutes(addDaysIso(wk, -7), addDaysIso(wk, -1)),
    listLearning({ status: ["bezig"] }),
  ]);
  return { minutesThisWeek: week, minutesLastWeek: lastWeek, active };
}

/** Taken in het leerplan die nog open staan (voor de planning in een leren-blok). */
export async function openLearningSteps() {
  return db
    .select({ id: tasks.id, title: tasks.title, learningId: tasks.learningId, planDate: tasks.planDate })
    .from(tasks)
    .where(and(ne(tasks.status, "done"), sql`${tasks.learningId} is not null`));
}
