"use client";

import { useActionState, useOptimistic, useRef, useState, useTransition } from "react";
import { archiveHabitAction, createHabitAction, deleteHabitAction, toggleHabitAction, updateHabitAction, type ActionResult } from "@/app/leven-actions";
import { HABIT_MOMENT_KEYS, HABIT_MOMENTS, habitWhenLabel, WEEKDAYS, type HabitMoment, type Weekday } from "@/lib/rhythm-shared";
import { HEALTH_RULE_METRICS, WORKOUT_KINDS, type HealthRuleMetric } from "@/lib/health-shared";

/* ---------------- Afvinken (cockpit en gewoontepagina) ---------------- */

export type HabitRow = {
  id: string;
  title: string;
  done: boolean;
  due: boolean;
  streak: number;
  streakUnit: string;
  weekPct: number | null;
  frequency: string;
  block: string | null;
  /** Vast tijdstip (HH:mm) en dagdeel voor de groepering (herziening 25 november) */
  time?: string | null;
  moment?: HabitMoment | null;
};

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
        <span className={`block truncate text-[14px] ${done ? "text-steen line-through" : "text-grafiet"}`}>
          {h.time && <span className="hud-mono mr-1.5 text-[12px] tabular-nums text-steen">{h.time}</span>}
          {h.title}
        </span>
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

/**
 * Lijst om af te vinken. Met `grouped` per dagdeel (ochtend, middag, avond, op elk moment), zoals goede
 * gewoonte-apps doen: je ziet wat nu aan de beurt is zonder de hele lijst. Datum standaard vandaag.
 */
