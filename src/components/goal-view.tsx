import Link from "next/link";
import { GOAL_STATUS, STATUS_TONE, type GoalStatus } from "@/lib/goals-shared";
import type { GoalRow } from "@/lib/goals";

/* Weergave van doelen (gesprek 10): status, balk met "waar je nu zou moeten zijn", kaart. Zonder hooks: ook op de server. */

/** Status als label. Goed = gevuld, achter = omlijnd, risico = omlijnd en vet met teken. Eén kleur (MLC), vorm draagt de betekenis. */
export function StatusChip({ status, className = "" }: { status: GoalStatus; className?: string }) {
  const tone = STATUS_TONE[status];
  const cls =
    tone === "good"
      ? "bg-nacht text-op-nacht"
      : tone === "warn"
        ? "border border-nacht text-nacht"
        : tone === "bad"
          ? "border-2 border-nacht font-bold text-nacht"
          : "bg-parel text-steen";
  return (
    <span className={`hud-mono inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-sm px-1.5 py-0.5 text-[11px] uppercase tracking-[0.08em] ${cls} ${className}`}>
      {tone === "bad" ? "! " : ""}
      {GOAL_STATUS[status]}
    </span>
  );
}

/** Balk: vulling = voortgang, streepje = waar je nu zou moeten staan. */
export function GoalProgress({ pct, expectedPct, thin = false }: { pct: number | null; expectedPct: number | null; thin?: boolean }) {
  const fill = Math.min(100, pct ?? 0);
  return (
    <div className={`relative ${thin ? "h-1.5" : "h-2.5"} overflow-visible rounded-[2px] bg-parel`} role="img" aria-label={`${pct ?? 0}% van het doel${expectedPct != null ? `, verwacht ${expectedPct}%` : ""}`}>
      <div className="accent h-full rounded-[2px] bg-nacht transition-[width] duration-700" style={{ width: `${fill}%` }} />
      {expectedPct != null && expectedPct > 0 && expectedPct < 100 && (
        <span aria-hidden className="absolute -top-1 bottom-[-4px] w-[2px] bg-steen" style={{ left: `calc(${expectedPct}% - 1px)` }} title={`Verwacht rond deze tijd: ${expectedPct}%`} />
      )}
    </div>
  );
}

export function GoalCard({ g, sub = [] }: { g: GoalRow; sub?: GoalRow[] }) {
  return (
    <article className="card hoeken relative flex flex-col gap-3 p-4">
      <span aria-hidden className={`accent absolute left-0 top-0 h-[3px] bg-nacht ${g.featured ? "w-full" : "w-10"}`} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="hud-mono text-[11px] uppercase tracking-[0.14em] text-steen">
            {g.areaLabel} · {g.periodLabel}
            {g.featured ? " · hoofddoel" : ""}
          </p>
          <Link href={`/doelen/${g.id}`} className="mt-0.5 block text-[17px] font-bold leading-snug text-nacht hover:underline">
            {g.title}
          </Link>
        </div>
        <StatusChip status={g.eval.status} />
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="glow hud-mono text-2xl font-bold tabular-nums leading-none text-nacht">{g.eval.valueLabel}</p>
        <p className="text-right text-xs text-steen">doel {g.eval.targetLabel}</p>
      </div>
      <GoalProgress pct={g.eval.pct} expectedPct={g.eval.expectedPct} />
      <p className="text-xs leading-relaxed text-steen">
        {g.eval.summary}
        {g.eval.needed ? <span className="text-grafiet"> Nodig: {g.eval.needed}.</span> : null}
      </p>
      {sub.length > 0 && (
        <ul className="divide-y divide-lijn border-t border-lijn pt-1">
          {sub.map((c) => (
            <li key={c.id} className="flex items-center gap-3 py-2">
              <Link href={`/doelen/${c.id}`} className="min-w-0 flex-1 truncate text-sm text-grafiet hover:text-nacht hover:underline">
                {c.title}
              </Link>
              <span className="hud-mono shrink-0 text-xs tabular-nums text-steen">{c.eval.valueLabel}</span>
              <StatusChip status={c.eval.status} />
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

/** Compacte regel voor komende, afgelopen en gearchiveerde doelen. */
export function GoalLine({ g }: { g: GoalRow }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
      <Link href={`/doelen/${g.id}`} className="min-w-0 flex-1 font-medium text-nacht hover:underline">
        {g.title}
      </Link>
      <span className="text-xs text-steen">
        {g.areaLabel} · {g.periodLabel}
      </span>
      <span className="hud-mono text-xs tabular-nums text-steen">
        {g.eval.valueLabel} / {g.eval.targetLabel}
      </span>
      <StatusChip status={g.eval.status} />
    </li>
  );
}
