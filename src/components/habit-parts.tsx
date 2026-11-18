"use client";

import { useActionState, useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { archiveHabitAction, createHabitAction, deleteHabitAction, toggleHabitAction, updateHabitAction, type ActionResult } from "@/app/leven-actions";
import { HABIT_FREQUENCIES, WEEKDAYS, type Weekday } from "@/lib/rhythm-shared";
import { HEALTH_RULE_METRICS, WORKOUT_KINDS, type HealthRuleMetric } from "@/lib/health-shared";

/* ---------------- Afvinken (cockpit en gewoontepagina) ---------------- */

export type HabitRow = { id: string; title: string; done: boolean; due: boolean; streak: number; streakUnit: string; weekPct: number | null; frequency: string; block: string | null };

function Check({ done, onClick, label }: { done: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={done}
      onClick={onClick}
      className={`grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full text-[12px] font-bold transition-colors ${
        done ? "border-[1.5px] border-nacht bg-nacht text-op-nacht" : "border-[1.5px] border-nacht/35 hover:border-nacht"
      }`}
    >
      {done ? "✓" : ""}
    </button>
  );
}

function HabitLine({ h, date }: { h: HabitRow; date: string }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useOptimistic(h.done);
  const toggle = () =>
    start(async () => {
      setDone(!done);
      await toggleHabitAction(h.id, date, !done);
    });
  return (
    <li className={`flex items-center gap-3 px-4 py-2.5 ${pending ? "opacity-60" : ""}`}>
      <Check done={done} onClick={toggle} label={done ? `${h.title}: vinkje weghalen` : `${h.title}: afvinken`} />
      <button type="button" onClick={toggle} className="min-w-0 flex-1 text-left">
        <span className={`block truncate text-[14px] ${done ? "text-steen line-through" : "text-grafiet"}`}>{h.title}</span>
        <span className="block truncate text-[11px] text-steen">
          {h.frequency}
          {h.block ? ` · ${h.block}` : ""}
          {!h.due && !done ? " · weekdoel gehaald" : ""}
        </span>
      </button>
      <span className="hud-mono shrink-0 text-right text-[11px] tabular-nums leading-tight text-steen">
        <span className={`block ${h.streak >= 3 ? "font-bold text-nacht" : ""}`}>{h.streak} {h.streakUnit === "weken" ? "wk" : "d"} op rij</span>
        {h.weekPct !== null && <span className="block">{h.weekPct}% week</span>}
      </span>
    </li>
  );
}

/** Lijst om af te vinken. Datum standaard vandaag (in de browser bepaald door de server-pagina). */
export function HabitCheckList({ habits, date }: { habits: HabitRow[]; date?: string }) {
  const d = date ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam" }).format(new Date());
  return (
    <ul className="divide-y divide-lijn">
      {habits.map((h) => (
        <HabitLine key={h.id} h={h} date={d} />
      ))}
    </ul>
  );
}

/* ---------------- Historie: laatste 28 dagen ---------------- */

export function HabitHistory({ id, history, title }: { id: string; history: { date: string; due: boolean; done: boolean }[]; title: string }) {
  const [pending, start] = useTransition();
  const [state, setState] = useOptimistic(history, (cur, date: string) => cur.map((d) => (d.date === date ? { ...d, done: !d.done } : d)));
  const fmt = new Intl.DateTimeFormat("nl-NL", { weekday: "short", day: "numeric", month: "short" });
  return (
    <div className={`flex flex-wrap gap-1 ${pending ? "opacity-70" : ""}`} aria-label={`${title}: laatste 28 dagen`}>
      {state.map((d) => (
        <button
          key={d.date}
          type="button"
          title={`${fmt.format(new Date(`${d.date}T12:00:00`))}: ${d.done ? "gedaan" : d.due ? "niet gedaan" : "hoefde niet"} (klik om te wijzigen)`}
          onClick={() =>
            start(async () => {
              setState(d.date);
              await toggleHabitAction(id, d.date, !d.done);
            })
          }
          className={`h-4 w-4 rounded-[2px] border ${d.done ? "border-nacht bg-nacht" : d.due ? "border-steen/70 bg-transparent" : "border-lijn bg-parel"}`}
        />
      ))}
    </div>
  );
}

/* ---------------- Formulier ---------------- */

export type BlockOption = { id: string; label: string };

export function FormMessage({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return <p className={`text-sm ${state.ok ? "text-steen" : "font-bold text-nacht"}`} role="status">{state.ok ? state.message : state.error}</p>;
}

type HealthRuleValues = { metric: HealthRuleMetric; min: number; kind?: string | null; minMinutes?: number | null } | null;
type HabitValues = { title?: string; area?: string; frequency?: string; timesPerWeek?: number | null; weekdays?: number[]; blockId?: string | null; notes?: string | null; healthRule?: HealthRuleValues };

export function HabitForm({ habit, id, blocks, onDone }: { habit?: HabitValues; id?: string; blocks: BlockOption[]; onDone?: () => void }) {
  const action = id ? updateHabitAction.bind(null, id) : createHabitAction;
  const [state, formAction, pending] = useActionState(async (prev: ActionResult | null, fd: FormData) => {
    const r = await action(prev, fd);
    if (r.ok) onDone?.();
    return r;
  }, null);
  const [freq, setFreq] = useState(habit?.frequency ?? "daily");
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!id && state?.ok) ref.current?.reset();
  }, [state, id]);
  return (
    <form ref={ref} action={formAction} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px]">
        <label className="block">
          <span className="label">Gewoonte</span>
          <input name="title" defaultValue={habit?.title ?? ""} placeholder="Bijv. sporten, 10 minuten lezen, dagafsluiting" className="input w-full" required />
        </label>
        <label className="block">
          <span className="label">Gebied</span>
          <select name="area" defaultValue={habit?.area ?? "prive"} className="input w-full">
            <option value="prive">Privé</option>
            <option value="zakelijk">Zakelijk</option>
          </select>
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="label">Hoe vaak</span>
          <select name="frequency" value={freq} onChange={(e) => setFreq(e.target.value)} className="input w-full">
            {Object.entries(HABIT_FREQUENCIES).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        {freq === "weekly" && (
          <label className="block">
            <span className="label">Keer per week</span>
            <input type="number" name="timesPerWeek" min={1} max={7} defaultValue={habit?.timesPerWeek ?? 3} className="input w-full" />
          </label>
        )}
        {freq === "days" && (
          <fieldset className="sm:col-span-2">
            <legend className="label">Op welke dagen</legend>
            <WeekdayPicker value={habit?.weekdays ?? [1, 2, 3, 4, 5]} />
          </fieldset>
        )}
        <label className="block">
          <span className="label">Bij dagritmeblok (optioneel)</span>
          <select name="blockId" defaultValue={habit?.blockId ?? ""} className="input w-full">
            <option value="">Geen</option>
            {blocks.map((b) => (
              <option key={b.id} value={b.id}>{b.label}</option>
            ))}
          </select>
        </label>
      </div>
      <HealthRuleFields rule={habit?.healthRule ?? null} />
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" disabled={pending}>{id ? "Opslaan" : "Toevoegen"}</button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

/** Automatisch afvinken uit Apple Health (gesprek 9). */
function HealthRuleFields({ rule }: { rule: HealthRuleValues }) {
  const [metric, setMetric] = useState<string>(rule?.metric ?? "");
  const defaults: Record<string, number> = { workout: 1, steps: 8000, exercise: 30, active_energy: 400, sleep: 7 };
  return (
    <fieldset className="grid gap-3 sm:grid-cols-4">
      <label className="block">
        <span className="label">Automatisch afvinken</span>
        <select name="healthMetric" value={metric} onChange={(e) => setMetric(e.target.value)} className="input w-full">
          <option value="">Nee, alleen met de hand</option>
          {Object.entries(HEALTH_RULE_METRICS).map(([k, m]) => (
            <option key={k} value={k}>Bij {m.label.toLowerCase()} (Apple Health)</option>
          ))}
        </select>
      </label>
      {metric && (
        <label className="block">
          <span className="label">{metric === "workout" ? "Aantal trainingen" : `Minstens (${HEALTH_RULE_METRICS[metric as HealthRuleMetric].unit})`}</span>
          <input
            key={metric}
            name="healthMin"
            inputMode="decimal"
            defaultValue={String(rule?.metric === metric ? rule.min : defaults[metric]).replace(".", ",")}
            className="input w-full"
          />
        </label>
      )}
      {metric === "workout" && (
        <>
          <label className="block">
            <span className="label">Soort training</span>
            <select name="healthKind" defaultValue={rule?.kind ?? ""} className="input w-full">
              <option value="">Elke sportsessie</option>
              {Object.entries(WORKOUT_KINDS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">Minimaal minuten</span>
            <input name="healthMinMinutes" inputMode="numeric" defaultValue={rule?.minMinutes ?? ""} placeholder="10" className="input w-full" />
          </label>
        </>
      )}
      {metric && <p className="text-xs text-steen sm:col-span-4">Haal je het, dan vinkt Marc OS de gewoonte vanzelf af zodra de gegevens binnen zijn (ook de laatste 28 dagen). Met de hand afvinken blijft altijd kunnen.</p>}
    </fieldset>
  );
}

export function WeekdayPicker({ value, name = "weekdays" }: { value: number[]; name?: string }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {(Object.keys(WEEKDAYS) as unknown as Weekday[]).map((k) => {
        const d = Number(k) as Weekday;
        return (
          <label key={d} className="cursor-pointer">
            <input type="checkbox" name={name} value={d} defaultChecked={value.includes(d)} className="peer sr-only" />
            <span className="inline-grid h-8 w-9 place-items-center rounded-[3px] border border-lijn text-sm text-grafiet transition-colors peer-checked:border-nacht peer-checked:bg-nacht peer-checked:text-op-nacht peer-focus-visible:outline peer-focus-visible:outline-2">
              {WEEKDAYS[d]}
            </span>
          </label>
        );
      })}
    </div>
  );
}

export function HabitAdmin({ id, archived, title }: { id: string; archived: boolean; title: string }) {
  const [pending, start] = useTransition();
  return (
    <div className={`flex flex-wrap gap-2 ${pending ? "opacity-60" : ""}`}>
      <button type="button" className="btn-ghost text-xs" onClick={() => start(() => archiveHabitAction(id, !archived))}>
        {archived ? "Weer actief maken" : "Stoppen (historie blijft)"}
      </button>
      <button
        type="button"
        className="btn-ghost text-xs text-nacht"
        onClick={() => {
          if (confirm(`"${title}" en alle vinkjes verwijderen?`)) start(() => deleteHabitAction(id));
        }}
      >
        Verwijderen
      </button>
    </div>
  );
}
