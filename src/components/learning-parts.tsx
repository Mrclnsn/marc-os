"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addLearningSourceAction,
  addLearningStepAction,
  createLearningAction,
  deleteLearningAction,
  deleteLearningSessionAction,
  logLearningAction,
  saveLearningNotesAction,
  setLearningProgressAction,
  setLearningStatusAction,
  updateLearningAction,
  type ActionResult,
} from "@/app/goal-actions";
import { LEARNING_KINDS, LEARNING_STATUS, type LearningStatus } from "@/lib/learning-shared";
import { LinkEditor, type Suggestion } from "./link-editor";
import { FormMessage } from "./goal-parts";

/** Reset een formulier na succes. */
function useResetOnOk(state: ActionResult | null) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return ref;
}

export type LearningValues = {
  title: string;
  kind: string;
  area: string;
  status: string;
  goal: string | null;
  url: string | null;
  progressUnit: string | null;
  progressTotal: number | null;
  hoursTarget: number | null;
  startDate: string | null;
  targetDate: string | null;
};

const numIn = (v: number | null | undefined) => (v == null ? "" : String(v).replace(".", ","));

export function LearningForm({ id, topic }: { id?: string; topic?: LearningValues }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(id ? updateLearningAction.bind(null, id) : createLearningAction, null);
  const [unit, setUnit] = useState(topic?.progressUnit ?? "");
  useEffect(() => {
    if (!id && state?.ok && state.id) router.push(`/leren/${state.id}`);
  }, [state, id, router]);
  return (
    <form action={formAction} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_150px_130px]">
        <label className="block">
          <span className="label">Onderwerp</span>
          <input name="title" defaultValue={topic?.title ?? ""} required className="input w-full" placeholder="Bijv. Wwft-training 2027, Google Ads certificering, Boek: Deep Work" />
        </label>
        <label className="block">
          <span className="label">Soort</span>
          <select name="kind" defaultValue={topic?.kind ?? "cursus"} className="input w-full">
            {Object.entries(LEARNING_KINDS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Gebied</span>
          <select name="area" defaultValue={topic?.area ?? "zakelijk"} className="input w-full">
            <option value="zakelijk">Zakelijk</option>
            <option value="prive">Privé</option>
          </select>
        </label>
      </div>
      <label className="block">
        <span className="label">Doel (waarom, wat wil je ermee kunnen)</span>
        <input name="goal" defaultValue={topic?.goal ?? ""} className="input w-full" placeholder="Bijv. AI-scans zelf kunnen uitvoeren voor klanten" />
      </label>
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="block">
          <span className="label">Status</span>
          <select name="status" defaultValue={topic?.status ?? "bezig"} className="input w-full">
            {Object.entries(LEARNING_STATUS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Voortgang in</span>
          <input name="progressUnit" value={unit} onChange={(e) => setUnit(e.target.value)} list="learning-units" className="input w-full" placeholder="procenten" />
          <datalist id="learning-units">
            {["hoofdstukken", "lessen", "modules", "pagina's", "video's"].map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </label>
        {unit.trim() && (
          <label className="block">
            <span className="label">Totaal {unit}</span>
            <input name="progressTotal" inputMode="decimal" defaultValue={numIn(topic?.progressTotal)} className="input w-full" placeholder="12" />
          </label>
        )}
        <label className="block">
          <span className="label">Uren in totaal (doel)</span>
          <input name="hoursTarget" inputMode="decimal" defaultValue={numIn(topic?.hoursTarget)} className="input w-full" placeholder="optioneel" />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="label">Link (cursus, boek)</span>
          <input name="url" type="url" defaultValue={topic?.url ?? ""} className="input w-full" placeholder="https://" />
        </label>
        <label className="block">
          <span className="label">Gestart</span>
          <input type="date" name="startDate" defaultValue={topic?.startDate ?? ""} className="input w-full" />
        </label>
        <label className="block">
          <span className="label">Af willen hebben</span>
          <input type="date" name="targetDate" defaultValue={topic?.targetDate ?? ""} className="input w-full" />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" disabled={pending}>{id ? "Opslaan" : "Toevoegen"}</button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

/** Tijd vastleggen: "45", "1:30", "1u". */
export function LogLearningForm({ topicId, today, compact = false }: { topicId: string; today: string; compact?: boolean }) {
  const [state, formAction, pending] = useActionState(logLearningAction.bind(null, topicId), null);
  const ref = useResetOnOk(state);
  return (
    <form ref={ref} action={formAction} className="flex flex-wrap items-end gap-2">
      <label className="block w-24">
        <span className="label">Tijd</span>
        <input name="duration" required className="input w-full" placeholder="45" inputMode="text" />
      </label>
      {!compact && (
        <>
          <label className="block">
            <span className="label">Datum</span>
            <input type="date" name="date" defaultValue={today} max={today} className="input" />
          </label>
          <label className="block min-w-40 flex-1">
            <span className="label">Wat gedaan</span>
            <input name="note" className="input w-full" placeholder="optioneel, bijv. hoofdstuk 3" />
          </label>
        </>
      )}
      <button className="btn-primary" disabled={pending}>Vastleggen</button>
      <FormMessage state={state} />
    </form>
  );
}

export function ProgressForm({ id, unit, total, done }: { id: string; unit: string | null; total: number | null; done: number }) {
  const [state, formAction, pending] = useActionState(setLearningProgressAction.bind(null, id), null);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <label className="block w-28">
        <span className="label">{unit ? `${unit[0].toUpperCase()}${unit.slice(1)} klaar` : "Voortgang %"}</span>
        <input key={done} name="progressDone" inputMode="decimal" defaultValue={numIn(done)} className="input w-full" />
      </label>
      {unit && total ? <span className="pb-2.5 text-sm text-steen">van {numIn(total)}</span> : null}
      <button className="btn" disabled={pending}>Bijwerken</button>
      <FormMessage state={state} />
    </form>
  );
}

export function StatusButtons({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition();
  const next: { s: LearningStatus; label: string }[] =
    status === "afgerond"
      ? [{ s: "bezig", label: "Weer oppakken" }]
      : status === "bezig"
        ? [{ s: "afgerond", label: "Afgerond" }, { s: "gepauzeerd", label: "Pauzeren" }]
        : [{ s: "bezig", label: "Beginnen" }, { s: "afgerond", label: "Afgerond" }];
  return (
    <div className={`flex flex-wrap gap-2 ${pending ? "opacity-60" : ""}`}>
      {next.map((n) => (
        <button key={n.s} type="button" className="btn" onClick={() => start(() => setLearningStatusAction(id, n.s))}>
          {n.label}
        </button>
      ))}
    </div>
  );
}

export function StepForm({ topicId, area }: { topicId: string; area: "zakelijk" | "prive" }) {
  const [state, formAction, pending] = useActionState(addLearningStepAction.bind(null, topicId, area), null);
  const ref = useResetOnOk(state);
  return (
    <form ref={ref} action={formAction} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px_100px_auto] sm:items-end">
      <label className="block">
        <span className="label">Volgende stap</span>
        <input name="title" required className="input w-full" placeholder="Bijv. module 2 afronden, oefenen met een klantcase" />
      </label>
      <label className="block">
        <span className="label">Plannen op</span>
        <input type="date" name="planDate" className="input w-full" />
      </label>
      <label className="block">
        <span className="label">Duur</span>
        <input name="estimate" className="input w-full" placeholder="1u" />
      </label>
      <button className="btn-primary" disabled={pending}>Toevoegen</button>
      <div className="sm:col-span-4"><FormMessage state={state} /></div>
    </form>
  );
}

export function SourceForm({ topicId, area }: { topicId: string; area: "zakelijk" | "prive" }) {
  const [state, formAction, pending] = useActionState(addLearningSourceAction.bind(null, topicId, area), null);
  const ref = useResetOnOk(state);
  return (
    <form ref={ref} action={formAction} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
      <label className="block">
        <span className="label">Link</span>
        <input name="url" className="input w-full" placeholder="https:// (titel wordt opgehaald)" />
      </label>
      <label className="block">
        <span className="label">Of titel</span>
        <input name="title" className="input w-full" placeholder="Bijv. boek of idee" />
      </label>
      <button className="btn-primary" disabled={pending}>Bewaren</button>
      <div className="sm:col-span-3"><FormMessage state={state} /></div>
    </form>
  );
}

export function NotesEditor({ id, notes, suggestions }: { id: string; notes: string | null; suggestions: Suggestion[] }) {
  const [state, formAction, pending] = useActionState(saveLearningNotesAction.bind(null, id), null);
  return (
    <form action={formAction} className="space-y-2">
      <LinkEditor defaultValue={notes ?? ""} suggestions={suggestions} rows={8} placeholder="Aantekeningen in markdown. [[ voor een link naar een notitie, klant, project of bron." />
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" disabled={pending}>Opslaan</button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function DeleteSession({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button type="button" className={`btn-ghost text-xs ${pending ? "opacity-50" : ""}`} onClick={() => start(() => deleteLearningSessionAction(id))} aria-label="Verwijderen">
      ×
    </button>
  );
}

export function DeleteLearning({ id, title }: { id: string; title: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={`btn-ghost text-nacht ${pending ? "opacity-50" : ""}`}
      onClick={() => {
        if (confirm(`"${title}" verwijderen, met de vastgelegde tijd? Stappen (taken) en bronnen blijven bestaan.`)) start(() => deleteLearningAction(id));
      }}
    >
      Verwijderen
    </button>
  );
}
