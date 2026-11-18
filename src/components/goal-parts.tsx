"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addMilestoneAction,
  archiveGoalAction,
  createGoalAction,
  createGoalFromTemplateAction,
  deleteGoalAction,
  deleteGoalEntryAction,
  deleteMilestoneAction,
  featureGoalAction,
  logGoalValueAction,
  toggleMilestoneAction,
  updateGoalAction,
  type ActionResult,
} from "@/app/goal-actions";
import { GOAL_AREAS, GOAL_CURVES, GOAL_MEASURES, GOAL_PERIODS, GOAL_SOURCES, type GoalMeasure, type GoalSource, type GoalTemplate } from "@/lib/goals-shared";
import type { Modules } from "@/lib/modules";

export function FormMessage({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return (
    <p className={`text-sm ${state.ok ? "text-steen" : "font-bold text-nacht"}`} role="status">
      {state.ok ? state.message : state.error}
    </p>
  );
}

type Opt = { id: string; label: string };

export type GoalValues = {
  title: string;
  area: string;
  periodKind: string;
  startDate: string;
  endDate: string;
  parentId: string | null;
  measure: string;
  source: string | null;
  habitId: string | null;
  learningId: string | null;
  targetValue: number | null;
  startValue: number | null;
  unit: string | null;
  targetPer: string | null;
  direction: string | null;
  curve: string;
  featured: boolean;
  notes: string | null;
};

const dateFmt = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const fmtDate = (iso: string) => dateFmt.format(new Date(`${iso}T00:00:00Z`));

const numIn = (v: number | null | undefined) => (v == null ? "" : String(v).replace(".", ","));

const MODULE_LABEL: Record<string, string> = { afspraken: "Afspraken", uren: "Uren", pipeline: "Pipeline" };

/**
 * Formulier voor een doel. De velden passen zich aan de meetwijze aan:
 * automatisch (uit de app of gezondheid), gewoonte, handmatig getal, mijlpalen of subdoelen.
 */
export function GoalForm({
  id,
  goal,
  habits,
  learning,
  parents,
  modules,
  today,
}: {
  id?: string;
  goal?: GoalValues;
  habits: Opt[];
  learning: Opt[];
  parents: Opt[];
  modules: Modules;
  today: string;
}) {
  const router = useRouter();
  const action = id ? updateGoalAction.bind(null, id) : createGoalAction;
  const [state, formAction, pending] = useActionState(action, null);
  const [measure, setMeasure] = useState<GoalMeasure>((goal?.measure as GoalMeasure) ?? "auto");
  const [period, setPeriod] = useState(goal?.periodKind ?? "year");
  const [sourceAuto, setSourceAuto] = useState<string>(goal?.measure === "auto" ? (goal.source ?? "revenue") : "revenue");
  const [sourceHealth, setSourceHealth] = useState<string>(goal?.measure === "health" ? (goal.source ?? "health_sessions") : "health_sessions");
  const source = (measure === "auto" ? sourceAuto : measure === "health" ? sourceHealth : null) as GoalSource | null;
  const def = source ? GOAL_SOURCES[source] : null;
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state?.ok) return;
    if (!id && state.id) router.push(`/doelen/${state.id}`);
  }, [state, id, router]);

  const sourceOptions = (m: "auto" | "health") =>
    (Object.entries(GOAL_SOURCES) as [GoalSource, (typeof GOAL_SOURCES)[GoalSource]][])
      .filter(([, d]) => d.measure === m)
      .map(([k, d]) => {
        const off = ("modules" in d ? (d.modules as string[]) : []).filter((x) => !modules[x as keyof Modules]);
        return (
          <option key={k} value={k}>
            {d.label}
            {off.length ? ` (module ${off.map((x) => MODULE_LABEL[x] ?? x).join(" en ")} uit)` : ""}
          </option>
        );
      });

  const isSum = def?.agg === "sum";
  const isLevel = def?.agg === "level" || measure === "manual";
  const perValue = goal && goal.source === source ? (goal.targetPer ?? "") : ((def && "defaultPer" in def ? def.defaultPer : null) ?? "");
  const showCurve = measure === "milestones" || measure === "subgoals" || isLevel || (isSum && !perValue);

  return (
    <form ref={ref} action={formAction} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px]">
        <label className="block">
          <span className="label">Doel</span>
          <input name="title" defaultValue={goal?.title ?? ""} required placeholder="Bijv. € 5.500 omzet per maand, 4x per week sporten" className="input w-full" />
        </label>
        <label className="block">
          <span className="label">Gebied</span>
          <select name="area" defaultValue={goal?.area ?? "zakelijk"} className="input w-full">
            {Object.entries(GOAL_AREAS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="label">Periode</span>
          <select name="periodKind" value={period} onChange={(e) => setPeriod(e.target.value)} className="input w-full">
            {Object.entries(GOAL_PERIODS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">{period === "custom" ? "Van" : "Welke (een dag erin)"}</span>
          <input type="date" name="startDate" defaultValue={goal?.startDate ?? today} className="input w-full" required />
        </label>
        {period === "custom" && (
          <label className="block">
            <span className="label">Tot en met</span>
            <input type="date" name="endDate" defaultValue={goal?.endDate ?? ""} className="input w-full" required />
          </label>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="label">Meetwijze</span>
          <select name="measure" value={measure} onChange={(e) => setMeasure(e.target.value as GoalMeasure)} className="input w-full">
            {Object.entries(GOAL_MEASURES).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        {measure === "auto" && (
          <label className="block sm:col-span-2">
            <span className="label">Wat</span>
            <select name="sourceAuto" value={sourceAuto} onChange={(e) => setSourceAuto(e.target.value)} className="input w-full">
              {sourceOptions("auto")}
            </select>
          </label>
        )}
        {measure === "health" && (
          <label className="block sm:col-span-2">
            <span className="label">Wat</span>
            <select name="sourceHealth" value={sourceHealth} onChange={(e) => setSourceHealth(e.target.value)} className="input w-full">
              {sourceOptions("health")}
            </select>
          </label>
        )}
        {measure === "habit" && (
          <label className="block sm:col-span-2">
            <span className="label">Gewoonte</span>
            <select name="habitId" defaultValue={goal?.habitId ?? ""} className="input w-full" required>
              <option value="">Kies een gewoonte</option>
              {habits.map((h) => (
                <option key={h.id} value={h.id}>{h.label}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      {def && <p className="-mt-2 text-xs text-steen">{def.hint}</p>}
      {measure === "habit" && <p className="-mt-2 text-xs text-steen">Gemeten: hoe vaak je de gewoonte deed tegenover hoe vaak het moest, over de hele periode. Doel in procenten (bijv. 80).</p>}
      {measure === "milestones" && <p className="-mt-2 text-xs text-steen">Mijlpalen (losse stappen of projecten) voeg je toe op de pagina van het doel, na opslaan. Met een datum per mijlpaal rekent de status met die datums.</p>}
      {measure === "subgoals" && <p className="-mt-2 text-xs text-steen">Voortgang = gemiddelde van de subdoelen. Maak daarna doelen aan met dit doel als bovenliggend doel.</p>}

      {(measure === "auto" || measure === "health" || measure === "habit" || measure === "manual") && (
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="block">
            <span className="label">Doelwaarde{measure === "habit" ? " (%)" : ""}</span>
            <input name="targetValue" inputMode="decimal" defaultValue={numIn(goal?.targetValue ?? (measure === "habit" ? 80 : null))} placeholder={def?.unit === "eur" ? "5.500" : ""} className="input w-full" required />
          </label>
          {isSum && (
            <label className="block">
              <span className="label">Per</span>
              <select key={source ?? ""} name="targetPer" defaultValue={perValue} className="input w-full">
                <option value="">Hele periode (totaal)</option>
                <option value="day">Per dag</option>
                <option value="week">Per week</option>
                <option value="month">Per maand</option>
              </select>
            </label>
          )}
          {measure === "manual" && (
            <label className="block">
              <span className="label">Eenheid</span>
              <input name="unit" defaultValue={goal?.unit ?? ""} placeholder="volgers, reviews, eur, kg" list="goal-units" className="input w-full" />
              <datalist id="goal-units">
                {["volgers", "reviews", "klanten", "eur", "kg", "uur", "pct"].map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
            </label>
          )}
          {isLevel && (
            <label className="block">
              <span className="label">Startwaarde (optioneel)</span>
              <input name="startValue" inputMode="decimal" defaultValue={numIn(goal?.startValue)} placeholder={measure === "manual" ? "eerste meting" : "huidige stand"} className="input w-full" />
            </label>
          )}
          {measure === "auto" && source === "learning_hours" && (
            <label className="block">
              <span className="label">Leeronderwerp</span>
              <select name="learningId" defaultValue={goal?.learningId ?? ""} className="input w-full">
                <option value="">Alle onderwerpen</option>
                {learning.map((l) => (
                  <option key={l.id} value={l.id}>{l.label}</option>
                ))}
              </select>
            </label>
          )}
          {(def?.agg !== "level" || measure === "manual") && (
            <label className="flex items-end gap-2 pb-2.5 text-sm">
              <input type="checkbox" name="down" defaultChecked={goal?.direction === "down"} className="h-4 w-4 accent-[var(--nacht)]" />
              Lager is beter (hooguit)
            </label>
          )}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        {showCurve && (
          <label className="block">
            <span className="label">Verloop</span>
            <select name="curve" defaultValue={goal?.curve ?? "linear"} className="input w-full">
              {Object.entries(GOAL_CURVES).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </label>
        )}
        <label className="block">
          <span className="label">Bovenliggend doel</span>
          <select name="parentId" defaultValue={goal?.parentId ?? ""} className="input w-full">
            <option value="">Geen</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </label>
        <label className="flex items-end gap-2 pb-2.5 text-sm">
          <input type="checkbox" name="featured" defaultChecked={goal?.featured} className="h-4 w-4 accent-[var(--nacht)]" />
          Hoofddoel in de cockpit
        </label>
      </div>

      <label className="block">
        <span className="label">Toelichting (optioneel)</span>
        <textarea name="notes" defaultValue={goal?.notes ?? ""} rows={2} className="input w-full" placeholder="Waarom dit doel, hoe je het wilt halen" />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" disabled={pending}>{id ? "Opslaan" : "Doel toevoegen"}</button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

/** Voorbeelddoelen uit de propositie, in één klik toe te voegen. */
export function GoalTemplates({ templates, existing }: { templates: GoalTemplate[]; existing: string[] }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const left = templates.filter((t) => !existing.includes(t.title.toLowerCase()));
  if (!left.length) return null;
  return (
    <div className={`space-y-2 ${pending ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap gap-2">
        {left.map((t) => (
          <button key={t.key} type="button" className="btn text-left" title={t.note} onClick={() => start(async () => setMsg(await createGoalFromTemplateAction(t.key)))}>
            + {t.title}
          </button>
        ))}
      </div>
      <FormMessage state={msg} />
    </div>
  );
}

export function GoalAdmin({ id, featured, archived, title }: { id: string; featured: boolean; archived: boolean; title: string }) {
  const [pending, start] = useTransition();
  return (
    <div className={`flex flex-wrap gap-2 ${pending ? "opacity-60" : ""}`}>
      {!archived && (
        <button type="button" className="btn" onClick={() => start(() => featureGoalAction(id, !featured))}>
          {featured ? "Niet meer als hoofddoel" : "Hoofddoel in de cockpit"}
        </button>
      )}
      <button type="button" className="btn-ghost" onClick={() => start(() => archiveGoalAction(id, !archived))}>
        {archived ? "Terugzetten" : "Archiveren"}
      </button>
      <button
        type="button"
        className="btn-ghost text-nacht"
        onClick={() => {
          if (confirm(`"${title}" verwijderen, met metingen en mijlpalen? Subdoelen blijven bestaan.`)) start(() => deleteGoalAction(id));
        }}
      >
        Verwijderen
      </button>
    </div>
  );
}

/** Handmatige meting toevoegen. */
export function GoalEntryForm({ goalId, today, unit }: { goalId: string; today: string; unit: string | null }) {
  const [state, formAction, pending] = useActionState(logGoalValueAction.bind(null, goalId), null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={formAction} className="flex flex-wrap items-end gap-3">
      <label className="block w-36">
        <span className="label">Stand{unit ? ` (${unit})` : ""}</span>
        <input name="value" inputMode="decimal" required className="input w-full" />
      </label>
      <label className="block">
        <span className="label">Datum</span>
        <input type="date" name="date" defaultValue={today} max={today} className="input" />
      </label>
      <label className="block min-w-40 flex-1">
        <span className="label">Notitie</span>
        <input name="note" className="input w-full" placeholder="optioneel" />
      </label>
      <button className="btn-primary" disabled={pending}>Opslaan</button>
      <FormMessage state={state} />
    </form>
  );
}

export function DeleteEntry({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button type="button" className={`btn-ghost text-xs ${pending ? "opacity-50" : ""}`} onClick={() => start(() => deleteGoalEntryAction(id))} aria-label="Meting verwijderen">
      ×
    </button>
  );
}

export function MilestoneForm({ goalId, projects }: { goalId: string; projects: Opt[] }) {
  const [state, formAction, pending] = useActionState(addMilestoneAction.bind(null, goalId), null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={formAction} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_150px_200px_auto] sm:items-end">
      <label className="block">
        <span className="label">Mijlpaal</span>
        <input name="title" required className="input w-full" placeholder="Bijv. website MLC live, eerste 5 klanten" />
      </label>
      <label className="block">
        <span className="label">Uiterlijk</span>
        <input type="date" name="dueDate" className="input w-full" />
      </label>
      <label className="block">
        <span className="label">Of een project</span>
        <select name="projectId" className="input w-full" defaultValue="">
          <option value="">Geen</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </label>
      <button className="btn-primary" disabled={pending}>Toevoegen</button>
      <div className="sm:col-span-4"><FormMessage state={state} /></div>
    </form>
  );
}

export function MilestoneRow({ m }: { m: { id: string; title: string; dueDate: string | null; isDone: boolean; projectId: string | null; projectName: string | null; doneAt: string | null } }) {
  const [pending, start] = useTransition();
  const viaProject = !!m.projectId;
  return (
    <li className={`flex items-center gap-3 px-4 py-2.5 ${pending ? "opacity-60" : ""}`}>
      <button
        type="button"
        disabled={viaProject}
        aria-pressed={m.isDone}
        aria-label={m.isDone ? `${m.title}: weer open zetten` : `${m.title}: afvinken`}
        onClick={() => start(() => toggleMilestoneAction(m.id, !m.isDone))}
        className={`grid h-[22px] w-[22px] shrink-0 place-items-center rounded-sm border-[1.5px] text-[12px] font-bold ${m.isDone ? "border-nacht bg-nacht text-op-nacht" : "border-nacht/35 hover:border-nacht"} ${viaProject ? "cursor-default" : ""}`}
        title={viaProject ? "Klaar zodra het project is afgerond" : undefined}
      >
        {m.isDone ? "✓" : ""}
      </button>
      <span className="min-w-0 flex-1">
        <span className={`block text-[14px] ${m.isDone ? "text-steen line-through" : "text-grafiet"}`}>{m.title}</span>
        <span className="block text-[11px] text-steen">
          {m.projectName ? (
            <a href={`/projecten/${m.projectId}`} className="hover:underline">project {m.projectName}</a>
          ) : null}
          {m.projectName && m.dueDate ? " · " : ""}
          {m.dueDate ? `uiterlijk ${fmtDate(m.dueDate)}` : ""}
          {m.isDone && m.doneAt ? ` · klaar ${fmtDate(m.doneAt)}` : ""}
        </span>
      </span>
      <button type="button" className="btn-ghost text-xs" onClick={() => start(() => deleteMilestoneAction(m.id))} aria-label="Mijlpaal verwijderen">
        ×
      </button>
    </li>
  );
}
