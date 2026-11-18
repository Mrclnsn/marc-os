"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import {
  addMilestone,
  archiveGoal,
  createGoal,
  createLearning,
  createSource,
  createTask,
  deleteGoal,
  deleteGoalEntry,
  deleteLearning,
  deleteLearningSession,
  deleteMilestone,
  logGoalValue,
  logLearning,
  setFeatured,
  updateGoal,
  updateLearning,
  updateMilestone,
  type GoalInput,
  type LearningInput,
} from "@/lib/data";
import { today } from "@/lib/dates";
import { parseDuration } from "@/lib/duration";
import { GOAL_TEMPLATES } from "@/lib/goals-shared";

/* Server actions voor Doelen en Leren (gesprek 10). */

export type ActionResult = { ok: true; message?: string; id?: string } | { ok: false; error: string };

function s(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  if (v == null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}

/** "5.500", "€ 5.500,50", "7,5", "82" → getal; leeg → null. */
function n(fd: FormData, key: string): number | null {
  const raw = s(fd, key);
  if (raw === null) return null;
  const t = raw.replace(/[€\s%]/g, "").replace(/u(ur)?$|kg$/i, "");
  const v = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : /^-?\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, "") : t);
  if (!Number.isFinite(v)) throw new Error(`"${raw}" is geen getal.`);
  return v;
}

