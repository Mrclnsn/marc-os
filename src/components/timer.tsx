"use client";

import Link from "next/link";
import { useSyncExternalStore, useTransition } from "react";
import { startProjectTimerAction, startTaskTimerAction, stopTimerAction } from "@/app/actions";

function elapsed(startIso: string, now: number) {
  const sec = Math.max(0, Math.floor((now - new Date(startIso).getTime()) / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Klok die elke seconde tikt (op de server: null). */
function subscribe(cb: () => void) {
  const id = setInterval(cb, 1000);
  return () => clearInterval(id);
}
const nowSecond = () => Math.floor(Date.now() / 1000) * 1000;

/** Lopende tijd, telt elke seconde door. */
export function Elapsed({ since, className = "" }: { since: string; className?: string }) {
  const now = useSyncExternalStore(subscribe, nowSecond, () => null);
  return <span className={`tabular-nums ${className}`}>{now == null ? "0:00:00" : elapsed(since, now)}</span>;
}

export type RunningTimer = { id: string; startedAt: string; description: string | null; clientName: string | null; projectName: string | null; billable: boolean };

/**
 * Balk met de lopende timer, op elke pagina.
 * Telefoon: vlak boven de onderbalk (bereikbaar met de duim). Desktop: bovenaan de inhoud.
 */
export function TimerBar({ timer }: { timer: RunningTimer }) {
  const [pending, start] = useTransition();
  const meta = [timer.clientName, timer.projectName, timer.billable ? "declarabel" : null].filter(Boolean).join(" · ");
  return (
    <div className="fixed inset-x-0 bottom-[calc(46px+env(safe-area-inset-bottom))] z-20 border-t border-white/10 bg-balk text-white md:sticky md:top-0 md:bottom-auto md:border-t-0">
      <div className="mx-auto flex max-w-5xl items-center gap-4 px-5 py-2.5 md:px-12">
        <span className="h-2 w-2 shrink-0 rounded-full bg-white" aria-hidden />
        <Link href="/uren" className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-bold">{timer.description || "Timer loopt"}</span>
          {meta && <span className="block truncate text-xs text-white/60">{meta}</span>}
        </Link>
        <Elapsed since={timer.startedAt} className="text-lg font-bold" />
        <button
          onClick={() => start(() => stopTimerAction())}
          disabled={pending}
          className="inline-flex shrink-0 items-center rounded-sm bg-white px-3.5 py-1.5 text-sm font-bold text-zijbalk transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          Stop
        </button>
      </div>
    </div>
  );
}

/** Kleine startknop (bij een taak of project). */
export function StartTimerButton({ taskId, projectId, label = "▶", className = "btn-ghost text-xs" }: { taskId?: string; projectId?: string; label?: string; className?: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      title="Timer starten"
      aria-label="Timer starten"
      disabled={pending}
      className={className}
      onClick={() => start(() => (taskId ? startTaskTimerAction(taskId) : projectId ? startProjectTimerAction(projectId) : Promise.resolve()))}
    >
      {label}
    </button>
  );
}
