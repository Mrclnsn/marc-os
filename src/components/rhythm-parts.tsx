"use client";

import { useActionState, useEffect, useRef, useTransition } from "react";
import { copyBlockAction, createBlockAction, createRhythmAction, deleteBlockAction, deleteRhythmAction, updateBlockAction, updateRhythmAction, type ActionResult } from "@/app/leven-actions";
import { BLOCK_KINDS } from "@/lib/rhythm-shared";
import { FormMessage, WeekdayPicker } from "./habit-parts";

type RhythmValues = { id: string; name: string; weekdays: number[]; workStart: string | null; workEnd: string | null };
type BlockValues = { id: string; title: string; kind: string; area: string | null; startTime: string; endTime: string; remind: boolean; remindBefore: number };

export function RhythmForm({ rhythm }: { rhythm?: RhythmValues }) {
  const action = rhythm ? updateRhythmAction.bind(null, rhythm.id) : createRhythmAction;
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!rhythm && state?.ok) ref.current?.reset();
  }, [state, rhythm]);
  return (
    <form ref={ref} action={formAction} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_110px_110px]">
        <label className="block">
          <span className="label">Naam</span>
          <input name="name" defaultValue={rhythm?.name ?? ""} placeholder="Bijv. Werkdag, Thuiswerkdag, Vakantie" className="input w-full" required />
        </label>
        <label className="block">
          <span className="label">Werkdag van</span>
          <input name="workStart" type="time" defaultValue={rhythm?.workStart ?? ""} className="input w-full" />
        </label>
        <label className="block">
          <span className="label">tot</span>
          <input name="workEnd" type="time" defaultValue={rhythm?.workEnd ?? ""} className="input w-full" />
        </label>
      </div>
      <fieldset>
        <legend className="label">Standaard op</legend>
        <WeekdayPicker value={rhythm?.weekdays ?? []} />
        <p className="mt-1 text-[11px] text-steen">Een dag hoort bij één ritme: kies je hier een dag, dan gaat hij weg bij een ander ritme. Werkdag leeg = geen werkdag (bijv. weekend).</p>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" disabled={pending}>{rhythm ? "Ritme opslaan" : "Ritme toevoegen"}</button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

function BlockFields({ block }: { block?: BlockValues }) {
  return (
    <>
      <input name="title" defaultValue={block?.title ?? ""} placeholder="Naam van het blok" className="input min-w-[140px] flex-[2_1_160px]" required aria-label="Naam" />
      <select name="kind" defaultValue={block?.kind ?? "diep_werk"} className="input flex-[1_1_120px]" aria-label="Soort">
        {Object.entries(BLOCK_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <input name="startTime" type="time" defaultValue={block?.startTime ?? ""} className="input w-[118px]" required aria-label="Begin" />
      <input name="endTime" type="time" defaultValue={block?.endTime ?? ""} className="input w-[118px]" required aria-label="Einde" />
      <select name="area" defaultValue={block?.area ?? ""} className="input w-[104px]" aria-label="Gebied">
        <option value="">Gebied</option>
        <option value="zakelijk">Zakelijk</option>
        <option value="prive">Privé</option>
      </select>
      <label className="flex items-center gap-1.5 text-sm text-grafiet">
        <input type="checkbox" name="remind" defaultChecked={block?.remind ?? false} />
        Herinnering
      </label>
      <label className="flex items-center gap-1.5 text-sm text-grafiet" title="Minuten vóór het begin">
        <input name="remindBefore" type="number" min={0} max={240} step={5} defaultValue={block?.remindBefore ?? 0} className="input w-[66px] py-1" aria-label="Minuten vooraf" />
        min vooraf
      </label>
    </>
  );
}

export function BlockRow({ block, rhythms, rhythmId }: { block: BlockValues; rhythms: { id: string; name: string }[]; rhythmId: string }) {
  const [state, formAction, pending] = useActionState(updateBlockAction.bind(null, block.id), null as ActionResult | null);
  const [busy, start] = useTransition();
  const others = rhythms.filter((r) => r.id !== rhythmId);
  return (
    <li className={`px-4 py-3 ${busy ? "opacity-50" : ""}`}>
      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <BlockFields block={block} />
        <button className="btn ml-auto py-1.5" disabled={pending}>Opslaan</button>
      </form>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <FormMessage state={state} />
        <button type="button" className="btn-ghost text-xs text-nacht" onClick={() => confirm(`Blok "${block.title}" verwijderen? Taken erin blijven op hun dag staan.`) && start(() => deleteBlockAction(block.id))}>
          Verwijderen
        </button>
        {others.length > 0 && (
          <form action={(fd) => start(() => copyBlockAction(block.id, fd))} className="flex items-center gap-1.5 text-xs text-steen">
            <span>Kopieer naar</span>
            <select name="rhythmId" className="input py-0.5 text-xs" aria-label="Kopieer naar ritme">
              {others.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <button className="btn-ghost text-xs">Kopieer</button>
          </form>
        )}
      </div>
    </li>
  );
}

export function NewBlockForm({ rhythmId }: { rhythmId: string }) {
  const [state, formAction, pending] = useActionState(createBlockAction.bind(null, rhythmId), null as ActionResult | null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={formAction} className="space-y-1 px-4 py-3">
      <p className="label">Blok toevoegen</p>
      <div className="flex flex-wrap items-center gap-2">
        <BlockFields />
        <button className="btn-primary ml-auto py-1.5" disabled={pending}>Toevoegen</button>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

export function DeleteRhythmButton({ id, name }: { id: string; name: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={`btn-ghost text-xs text-nacht ${pending ? "opacity-50" : ""}`}
      onClick={() => confirm(`Dagritme "${name}" met alle blokken verwijderen? Taken blijven op hun dag staan, zonder blok.`) && start(() => deleteRhythmAction(id))}
    >
      Ritme verwijderen
    </button>
  );
}
