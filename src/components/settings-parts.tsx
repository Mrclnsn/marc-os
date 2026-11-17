"use client";

import { useOptimistic, useTransition } from "react";
import { setKpiVisibleAction, setModuleAction } from "@/app/actions";
import type { KpiKey, ModuleKey } from "@/lib/modules";

/** Schakelaar in MLC-stijl: een lijn met een blokje, geen kleur. */
export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:opacity-40 ${
        on ? "border-nacht bg-nacht" : "border-lijn bg-parel"
      }`}
    >
      <span className={`absolute h-4 w-4 rounded-full transition-all ${on ? "left-[22px] bg-op-nacht" : "left-[3px] bg-steen"}`} />
    </button>
  );
}

export function ModuleSwitch({ module, on, label }: { module: ModuleKey; on: boolean; label: string }) {
  const [pending, start] = useTransition();
  const [value, setValue] = useOptimistic(on);
  return (
    <span className={pending ? "opacity-60" : ""}>
      <Switch
        on={value}
        label={label}
        onChange={(next) =>
          start(async () => {
            setValue(next);
            await setModuleAction(module, next);
          })
        }
      />
    </span>
  );
}

export function KpiSwitch({ kpi, on, label, disabled }: { kpi: KpiKey; on: boolean; label: string; disabled?: boolean }) {
  const [pending, start] = useTransition();
  const [value, setValue] = useOptimistic(on);
  return (
    <span className={pending ? "opacity-60" : ""}>
      <Switch
        on={value}
        label={label}
        disabled={disabled}
        onChange={(next) =>
          start(async () => {
            setValue(next);
            await setKpiVisibleAction(kpi, next);
          })
        }
      />
    </span>
  );
}
