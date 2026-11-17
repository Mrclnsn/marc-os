"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setCockpitStyleAction } from "@/app/actions";
import { COCKPIT_STYLES, type CockpitStyle } from "@/lib/modules";

/** Klok die elke seconde bijwerkt; ververst de cockpit elke 5 minuten (nu-markering, signalen). */
export function LiveClock({ initial, tz, className = "" }: { initial: string; tz: string; className?: string }) {
  const router = useRouter();
  const [time, setTime] = useState(initial);
  const [sec, setSec] = useState("");
  useEffect(() => {
    const fmt = new Intl.DateTimeFormat("nl-NL", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const tick = () => {
      const [h, m, s] = fmt.format(new Date()).split(":");
      setTime(`${h}:${m}`);
      setSec(s);
    };
    tick();
    const t = setInterval(tick, 1000);
    const r = setInterval(() => router.refresh(), 5 * 60 * 1000);
    return () => {
      clearInterval(t);
      clearInterval(r);
    };
  }, [router, tz]);
  return (
    <span className={`tabular-nums ${className}`} suppressHydrationWarning>
      {time}
      <span className="ml-1 text-[0.45em] align-top text-steen" suppressHydrationWarning>{sec}</span>
    </span>
  );
}

/** Wisselen tussen de strakke MLC-cockpit en de Iron Man-cockpit (per apparaat). */
export function CockpitStyleSwitch({ style }: { style: CockpitStyle }) {
  const [pending, start] = useTransition();
  return (
    <div className={`inline-flex rounded-sm border border-lijn p-0.5 text-xs ${pending ? "opacity-60" : ""}`} role="group" aria-label="Cockpitstijl">
      {(Object.keys(COCKPIT_STYLES) as CockpitStyle[]).map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => start(() => setCockpitStyleAction(s))}
          className={`rounded-[2px] px-2.5 py-1 transition-colors ${s === style ? "bg-nacht font-bold text-op-nacht" : "text-steen hover:text-nacht"}`}
        >
          {s === "strak" ? "Strak" : "Iron Man"}
        </button>
      ))}
    </div>
  );
}
