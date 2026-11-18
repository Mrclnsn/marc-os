"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { runRoutineNowAction, setRoutineAction } from "@/app/hermes-actions";
import { ROUTINES, WEEKDAY_LONG, type RoutineKey, type RoutineSetting } from "@/lib/routines-shared";
import { Switch } from "./settings-parts";

/** Eén vaste routine: aan/uit, tijd (en dag), kanalen en "Nu draaien". */
export function RoutineControls({
  routineKey,
  setting,
  whatsappReady,
  blocked,
}: {
  routineKey: RoutineKey;
  setting: RoutineSetting;
  whatsappReady: boolean;
  blocked: string | null;
}) {
  const def = ROUTINES[routineKey];
  const [s, setS] = useState(setting);
  const [pending, start] = useTransition();
  const [running, startRun] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const router = useRouter();

  const save = (patch: Partial<RoutineSetting>) =>
    start(async () => {
      setS((cur) => ({ ...cur, ...patch }));
      await setRoutineAction(routineKey, patch);
    });

  const runNow = () =>
    startRun(async () => {
      setResult(null);
      const r = await runRoutineNowAction(routineKey);
      setResult(r.ok ? "Klaar. Staat bij Reviews en is verstuurd." : `Mislukt: ${r.error}`);
      router.refresh();
    });

  return (
    <div className={`space-y-3 ${pending ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 text-sm">
        <label className="flex items-center gap-2">
          <Switch on={s.enabled} label={`${def.label} aan`} onChange={(v) => save({ enabled: v })} />
          <span>{s.enabled ? "Aan" : "Uit"}</span>
        </label>
        {def.schedule === "weekly" && (
          <select className="input w-auto py-1 text-sm" value={s.weekday ?? def.weekday} onChange={(e) => save({ weekday: Number(e.target.value) })} aria-label="Dag">
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <option key={d} value={d}>
                {WEEKDAY_LONG[d]}
              </option>
            ))}
          </select>
        )}
        <label className="flex items-center gap-2">
          <span className="text-steen">{def.schedule === "workdays" ? "werkdagen om" : def.schedule === "monthly" ? "1e werkdag om" : "om"}</span>
          <input
            type="time"
            className="input w-auto py-1 text-sm"
            defaultValue={s.time}
            onBlur={(e) => {
              if (e.target.value && e.target.value !== s.time) save({ time: e.target.value });
            }}
          />
        </label>
        <label className={`flex items-center gap-2 ${whatsappReady ? "" : "opacity-50"}`} title={whatsappReady ? undefined : "WhatsApp is nog niet gekoppeld"}>
          <Switch on={s.whatsapp} disabled={!whatsappReady} label="Naar WhatsApp" onChange={(v) => save({ whatsapp: v })} />
          <span>WhatsApp</span>
        </label>
        <label className="flex items-center gap-2">
          <Switch on={s.push} label="Pushmelding" onChange={(v) => save({ push: v })} />
          <span>Pushmelding</span>
        </label>
        <button type="button" className="btn ml-auto" disabled={running || !!blocked} onClick={runNow} title={blocked ?? undefined}>
          {running ? "Bezig… (kan een paar minuten duren)" : "Nu draaien"}
        </button>
      </div>
      {result && <p className={`text-sm ${result.startsWith("Mislukt") ? "font-bold text-nacht" : "text-grafiet"}`}>{result}</p>}
    </div>
  );
}