async function attempt(fn: () => Promise<string | void | { message?: string; id?: string }>): Promise<ActionResult> {
  try {
    const r = await fn();
    revalidatePath("/", "layout");
    return typeof r === "object" && r ? { ok: true, ...r } : { ok: true, message: r ?? undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/* ---------------- Doelen ---------------- */

function goalFromForm(fd: FormData): GoalInput {
  const measure = (s(fd, "measure") ?? "manual") as GoalInput["measure"];
  const periodKind = (s(fd, "periodKind") ?? "year") as GoalInput["periodKind"];
  const per = s(fd, "targetPer");
  return {
    title: s(fd, "title") ?? "",
    area: (s(fd, "area") ?? "zakelijk") as GoalInput["area"],
    periodKind,
    startDate: s(fd, "startDate") ?? today(),
    endDate: periodKind === "custom" ? (s(fd, "endDate") ?? undefined) : undefined,
    parentId: s(fd, "parentId"),
    measure,
    source: measure === "auto" ? s(fd, "sourceAuto") : measure === "health" ? s(fd, "sourceHealth") : null,
    habitId: measure === "habit" ? s(fd, "habitId") : null,
    learningId: s(fd, "learningId"),
    targetValue: n(fd, "targetValue"),
    startValue: n(fd, "startValue"),
    unit: measure === "manual" ? s(fd, "unit") : undefined,
    targetPer: per === "day" || per === "week" || per === "month" ? per : null,
    direction: fd.get("down") ? "down" : null,
    curve: (s(fd, "curve") ?? "linear") as GoalInput["curve"],
    featured: !!fd.get("featured"),
    notes: s(fd, "notes"),
  };
}

export async function createGoalAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireSession();
  return attempt(async () => {
    const data = goalFromForm(fd);
    if (!data.title) throw new Error("Geef het doel een naam.");
    const row = await createGoal(data);
    return { message: "Doel toegevoegd", id: row.id };
  });
}

export async function updateGoalAction(id: string, _: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireSession();
  return attempt(async () => {
    const data = goalFromForm(fd);
    if (!data.title) throw new Error("Geef het doel een naam.");
    await updateGoal(id, data);
    return "Opgeslagen";
  });
}

/** Voorbeelddoel uit de propositie in één klik (dit jaar of dit kwartaal). */
export async function createGoalFromTemplateAction(key: string): Promise<ActionResult> {
  await requireSession();
  return attempt(async () => {
    const t = GOAL_TEMPLATES.find((x) => x.key === key);
    if (!t) throw new Error("Voorbeeld niet gevonden");
    const row = await createGoal({ title: t.title, area: t.area, periodKind: t.periodKind, startDate: today(), measure: t.measure, source: t.source ?? null, targetValue: t.targetValue, targetPer: t.targetPer ?? null, notes: t.note });
    return { message: `"${t.title}" toegevoegd`, id: row.id };
  });
}

export async function featureGoalAction(id: string, on: boolean) {
  await requireSession();
  await setFeatured(on ? id : null);
  revalidatePath("/", "layout");
}

export async function archiveGoalAction(id: string, archived: boolean) {
  await requireSession();
  await archiveGoal(id, archived);
  revalidatePath("/", "layout");
}

export async function deleteGoalAction(id: string) {
  await requireSession();
  await deleteGoal(id);
  revalidatePath("/", "layout");
  redirect("/doelen");
}

export async function logGoalValueAction(goalId: string, _: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireSession();
  return attempt(async () => {
    const v = n(fd, "value");
    if (v === null) throw new Error("Vul een getal in.");
    await logGoalValue(goalId, v, s(fd, "date") ?? today(), s(fd, "note"));
    return "Meting opgeslagen";
  });
}

export async function deleteGoalEntryAction(id: string) {
  await requireSession();
  await deleteGoalEntry(id);
  revalidatePath("/", "layout");
}

export async function addMilestoneAction(goalId: string, _: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireSession();
  return attempt(async () => {
    const title = s(fd, "title");
    if (!title) throw new Error("Geef de mijlpaal een naam.");
    await addMilestone(goalId, { title, dueDate: s(fd, "dueDate"), projectId: s(fd, "projectId") });
    return "Mijlpaal toegevoegd";
  });
}

export async function toggleMilestoneAction(id: string, done: boolean) {
  await requireSession();
  await updateMilestone(id, { done });
  revalidatePath("/", "layout");
}

export async function deleteMilestoneAction(id: string) {
  await requireSession();
  await deleteMilestone(id);
  revalidatePath("/", "layout");
}

/* ---------------- Leren ---------------- */

function learningFromForm(fd: FormData): LearningInput {
  const unit = s(fd, "progressUnit");
  return {
    title: s(fd, "title") ?? "",
    kind: (s(fd, "kind") ?? "cursus") as LearningInput["kind"],
    area: (s(fd, "area") ?? "zakelijk") as LearningInput["area"],
    status: (s(fd, "status") ?? "bezig") as LearningInput["status"],
    goal: s(fd, "goal"),
    url: s(fd, "url"),
    progressUnit: unit,
    progressTotal: unit ? n(fd, "progressTotal") : null,
    hoursTarget: n(fd, "hoursTarget"),
    startDate: s(fd, "startDate"),
    targetDate: s(fd, "targetDate"),
  };
}

export async function createLearningAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireSession();
  return attempt(async () => {
    const data = learningFromForm(fd);
    if (!data.title) throw new Error("Geef het leeronderwerp een naam.");
    const row = await createLearning(data);
    return { message: "Leeronderwerp toegevoegd", id: row.id };
  });
}

export async function updateLearningAction(id: string, _: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireSession();
  return attempt(async () => {
    const data = learningFromForm(fd);
    if (!data.title) throw new Error("Geef het leeronderwerp een naam.");
    await updateLearning(id, data);
    return "Opgeslagen";
  });
}

export async function setLearningStatusAction(id: string, status: NonNullable<LearningInput["status"]>) {
  await requireSession();
  await updateLearning(id, { status });
  revalidatePath("/", "layout");
}

/** Voortgang bijwerken: aantal (bij een eenheid) of percentage. */
export async function setLearningProgressAction(id: string, _: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireSession();
  return attempt(async () => {
    const v = n(fd, "progressDone");
    if (v === null || v < 0) throw new Error("Vul de voortgang in.");
    await updateLearning(id, { progressDone: v });
    return "Voortgang bijgewerkt";
  });
}

export async function saveLearningNotesAction(id: string, _: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireSession();
  return attempt(async () => {
    await updateLearning(id, { notes: s(fd, "body") });
    return "Aantekeningen opgeslagen";
  });
}

export async function logLearningAction(topicId: string, _: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireSession();
  return attempt(async () => {
    const dur = s(fd, "duration");
    // Los getal = minuten ("45"); verder zoals bij uren ("1:30", "1,5u", "90m")
    const minutes = dur ? (/^\d+$/.test(dur) ? Number(dur) : parseDuration(dur)) : null;
    if (!minutes) throw new Error("Hoe lang? Bijv. 45, 1:30 of 1u.");
    await logLearning({ topicId, minutes, date: s(fd, "date") ?? today(), note: s(fd, "note") });
    return "Tijd vastgelegd";
  });
}

export async function deleteLearningSessionAction(id: string) {
  await requireSession();
  await deleteLearningSession(id);
  revalidatePath("/", "layout");
}

export async function deleteLearningAction(id: string) {
  await requireSession();
  await deleteLearning(id);
  revalidatePath("/", "layout");
  redirect("/leren");
}

/** Stap in het leerplan: een taak bij dit onderwerp. */
export async function addLearningStepAction(topicId: string, area: "zakelijk" | "prive", _: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireSession();
  return attempt(async () => {
    const title = s(fd, "title");
    if (!title) throw new Error("Wat is de stap?");
    const est = s(fd, "estimate");
    await createTask({ title, area, learningId: topicId, planDate: s(fd, "planDate"), estimateMin: est ? (/^\d+$/.test(est) ? Number(est) : parseDuration(est)) : null });
    return "Stap toegevoegd";
  });
}

/** Bron bij een leeronderwerp: link (titel wordt opgehaald) of alleen een titel. */
export async function addLearningSourceAction(topicId: string, area: "zakelijk" | "prive", _: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireSession();
  return attempt(async () => {
    const url = s(fd, "url");
    const title = s(fd, "title");
    if (!url && !title) throw new Error("Plak een link of geef een titel.");
    await createSource({ url, title, area, learningId: topicId, capturedVia: "app" });
    return "Bron toegevoegd";
  });
}
