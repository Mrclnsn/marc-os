"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { addWorkoutAction, deleteWorkoutAction, regenerateHealthTokenAction, saveHealthGoalsAction, setWorkoutKindAction, type ActionResult } from "@/app/health-actions";
import { WORKOUT_KINDS, type HealthGoals } from "@/lib/health-shared";

function Msg({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return <p className={`text-sm ${state.ok ? "text-steen" : "font-bold text-nacht"}`} role="status">{state.ok ? state.message : state.error}</p>;
}

/* ---------------- Training met de hand ---------------- */

export function WorkoutForm({ date }: { date: string }) {
  const [state, action, pending] = useActionState(addWorkoutAction, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
        <label className="block">
          <span className="label">Training</span>
          <input name="name" placeholder="Bijv. Krachttraining Virtuagym" className="input w-full" required />
        </label>
        <label className="block">
          <span className="label">Soort</span>
          <select name="kind" defaultValue="" className="input w-full">
            <option value="">Raden uit de naam</option>
            {Object.entries(WORKOUT_KINDS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <label className="block">
          <span className="label">Datum</span>
          <input type="date" name="date" defaultValue={date} max={date} className="input w-full" />
        </label>
        <label className="block">
          <span className="label">Begin</span>
          <input type="time" name="time" className="input w-full" />
        </label>
        <label className="block">
          <span className="label">Duur</span>
          <input name="duration" placeholder="45 of 1:00" inputMode="text" className="input w-full" required />
        </label>
        <label className="block">
          <span className="label">Actieve kcal</span>
          <input name="kcal" inputMode="numeric" className="input w-full" />
        </label>
        <label className="block">
          <span className="label">Afstand (km)</span>
          <input name="distance" inputMode="decimal" className="input w-full" />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" disabled={pending}>Toevoegen</button>
        <Msg state={state} />
      </div>
    </form>
  );
}

export function WorkoutActions({ id, kind, name, fromHealth }: { id: string; kind: string; name: string; fromHealth: boolean }) {
  const [pending, start] = useTransition();
  return (
    <span className={`flex items-center gap-2 ${pending ? "opacity-60" : ""}`}>
      <select
        aria-label={`Soort van ${name}`}
        value={kind}
        onChange={(e) => start(() => setWorkoutKindAction(id, e.target.value))}
        className="input h-7 py-0 text-xs"
      >
        {Object.entries(WORKOUT_KINDS).map(([k, v]) => (
          <option key={k} value={k}>{v}</option>
        ))}
      </select>
      <button
        type="button"
        className="btn-ghost text-xs"
        onClick={() => {
          const extra = fromHealth ? "\n\nDeze training komt uit Apple Health en komt terug bij de volgende zending als hij daar nog staat." : "";
          if (confirm(`"${name}" verwijderen?${extra}`)) start(() => deleteWorkoutAction(id));
        }}
      >
        Verwijderen
      </button>
    </span>
  );
}

/* ---------------- Doelen ---------------- */

export function GoalsForm({ goals }: { goals: HealthGoals }) {
  const [state, action, pending] = useActionState(saveHealthGoalsAction, null);
  const v = (x: number | null) => (x == null ? "" : String(x).replace(".", ","));
  return (
    <form action={action} className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="block">
          <span className="label">Sportsessies per week</span>
          <input name="sessionsPerWeek" inputMode="numeric" defaultValue={v(goals.sessionsPerWeek)} className="input w-full" />
        </label>
        <label className="block">
          <span className="label">Stappen per dag</span>
          <input name="stepsPerDay" inputMode="numeric" defaultValue={v(goals.stepsPerDay)} className="input w-full" />
        </label>
        <label className="block">
          <span className="label">Beweegminuten per dag</span>
          <input name="exercisePerDay" inputMode="numeric" defaultValue={v(goals.exercisePerDay)} className="input w-full" />
        </label>
        <label className="block">
          <span className="label">Uren slaap</span>
          <input name="sleepHours" inputMode="decimal" defaultValue={v(goals.sleepHours)} className="input w-full" />
        </label>
        <label className="block">
          <span className="label">Kcal per dag (optioneel)</span>
          <input name="kcalPerDay" inputMode="numeric" defaultValue={v(goals.kcalPerDay)} className="input w-full" />
        </label>
        <label className="block">
          <span className="label">Eiwit per dag, g (optioneel)</span>
          <input name="proteinPerDay" inputMode="numeric" defaultValue={v(goals.proteinPerDay)} className="input w-full" />
        </label>
        <label className="block">
          <span className="label">Streefgewicht, kg (optioneel)</span>
          <input name="weightKg" inputMode="decimal" defaultValue={v(goals.weightKg)} className="input w-full" />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" disabled={pending}>Opslaan</button>
        <Msg state={state} />
      </div>
      <p className="text-xs text-steen">Een sportsessie is elke training van minstens 10 minuten, behalve wandelen. Wandelingen tellen mee in stappen en beweegminuten.</p>
    </form>
  );
}

/* ---------------- Sleutel voor Health Auto Export ---------------- */

export function HealthTokenBox({ url, token }: { url: string; token: string }) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const copy = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setShow(true);
    }
  };
  return (
    <div className={`space-y-2 ${pending ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="label m-0 w-16">URL</span>
        <code className="chip break-all select-all">{url}</code>
        <button type="button" className="btn-ghost text-xs" onClick={() => copy("url", url)}>{copied === "url" ? "Gekopieerd" : "Kopieer"}</button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="label m-0 w-16">Header</span>
        <code className="chip break-all select-all">Authorization: Bearer {show ? token : "••••••••••••"}</code>
        <button type="button" className="btn-ghost text-xs" onClick={() => setShow(!show)}>{show ? "Verberg" : "Toon"}</button>
        <button type="button" className="btn-ghost text-xs" onClick={() => copy("token", `Bearer ${token}`)}>{copied === "token" ? "Gekopieerd" : "Kopieer waarde"}</button>
      </div>
      <button
        type="button"
        className="btn-ghost text-xs"
        onClick={() => {
          if (confirm("Nieuwe sleutel maken? De oude werkt direct niet meer; pas hem daarna aan in Health Auto Export.")) start(() => regenerateHealthTokenAction());
        }}
      >
        Nieuwe sleutel
      </button>
    </div>
  );
}