export function HabitCheckList({ habits, date, grouped = false }: { habits: HabitRow[]; date?: string; grouped?: boolean }) {
  const d = date ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam" }).format(new Date());
  const groups = grouped ? [...HABIT_MOMENT_KEYS, null].map((m) => ({ m, items: habits.filter((h) => (h.moment ?? null) === m) })).filter((g) => g.items.length) : [];
  if (!grouped || groups.length <= 1)
    return (
      <ul className="divide-y divide-lijn">
        {habits.map((h) => (
          <HabitLine key={h.id} h={h} date={d} />
        ))}
      </ul>
    );
  return (
    <div className="divide-y divide-lijn">
      {groups.map((g) => (
        <section key={g.m ?? "any"}>
          <h3 className="flex items-baseline justify-between px-4 pb-1 pt-3 text-[11px] uppercase tracking-[0.14em] text-steen">
            <span>{g.m ? HABIT_MOMENTS[g.m].label : "Op elk moment"}</span>
            <span className="tabular-nums">
              {g.items.filter((h) => h.done).length}/{g.items.length}
            </span>
          </h3>
          <ul className="divide-y divide-lijn">
            {g.items.map((h) => (
              <HabitLine key={h.id} h={h} date={d} />
            ))}
          </ul>
        </section>
      ))}
    </div>
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
type HabitValues = {
  title?: string;
  area?: string;
  frequency?: string;
  timesPerWeek?: number | null;
  weekdays?: number[];
  blockId?: string | null;
  notes?: string | null;
  healthRule?: HealthRuleValues;
  time?: string | null;
  moment?: string | null;
  remind?: boolean;
};

/** Voorbeelden om met één tik te beginnen (nieuwe gewoonte). */
const SUGGESTIONS: { title: string; mode: DayMode; days?: number[]; times?: number; when: WhenMode; time?: string; area?: string }[] = [
  { title: "Sporten", mode: "weekly", times: 3, when: "any" },
  { title: "10 minuten lezen", mode: "daily", when: "avond" },
  { title: "Dagstart: 1 tot 3 kerntaken kiezen", mode: "workdays", when: "time", time: "08:45", area: "zakelijk" },
  { title: "Dagafsluiting", mode: "workdays", when: "time", time: "17:15", area: "zakelijk" },
  { title: "Wandelen", mode: "daily", when: "middag" },
  { title: "Weekreview", mode: "days", days: [5], when: "time", time: "15:00", area: "zakelijk" },
];

type DayMode = "daily" | "workdays" | "weekend" | "days" | "weekly";
type WhenMode = "any" | "ochtend" | "middag" | "avond" | "time";

function initialDayMode(h?: HabitValues): DayMode {
  if (!h?.frequency || h.frequency === "daily") return "daily";
  if (h.frequency === "weekly") return "weekly";
  const d = [...(h.weekdays ?? [])].sort().join();
  return d === "1,2,3,4,5" ? "workdays" : d === "6,7" ? "weekend" : d === "1,2,3,4,5,6,7" ? "daily" : "days";
}

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { key: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={value === o.key}
          onClick={() => onChange(o.key)}
          className={`rounded-sm border px-3 py-1.5 text-sm transition-colors ${value === o.key ? "border-nacht bg-nacht font-bold text-op-nacht" : "border-lijn text-grafiet hover:border-nacht"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Gewoonte toevoegen of wijzigen (herzien 25 november): naam, op welke dagen (snelkeuze of dagknoppen, of x keer per week)
 * en optioneel wanneer op de dag (dagdeel of vast tijdstip met herinnering). De rest zit onder "Meer opties".
 */
export function HabitForm({ habit, id, blocks, onDone }: { habit?: HabitValues; id?: string; blocks: BlockOption[]; onDone?: () => void }) {
  const action = id ? updateHabitAction.bind(null, id) : createHabitAction;
  const [title, setTitle] = useState(habit?.title ?? "");
  const [area, setArea] = useState(habit?.area ?? "prive");
  const [dayMode, setDayMode] = useState<DayMode>(initialDayMode(habit));
  const [days, setDays] = useState<number[]>(habit?.frequency === "days" && habit.weekdays?.length ? habit.weekdays : [1, 2, 3, 4, 5]);
  const [times, setTimes] = useState(habit?.timesPerWeek ?? 3);
  const [when, setWhen] = useState<WhenMode>(habit?.time ? "time" : ((habit?.moment as WhenMode) ?? "any"));
  const [time, setTime] = useState(habit?.time ?? "07:30");
  const [remind, setRemind] = useState(habit?.remind ?? false);
  const [formKey, setFormKey] = useState(0);
  const titleRef = useRef<HTMLInputElement>(null);
  const [state, formAction, pending] = useActionState(async (prev: ActionResult | null, fd: FormData) => {
    const r = await action(prev, fd);
    if (r.ok) {
      onDone?.();
      // Na toevoegen: leeg formulier, klaar voor de volgende
      if (!id) {
        setTitle("");
        setDayMode("daily");
        setWhen("any");
        setRemind(false);
        setTime("07:30");
        setFormKey((k) => k + 1);
      }
    }
    return r;
  }, null);


  const shownDays = dayMode === "daily" ? [1, 2, 3, 4, 5, 6, 7] : dayMode === "workdays" ? [1, 2, 3, 4, 5] : dayMode === "weekend" ? [6, 7] : days;
  const toggleDay = (d: number) => {
    const next = shownDays.includes(d) ? shownDays.filter((x) => x !== d) : [...shownDays, d].sort();
    const key = next.join();
    setDays(next);
    setDayMode(key === "1,2,3,4,5,6,7" ? "daily" : key === "1,2,3,4,5" ? "workdays" : key === "6,7" ? "weekend" : "days");
  };
  const frequency = dayMode === "weekly" ? "weekly" : dayMode === "daily" ? "daily" : "days";
  const summary = habitWhenLabel({
    frequency,
    timesPerWeek: times,
    weekdays: shownDays,
    time: when === "time" ? time : null,
    moment: when === "time" || when === "any" ? null : when,
    remind,
  });

  const applySuggestion = (sg: (typeof SUGGESTIONS)[number]) => {
    setTitle(sg.title);
    setDayMode(sg.mode);
    if (sg.days) setDays(sg.days);
    if (sg.times) setTimes(sg.times);
    setWhen(sg.when);
    if (sg.time) setTime(sg.time);
    if (sg.area) setArea(sg.area);
    titleRef.current?.focus();
  };

  return (
    <form key={formKey} action={formAction} className="space-y-5">
      <div>
        <input
          ref={titleRef}
          name="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Wat wil je er een gewoonte van maken?"
          aria-label="Naam van de gewoonte"
          className="input w-full py-2.5 text-[17px] font-bold"
          required
          autoFocus={!id}
        />
        {!id && !title && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-steen">Bijvoorbeeld:</span>
            {SUGGESTIONS.map((sg) => (
              <button key={sg.title} type="button" onClick={() => applySuggestion(sg)} className="chip hover:bg-lijn">
                {sg.title}
              </button>
            ))}
          </div>
        )}
      </div>

      <fieldset className="space-y-2">
        <legend className="label">Op welke dagen</legend>
        <Seg<DayMode>
          label="Op welke dagen"
          value={dayMode}
          onChange={setDayMode}
          options={[
            { key: "daily", label: "Elke dag" },
            { key: "workdays", label: "Werkdagen" },
            { key: "weekend", label: "Weekend" },
            { key: "days", label: "Eigen dagen" },
            { key: "weekly", label: "Aantal keer per week" },
          ]}
        />
        {dayMode === "weekly" ? (
          <div className="flex items-center gap-2 pt-1">
            <button type="button" className="btn h-9 w-9 px-0" onClick={() => setTimes((n) => Math.max(1, n - 1))} aria-label="Minder">
              −
            </button>
            <span className="hud-mono w-8 text-center text-lg font-bold tabular-nums text-nacht">{times}</span>
            <button type="button" className="btn h-9 w-9 px-0" onClick={() => setTimes((n) => Math.min(7, n + 1))} aria-label="Meer">
              +
            </button>
            <span className="text-sm text-steen">keer per week, op welke dag dan ook</span>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5 pt-1" role="group" aria-label="Dagen">
            {([1, 2, 3, 4, 5, 6, 7] as Weekday[]).map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={shownDays.includes(d)}
                onClick={() => toggleDay(d)}
                className={`h-9 w-10 rounded-full border text-sm transition-colors ${shownDays.includes(d) ? "border-nacht bg-nacht font-bold text-op-nacht" : "border-lijn text-steen hover:border-nacht"}`}
              >
                {WEEKDAYS[d]}
              </button>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="label">Wanneer op de dag (optioneel)</legend>
        <Seg<WhenMode>
          label="Wanneer op de dag"
          value={when}
          onChange={setWhen}
          options={[
            { key: "any", label: "Maakt niet uit" },
            { key: "ochtend", label: "Ochtend" },
            { key: "middag", label: "Middag" },
            { key: "avond", label: "Avond" },
            { key: "time", label: "Vast tijdstip" },
          ]}
        />
        {when === "time" && (
          <div className="flex flex-wrap items-center gap-4 pt-1">
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="input w-auto py-1.5" aria-label="Tijdstip" required />
            <label className="flex items-center gap-2 text-sm text-grafiet">
              <input type="checkbox" checked={remind} onChange={(e) => setRemind(e.target.checked)} className="h-4 w-4 accent-[var(--nacht)]" />
              Herinnering sturen (pushmelding)
            </label>
          </div>
        )}
      </fieldset>

      {/* Waarden voor de server */}
      <input type="hidden" name="frequency" value={frequency} />
      {frequency === "weekly" && <input type="hidden" name="timesPerWeek" value={times} />}
      {frequency === "days" && shownDays.map((d) => <input key={d} type="hidden" name="weekdays" value={d} />)}
      <input type="hidden" name="time" value={when === "time" ? time : ""} />
      <input type="hidden" name="moment" value={when === "time" || when === "any" ? "" : when} />
      {when === "time" && remind && <input type="hidden" name="remind" value="on" />}
      <input type="hidden" name="area" value={area} />

      <details className="group" open={!!(habit?.blockId || habit?.healthRule || habit?.notes)}>
        <summary className="cursor-pointer text-sm text-steen hover:text-nacht">Meer opties: gebied, dagritmeblok, automatisch afvinken uit Apple Health</summary>
        <div className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label">Gebied</span>
              <select value={area} onChange={(e) => setArea(e.target.value)} className="input w-full">
                <option value="prive">Privé</option>
                <option value="zakelijk">Zakelijk</option>
              </select>
            </label>
            <label className="block">
              <span className="label">Bij dagritmeblok</span>
              <select name="blockId" defaultValue={habit?.blockId ?? ""} className="input w-full">
                <option value="">Geen</option>
                {blocks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <HealthRuleFields rule={habit?.healthRule ?? null} />
        </div>
      </details>

      <div className="flex flex-wrap items-center gap-3 border-t border-lijn pt-4">
        <button className="btn-primary" disabled={pending || !title.trim()}>
          {id ? "Opslaan" : "Gewoonte toevoegen"}
        </button>
        <span className="text-sm text-steen">
          {title.trim() ? <strong className="text-nacht">{title.trim()}</strong> : "Gewoonte"}: {summary}
        </span>
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

/** Knop bovenaan de pagina: opent het formulier voor een nieuwe gewoonte (snel toevoegen). */
export function NewHabit({ blocks, startOpen = false }: { blocks: BlockOption[]; startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  if (!open)
    return (
      <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
        + Nieuwe gewoonte
      </button>
    );
  return (
    <section className="card space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="h2">Nieuwe gewoonte</h2>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
          Sluiten
        </button>
      </div>
      <HabitForm blocks={blocks} />
    </section>
  );
}
