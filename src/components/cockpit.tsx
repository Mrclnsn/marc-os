import Link from "next/link";
import type { Kpi, Signal, Timeline } from "@/lib/cockpit";
import { WORKDAY } from "@/lib/cockpit";
import { formatDuration } from "@/lib/duration";

/* ---------------- Paneel: één accentlijn, geen ruis ---------------- */

export function Panel({ title, aside, id, children, className = "" }: { title: React.ReactNode; aside?: React.ReactNode; id?: string; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} className={`card relative scroll-mt-20 ${className}`}>
      <span aria-hidden className="absolute left-0 top-0 h-[3px] w-10 bg-nacht" />
      <header className="flex items-center justify-between gap-3 border-b border-lijn px-4 pb-2.5 pt-3.5">
        <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-nacht">{title}</h2>
        {aside && <div className="text-xs text-steen">{aside}</div>}
      </header>
      {children}
    </section>
  );
}

/* ---------------- KPI-tegels ---------------- */

export function KpiTiles({ kpis }: { kpis: Kpi[] }) {
  if (!kpis.length) return null;
  // Zo min mogelijk losse tegels op de laatste rij
  const n = kpis.length;
  const cols = n <= 4 ? "lg:grid-cols-4" : n === 5 || n >= 9 ? "lg:grid-cols-5" : n === 6 ? "lg:grid-cols-6" : "lg:grid-cols-4";
  return (
    <div className={`grid grid-cols-2 gap-3 sm:grid-cols-3 ${cols}`}>
      {kpis.map((k) => (
        <KpiTile key={k.key} k={k} />
      ))}
    </div>
  );
}

