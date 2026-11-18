"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { addWorkout, deleteWorkout, getHealthGoals, regenerateHealthToken, setHealthGoals, updateWorkout } from "@/lib/health";
import { today } from "@/lib/dates";
import { parseDuration } from "@/lib/duration";

/* Server actions voor Gezondheid (gesprek 9). */

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

function s(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  if (v == null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}
/** "7,5" of "7.5" → 7.5; leeg → null */
function n(fd: FormData, key: string): number | null {
  const raw = s(fd, key);
  if (raw === null) return null;
  // "8.000" en "8000" zijn stappen; "7,5" en "7.5" uren of kilo's
  const t = raw.replace(/\s/g, "");
  const v = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, "") : t);
  if (!Number.isFinite(v)) throw new Error(`"${raw}" is geen getal.`);
  return v;
}

async function attempt(fn: () => Promise<string | void>): Promise<ActionResult> {
  try {
    const message = await fn();
    revalidatePath("/", "layout");
    return { ok: true, message: message ?? undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function addWorkoutAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireSession();
  return attempt(async () => {
    const name = s(fd, "name");
    if (!name) throw new Error("Geef de training een naam, bijv. Krachttraining.");
    const dur = s(fd, "duration");
    // Bij een training is een los getal minuten ("45"); verder zoals bij uren ("1:15", "1u", "90m")
    const durationMin = dur ? (/^\d+$/.test(dur) ? Number(dur) : parseDuration(dur)) : null;
    if (!durationMin) throw new Error("Hoe lang duurde de training? Bijv. 45, 1:00 of 1u.");
    await addWorkout({
      name,
      kind: s(fd, "kind") ?? undefined,
      date: s(fd, "date") ?? today(),
      time: s(fd, "time"),
      durationMin: Math.round(durationMin),
      activeKcal: n(fd, "kcal") === null ? null : Math.round(n(fd, "kcal")!),
      distanceKm: n(fd, "distance"),
      notes: s(fd, "notes"),
      source: "app",
    });
    return "Training toegevoegd";
  });
}

export async function deleteWorkoutAction(id: string) {
  await requireSession();
  await deleteWorkout(id);
  revalidatePath("/", "layout");
}

export async function setWorkoutKindAction(id: string, kind: string) {
  await requireSession();
  await updateWorkout(id, { kind });
  revalidatePath("/", "layout");
}

export async function saveHealthGoalsAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireSession();
  return attempt(async () => {
    const cur = await getHealthGoals();
    await setHealthGoals({
      sessionsPerWeek: Math.round(n(fd, "sessionsPerWeek") ?? cur.sessionsPerWeek),
      stepsPerDay: Math.round(n(fd, "stepsPerDay") ?? 0),
      exercisePerDay: Math.round(n(fd, "exercisePerDay") ?? 0),
      sleepHours: n(fd, "sleepHours") ?? 0,
      kcalPerDay: n(fd, "kcalPerDay") === null ? null : Math.round(n(fd, "kcalPerDay")!),
      proteinPerDay: n(fd, "proteinPerDay") === null ? null : Math.round(n(fd, "proteinPerDay")!),
      weightKg: n(fd, "weightKg"),
    });
    return "Doelen opgeslagen";
  });
}

export async function regenerateHealthTokenAction() {
  await requireSession();
  await regenerateHealthToken();
  revalidatePath("/instellingen");
}
