"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import * as data from "@/lib/data";
import { addCalendarFeed, deleteCalendarFeed, testCalendarFeed, updateCalendarFeed, type FeedTest } from "@/lib/calendar";
import { BLOCK_KIND_KEYS, parseTime, type BlockKind } from "@/lib/rhythm-shared";
import { today } from "@/lib/dates";

/* Server actions voor Leven 1 (gesprek 8): planning, dagritme, gewoontes en agenda-links. */

function s(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  if (v == null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}
const days = (fd: FormData, key = "weekdays") => fd.getAll(key).map(Number).filter((n) => n >= 1 && n <= 7);
function time(fd: FormData, key: string, label: string): string | null {
  const raw = s(fd, key);
  if (!raw) return null;
  const t = parseTime(raw);
  if (!t) throw new Error(`${label}: "${raw}" is geen tijd. Gebruik bijv. 09:00.`);
  return t;
}

function refresh() {
  revalidatePath("/", "layout");
}

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

async function attempt(fn: () => Promise<string | void>): Promise<ActionResult> {
  try {
    const message = await fn();
    refresh();
    return { ok: true, message: message ?? undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/* ---------------- Inplannen ---------------- */

/** Taak op een dag en in een blok zetten (slepen of "plan in"). date null = terug naar zonder plek. */
export async function planTaskSlotAction(taskId: string, date: string | null, blockId: string | null) {
  await requireSession();
  await data.planTask(taskId, { date, blockId });
  refresh();
}

export async function planTaskTimeAction(taskId: string, time: string | null) {
  await requireSession();
  await data.planTask(taskId, { date: (await data.getTask(taskId))?.planDate ?? today(), time: time ? parseTime(time) : null });
  refresh();
}

export async function setDayRhythmAction(date: string, fd: FormData) {
  await requireSession();
  const v = s(fd, "rhythm") ?? "default";
  await data.setDayRhythm(date, v === "free" ? null : v === "default" ? "default" : v);
  refresh();
}

/* ---------------- Dagritme ---------------- */

export async function createRhythmAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireSession();
  return attempt(async () => {
    await data.createRhythm({ name: s(fd, "name") ?? "Nieuw ritme", weekdays: days(fd), workStart: time(fd, "workStart", "Begin werkdag"), workEnd: time(fd, "workEnd", "Einde werkdag") });
    return "Dagritme toegevoegd";
  });
}

export async function updateRhythmAction(id: string, _: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireSession();
  return attempt(async () => {
    await data.updateRhythm(id, { name: s(fd, "name") ?? "Ritme", weekdays: days(fd), workStart: time(fd, "workStart", "Begin werkdag"), workEnd: time(fd, "workEnd", "Einde werkdag") });
    return "Opgeslagen";
  });
}

export async function deleteRhythmAction(id: string) {
  await requireSession();
  await data.deleteRhythm(id);
  refresh();
}

function blockFromForm(fd: FormData) {
  const kind = s(fd, "kind");
  const area = s(fd, "area");
  return {
    title: s(fd, "title") ?? "Blok",
    kind: (kind && (BLOCK_KIND_KEYS as string[]).includes(kind) ? kind : "overig") as BlockKind,
    area: (area === "zakelijk" || area === "prive" ? area : null) as "zakelijk" | "prive" | null,
    startTime: time(fd, "startTime", "Begin") ?? "",
    endTime: time(fd, "endTime", "Einde") ?? "",
    remind: fd.has("remind"),
    remindBefore: Math.max(0, Math.min(240, Number(s(fd, "remindBefore") ?? 0) || 0)),
  };
}

export async function createBlockAction(rhythmId: string, _: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireSession();
  return attempt(async () => {
    const b = blockFromForm(fd);
    if (!b.startTime || !b.endTime) throw new Error("Vul begin en einde in.");
    await data.createBlock({ rhythmId, ...b });
    return "Blok toegevoegd";
  });
}

export async function updateBlockAction(id: string, _: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireSession();
  return attempt(async () => {
    const b = blockFromForm(fd);
    if (!b.startTime || !b.endTime) throw new Error("Vul begin en einde in.");
    await data.updateBlock(id, b);
    return "Opgeslagen";
  });
}

export async function deleteBlockAction(id: string) {
  await requireSession();
  await data.deleteBlock(id);
  refresh();
}

export async function copyBlockAction(id: string, fd: FormData) {
  await requireSession();
  const to = s(fd, "rhythmId");
  if (to) await data.copyBlock(id, to);
  refresh();
}

export async function setBlockRemindAction(id: string, remind: boolean) {
  await requireSession();
  await data.updateBlock(id, { remind });
  refresh();
}

export async function deleteOverrideAction(date: string) {
  await requireSession();
  await data.setDayRhythm(date, "default");
  refresh();
}

/* ---------------- Gewoontes ---------------- */

function habitFromForm(fd: FormData): data.HabitInput {
  const frequency = (s(fd, "frequency") ?? "daily") as "daily" | "weekly" | "days";
  const area = s(fd, "area");
  return {
    title: s(fd, "title") ?? "",
    area: area === "zakelijk" ? "zakelijk" : "prive",
    frequency,
    timesPerWeek: frequency === "weekly" ? Number(s(fd, "timesPerWeek") ?? 1) : null,
    weekdays: frequency === "days" ? days(fd) : [],
    blockId: s(fd, "blockId"),
    notes: s(fd, "notes"),
    healthRule: healthRuleFromForm(fd),
  };
}

/** Gezondheidsregel uit het formulier (gesprek 9); leeg = alleen met de hand afvinken. */
function healthRuleFromForm(fd: FormData): data.HabitInput["healthRule"] {
  const metric = s(fd, "healthMetric");
  if (!metric) return null;
  if (!["workout", "steps", "exercise", "active_energy", "sleep"].includes(metric)) throw new Error("Onbekende meting");
  const num = (k: string) => {
    const raw = s(fd, k);
    if (raw === null) return null;
    const v = Number(raw.replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
    if (!Number.isFinite(v) || v < 0) throw new Error(`"${raw}" is geen getal.`);
    return v;
  };
  const min = num("healthMin") ?? (metric === "workout" ? 1 : 0);
  if (metric !== "workout" && min <= 0) throw new Error("Vul in hoeveel minstens nodig is.");
  return {
    metric: metric as "workout" | "steps" | "exercise" | "active_energy" | "sleep",
    min,
    kind: metric === "workout" ? s(fd, "healthKind") : null,
    minMinutes: metric === "workout" && num("healthMinMinutes") !== null ? Math.round(num("healthMinMinutes")!) : null,
  };
}

export async function createHabitAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireSession();
  return attempt(async () => {
    const h = habitFromForm(fd);
    if (!h.title) throw new Error("Geef de gewoonte een naam.");
    await data.createHabit(h);
    return "Gewoonte toegevoegd";
  });
}

export async function updateHabitAction(id: string, _: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireSession();
  return attempt(async () => {
    const h = habitFromForm(fd);
    if (!h.title) throw new Error("Geef de gewoonte een naam.");
    await data.updateHabit(id, h);
    return "Opgeslagen";
  });
}

export async function toggleHabitAction(id: string, date: string, done: boolean) {
  await requireSession();
  await data.checkHabit(id, date, done, "app");
  refresh();
}

export async function archiveHabitAction(id: string, archived: boolean) {
  await requireSession();
  await data.archiveHabit(id, archived);
  refresh();
}

export async function deleteHabitAction(id: string) {
  await requireSession();
  await data.deleteHabit(id);
  refresh();
}

/* ---------------- Agenda-links ---------------- */

export type FeedResult = ActionResult & { test?: FeedTest };

const testMessage = (t: FeedTest) => (t.ok ? `Gelukt: ${t.events} ${t.events === 1 ? "afspraak" : "afspraken"} in de komende 14 dagen.` : `Opgeslagen, maar ophalen lukt niet: ${t.error}`);

export async function addCalendarFeedAction(_: FeedResult | null, fd: FormData): Promise<FeedResult> {
  await requireSession();
  try {
    const url = s(fd, "url");
    if (!url) throw new Error("Plak de agenda-link.");
    const test = await addCalendarFeed({ name: s(fd, "name") ?? "Agenda", url });
    refresh();
    return test.ok ? { ok: true, message: testMessage(test), test } : { ok: false, error: testMessage(test), test };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function updateCalendarFeedAction(id: string, _: FeedResult | null, fd: FormData): Promise<FeedResult> {
  await requireSession();
  try {
    await updateCalendarFeed(id, { name: s(fd, "name") ?? undefined, url: s(fd, "url") ?? undefined });
    const test = await testCalendarFeed(id);
    refresh();
    return test.ok ? { ok: true, message: testMessage(test), test } : { ok: false, error: testMessage(test), test };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function testCalendarFeedAction(id: string): Promise<FeedResult> {
  await requireSession();
  try {
    const test = await testCalendarFeed(id);
    refresh();
    return test.ok ? { ok: true, message: testMessage(test).replace("Gelukt: ", "Werkt: "), test } : { ok: false, error: `Ophalen lukt niet: ${test.error}`, test };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function setCalendarFeedActiveAction(id: string, active: boolean) {
  await requireSession();
  await updateCalendarFeed(id, { active });
  refresh();
}

export async function deleteCalendarFeedAction(id: string) {
  await requireSession();
  await deleteCalendarFeed(id);
  refresh();
}