function KpiTile({ k }: { k: Kpi }) {
  const inner = (
    <>
      <span aria-hidden className={`absolute left-0 top-0 h-[3px] bg-nacht ${k.alert ? "w-full" : "w-10"}`} />
      <span className="block text-[11px] uppercase tracking-[0.14em] text-steen">{k.label}</span>
      <span className="mt-2 block text-3xl font-bold leading-none tabular-nums text-nacht">{k.value}</span>
      {k.sub && <span className="mt-1.5 block truncate text-xs text-steen">{k.sub}</span>}
    </>
  );
  const cls = "card relative block min-w-0 px-4 pb-3.5 pt-4";
  return k.href ? (
    <Link href={k.href} className={`${cls} transition-colors hover:border-nacht`}>{inner}</Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

/* ---------------- Signalen ---------------- */

export function SignalPanel({ signals }: { signals: Signal[] }) {
  const alerts = signals.filter((s) => s.level === "alert").length;
  return (
    <Panel title="Signalen" aside={signals.length ? `${signals.length}${alerts ? ` · ${alerts} met voorrang` : ""}` : undefined}>
      {signals.length === 0 ? (
        <p className="px-4 py-4 text-sm text-steen">Geen signalen. Alles onder controle.</p>
      ) : (
        <ul className="divide-y divide-lijn">
          {signals.map((s, i) => (
            <li key={`${s.href}-${i}`}>
              <Link href={s.href} className="relative flex gap-3 px-4 py-2.5 transition-colors hover:bg-parel">
                {s.level === "alert" && <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-nacht" />}
                <span className="w-[74px] shrink-0 pt-0.5 text-[10px] uppercase tracking-[0.12em] text-steen">{s.group}</span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-[14px] leading-snug ${s.level === "alert" ? "font-bold text-nacht" : "text-grafiet"}`}>{s.title}</span>
                  {s.detail && <span className="block truncate text-xs text-steen">{s.detail}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ---------------- Tijdlijn ---------------- */

/** Agenda van vandaag als verticale lijn met een "nu"-markering, plus een regel met de vrije tijd. */
export function TimelineView({ timeline }: { timeline: Timeline }) {
  const { allDay, items, freeMin, plannedMin, estimated, planned, dayOver, calendar, errors } = timeline;
  const tight = freeMin !== null && plannedMin > freeMin;
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 border-b border-lijn px-4 py-2.5 text-xs">
        {dayOver ? (
          <span className="text-steen">Werkdag ({WORKDAY.start} tot {WORKDAY.end}) voorbij</span>
        ) : (
          <span>
            <span className="text-steen">Nog vrij tot {WORKDAY.end} </span>
            <span className="font-bold tabular-nums text-nacht">{formatDuration(freeMin)}</span>
          </span>
        )}
        <span>
          <span className="text-steen">Ingeschat </span>
          <span className={`tabular-nums ${tight ? "font-bold text-nacht" : "text-grafiet"}`}>{formatDuration(plannedMin)}</span>
          <span className="text-steen"> ({estimated} van {planned.length} {planned.length === 1 ? "taak" : "taken"})</span>
        </span>
        {tight && <span className="font-bold text-nacht">Meer ingepland dan er tijd is</span>}
      </div>

      {calendar === "none" ? (
        <p className="px-4 py-3 text-sm text-steen">
          Nog geen agenda gekoppeld. <Link href="/instellingen" className="underline decoration-lijn underline-offset-2 hover:decoration-nacht">Zo koppel je er een</Link>.
        </p>
      ) : (
        <div className="px-4 py-3">
          {allDay.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {allDay.map((e, i) => (
                <span key={i} className="chip" title={e.calendar}>Hele dag · {e.title}</span>
              ))}
            </div>
          )}
          <ol className="relative">
            {items.map((item, i) =>
              item.kind === "now" ? (
                <li key={`now-${i}`} className="relative grid grid-cols-[48px_1fr] items-center gap-3 py-1.5" aria-label={`Nu, ${item.time}`}>
                  <span className="text-right text-xs font-bold tabular-nums text-nacht">{item.time}</span>
                  <span className="relative flex items-center">
                    <span aria-hidden className="absolute -left-[5px] h-[9px] w-[9px] rounded-full bg-nacht" />
                    <span aria-hidden className="h-[2px] flex-1 bg-nacht" />
                    <span className="ml-2 text-[10px] font-bold uppercase tracking-[0.14em] text-nacht">Nu</span>
                  </span>
                </li>
              ) : (
                <li key={i} className={`relative grid grid-cols-[48px_1fr] gap-3 ${item.past ? "opacity-45" : ""}`}>
                  <span className="pt-2 text-right text-xs tabular-nums text-steen">{item.event.time}</span>
                  <span className={`relative border-l py-1.5 pl-4 ${item.current ? "border-l-[3px] border-nacht" : "border-lijn"}`}>
                    <span className="block text-[15px] font-bold leading-snug text-nacht">{item.event.title}</span>
                    <span className="block text-xs text-steen">
                      {item.event.time} tot {item.event.endTime} · {item.event.calendar}
                      {item.event.location ? ` · ${item.event.location}` : ""}
                    </span>
                  </span>
                </li>
              ),
            )}
          </ol>
          {items.length === 1 && <p className="mt-1 pl-[60px] text-sm text-steen">Geen afspraken vandaag.</p>}
          {errors.map((err) => (
            <p key={err} className="mt-2 text-xs text-steen">{err}</p>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- Plekken voor latere gesprekken ---------------- */

/**
 * Doelbalk bovenaan de cockpit: hoofddoel met voortgang en on-track-status.
 * Gesprek 10 (doelen) vult dit; tot die tijd verborgen.
 */
export function GoalBar({ goal }: { goal?: { title: string; pct: number; status: string } | null }) {
  if (!goal) return null;
  return (
    <div className="card relative flex items-center gap-4 px-4 py-3">
      <span aria-hidden className="absolute left-0 top-0 h-[3px] w-10 bg-nacht" />
      <span className="text-[11px] uppercase tracking-[0.14em] text-steen">Doel</span>
      <span className="min-w-0 flex-1 truncate font-bold text-nacht">{goal.title}</span>
      <span className="hidden h-1.5 w-40 bg-parel sm:block"><span className="block h-full bg-nacht" style={{ width: `${Math.min(100, goal.pct)}%` }} /></span>
      <span className="text-xs text-steen">{goal.status}</span>
    </div>
  );
}

/**
 * Gewoontes van vandaag om af te vinken, met reeks en percentage.
 * Gesprek 8 vult dit; tot die tijd verborgen.
 */
export function HabitsPanel({ habits }: { habits?: { id: string; title: string; done: boolean; streak: number }[] | null }) {
  if (!habits?.length) return null;
  return (
    <Panel title="Gewoontes">
      <ul className="divide-y divide-lijn">
        {habits.map((h) => (
          <li key={h.id} className="flex items-center justify-between px-4 py-2 text-sm">
            <span className={h.done ? "text-steen line-through" : "text-grafiet"}>{h.title}</span>
            <span className="text-xs tabular-nums text-steen">{h.streak} op rij</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/**
 * Hermes: briefing van vandaag. Gesprek 12 en 13 voegen hier de akkoordwachtrij
 * (voorstellen goedkeuren met één tik) en de status van de vaste routines aan toe.
 */
export function HermesPanel({ briefing }: { briefing: { body: string } | null }) {
  if (!briefing) return null;
  return (
    <section className="relative rounded-sm bg-zijbalk p-5 text-white md:p-6">
      <span aria-hidden className="absolute left-0 top-0 h-[3px] w-10 bg-white" />
      <p className="mb-3 text-[11px] uppercase tracking-[0.2em] text-white/50">Briefing</p>
      <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-white/90">{briefing.body}</div>
    </section>
  );
}
