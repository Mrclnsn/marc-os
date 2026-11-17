"use client";

import { useTransition } from "react";
import { setThemeAction } from "@/app/actions";
import { THEMES, type Theme } from "@/lib/modules";

const ORDER: Theme[] = ["systeem", "licht", "donker"];
const SHORT: Record<Theme, string> = { systeem: "Auto", licht: "Licht", donker: "Donker" };

/** Klein wisselknopje voor de zijbalk: systeem → licht → donker. */
export function ThemeSwitch({ theme }: { theme: Theme }) {
  const [pending, start] = useTransition();
  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
  return (
    <button
      type="button"
      onClick={() => start(() => setThemeAction(next))}
      title={`Weergave: ${THEMES[theme]}. Klik voor ${THEMES[next].toLowerCase()}.`}
      className={`flex items-center gap-1.5 text-xs text-white/50 transition-colors hover:text-white ${pending ? "opacity-50" : ""}`}
    >
      <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full border border-current" style={{ background: theme === "donker" ? "currentColor" : theme === "systeem" ? "linear-gradient(90deg, currentColor 50%, transparent 50%)" : "transparent" }} />
      {SHORT[theme]}
    </button>
  );
}

/** Keuze met drie knoppen voor de pagina Instellingen. */
export function ThemeChoice({ theme }: { theme: Theme }) {
  const [pending, start] = useTransition();
  return (
    <div className={`inline-flex rounded-sm border border-lijn p-0.5 ${pending ? "opacity-60" : ""}`}>
      {ORDER.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => start(() => setThemeAction(t))}
          className={`rounded-[2px] px-3 py-1.5 text-sm transition-colors ${t === theme ? "bg-nacht font-bold text-op-nacht" : "text-steen hover:text-nacht"}`}
        >
          {THEMES[t]}
        </button>
      ))}
    </div>
  );
}
