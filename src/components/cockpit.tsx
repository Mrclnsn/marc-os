import Link from "next/link";
import type { Goal, HourWindow, Kpi, Signal, Timeline } from "@/lib/cockpit";
import { WORKDAY } from "@/lib/cockpit";
import { formatDuration } from "@/lib/duration";
import { Beeldmerk } from "./brand";

/*
 * Cockpit-onderdelen. Werken in beide stijlen: "strak" (MLC) en "ironman" (HUD).
 * In de Iron Man-stijl zet de wrapper .hud de kleuren; .accent, .glow, .hoeken en
 * .hud-mono krijgen daar gloed, hoekjes en een technisch lettertype. In de strakke stijl doen ze niets.
 */

/* ---------------- Paneel ---------------- */

export function Panel({ title, aside, id, children, className = "" }: { title: React.ReactNode; aside?: React.ReactNode; id?: string; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} className={`card hoeken relative scroll-mt-20 ${className}`}>
      <span aria-hidden className="accent absolute left-0 top-0 h-[3px] w-10 bg-nacht" />
      <header className="flex items-center justify-between gap-3 border-b border-lijn px-4 pb-2.5 pt-3.5">
        <h2 className="hud-mono text-xs font-bold uppercase tracking-[0.16em] text-nacht">{title}</h2>
        {aside && <div className="text-xs text-steen">{aside}</div>}
      </header>
      {children}
    </section>
  );
}

/* ---------------- Doelbalk ---------------- */

export function GoalBar({ goal }: { goal: Goal }) {
  const pct = goal.target > 0 ? Math.round((goal.value / goal.target) * 100) : 0;
  return (
    <section className="card hoeken relative overflow-hidden px-5 py-4 md:px-6 md:py-5">
      <span aria-hidden className="accent absolute left-0 top-0 h-[3px] w-16 bg-nacht" />
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <p className="hud-mono text-[11px] uppercase tracking-[0.18em] text-steen">Hoofddoel{goal.provisional ? " · voorlopig" : ""}</p>
          <p className="mt-1 text-xl font-bold leading-tight text-nacht md:text-2xl">{goal.title}</p>
        </div>
        <p className="glow hud-mono text-3xl font-bold tabular-nums leading-none text-nacht md:text-5xl">
          {goal.value}
          <span className="text-lg text-steen md:text-2xl"> / {goal.target}</span>
          <span className="ml-3 align-middle text-sm font-normal text-steen md:text-base">{pct}%</span>
        </p>
      </div>
      <div className="relative mt-4 h-2.5 overflow-hidden rounded-[2px] bg-parel">
        <div className="accent h-full bg-nacht transition-[width] duration-700" style={{ width: `${Math.min(100, pct)}%` }} />
        {/* maatstreepjes per 10% */}
        <div aria-hidden className="pointer-events-none absolute inset-0 grid grid-cols-10">
          {Array.from({ length: 10 }, (_, i) => <span key={i} className="border-r border-lijn last:border-r-0" />)}
        </div>
      </div>
      <p className="mt-2 text-xs text-steen">{goal.note}</p>
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
      <span aria-hidden className={`accent absolute left-0 top-0 h-[3px] bg-nacht ${k.alert ? "w-full" : "w-10"}`} />
      <span className="hud-mono block text-[11px] uppercase tracking-[0.14em] text-steen">{k.label}</span>
      <span className="glow hud-mono mt-2 block text-3xl font-bold leading-none tabular-nums text-nacht">{k.value}</span>
      {k.sub && <span className="mt-1.5 block truncate text-xs text-steen">{k.sub}</span>}
    </>
  );
  const cls = "card hoeken relative block min-w-0 px-4 pb-3.5 pt-4";
  return k.href ? (
    <Link href={k.href} className={`${cls} transition-colors hover:border-nacht`}>{inner}</Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

/* ---------------- Hermes: bol en briefing ---------------- */

/** De "bol": in Iron Man ademend en draaiend; in de strakke stijl het MLC-beeldmerk in een ring. */
export function Orb({ hud, size = 128 }: { hud: boolean; size?: number }) {
  if (!hud) {
    return (
      <div className="relative grid shrink-0 place-items-center rounded-full border-[3px] border-nacht text-nacht" style={{ width: size, height: size }}>
        <div className="absolute inset-2 rounded-full border border-lijn" />
        <Beeldmerk className="w-1/2" color="currentColor" strokeWidth={22} />
      </div>
    );
  }
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }} aria-hidden>
      <span className="bol-golf absolute inset-0 rounded-full border border-[var(--hud)]/50" />
      <span className="bol-golf-2 absolute inset-0 rounded-full border border-[var(--hud)]/40" />
      <span className="bol-ring absolute inset-0 rounded-full border border-dashed border-[var(--hud)]/60" />
      <span className="bol-ring-terug absolute inset-[10%] rounded-full border-2 border-transparent" style={{ borderTopColor: "var(--hud)", borderBottomColor: "rgba(103,232,249,0.35)" }} />
      <span
        className="bol-kern absolute inset-[24%] rounded-full"
        style={{
          background: "radial-gradient(circle at 35% 30%, #eafcff 0%, #67e8f9 28%, #0e7490 62%, #04121a 100%)",
          boxShadow: "0 0 40px rgba(103,232,249,0.65), 0 0 90px rgba(103,232,249,0.25), inset 0 0 18px rgba(255,255,255,0.35)",
        }}
      />
    </div>
  );
}

export function BriefingPanel({ hud, briefing, auto, at, nowLabel }: { hud: boolean; briefing: { body: string } | null; auto: string; at: string | null; nowLabel: string }) {
  return (
    <section className="card hoeken relative overflow-hidden">
      <span aria-hidden className="accent absolute left-0 top-0 h-[3px] w-10 bg-nacht" />
      {hud && <span aria-hidden className="scanlijn pointer-events-none absolute inset-0" />}
      <div className="flex flex-col items-center gap-5 p-5 sm:flex-row sm:items-start md:p-6">
        <Orb hud={hud} />
        <div className="min-w-0 flex-1">
          <p className="hud-mono text-[11px] uppercase tracking-[0.18em] text-steen">
            {briefing ? `Hermes · briefing ${at ?? ""}` : `Briefing · ${nowLabel}`}
          </p>
          <p className="mt-2 whitespace-pre-wrap text-[16px] leading-relaxed text-nacht md:text-[17px]">{briefing ? briefing.body : auto}</p>
          {!briefing && <p className="mt-2 text-xs text-steen">Automatisch samengesteld uit je taken en agenda. Vanaf gesprek 12 schrijft Hermes hier je ochtendbriefing.</p>}
        </div>
      </div>
    </section>
  );
}

/* ---------------- Hermes en agents ---------------- */

type AgentRow = { name: string; role: string; status: "actief" | "klaar" | "gepland"; detail: string };

const AGENTS: AgentRow[] = [
  { name: "Hermes", role: "Assistent", status: "gepland", detail: "gesprek 12" },
  { name: "Executive assistant", role: "Planning en briefings", status: "gepland", detail: "rol" },
  { name: "Coach", role: "Dagritme, gewoontes, sport", status: "gepland", detail: "rol" },
  { name: "Kennis", role: "Second brain", status: "gepland", detail: "rol" },
  { name: "Administratie", role: "Uren, aangiftes, facturen", status: "gepland", detail: "rol" },
  { name: "Claude (MCP)", role: "Grotere klussen", status: "klaar", detail: "na livegang" },
];

const ROUTINES = [
  { name: "Ochtendbriefing", when: "werkdagen 07:30" },
  { name: "Dagafsluiting", when: "werkdagen 17:30" },
  { name: "Weekreview", when: "vrijdag 15:00" },
];

export function AgentsPanel({ hasBriefing }: { hasBriefing: boolean }) {
  const dot = (s: AgentRow["status"]) =>
    s === "actief" ? "accent bg-nacht" : s === "klaar" ? "border border-nacht bg-transparent" : "border border-steen bg-transparent";
  return (
    <Panel title="Hermes · agents" aside="akkoord nodig: 0">
      <ul className="divide-y divide-lijn">
        {AGENTS.map((a) => (
          <li key={a.name} className="flex items-center gap-3 px-4 py-2.5">
            <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot(a.status)}`} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-bold text-nacht">{a.name}</span>
              <span className="block truncate text-xs text-steen">{a.role}</span>
            </span>
            <span className="hud-mono shrink-0 text-[10px] uppercase tracking-[0.12em] text-steen">{a.detail}</span>
          </li>
        ))}
      </ul>
      <div className="border-t border-lijn px-4 py-3">
        <p className="hud-mono mb-2 text-[10px] uppercase tracking-[0.14em] text-steen">Vaste routines</p>
        <ul className="space-y-1.5 text-sm">
          {ROUTINES.map((r, i) => (
            <li key={r.name} className="flex items-center justify-between gap-3">
              <span className="text-grafiet">{r.name}</span>
              <span className="text-xs text-steen">{i === 0 && hasBriefing ? "vandaag gedaan" : r.when}</span>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
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
                {s.level === "alert" && <span aria-hidden className="accent absolute inset-y-0 left-0 w-[3px] bg-nacht" />}
                <span className="hud-mono w-[74px] shrink-0 pt-0.5 text-[10px] uppercase tracking-[0.12em] text-steen">{s.group}</span>
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

/* ---------------- Tijdlijn komende 8 uur ---------------- */

const HOUR_PX = 54;

const hhmm = (min: number) => {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/** Echte tijdas: uurlijnen, agenda-blokken op hun plek, de nu-lijn en de werkdag als band. */
export function HourTimeline({ window: w, timeline }: { window: HourWindow; timeline: Timeline }) {
  const hours = (w.end - w.start) / 60;
  const y = (min: number) => ((Math.max(w.start, Math.min(w.end, min)) - w.start) / 60) * HOUR_PX;
  const workFrom = Number(WORKDAY.start.slice(0, 2)) * 60 + Number(WORKDAY.start.slice(3));
  const workTo = Number(WORKDAY.end.slice(0, 2)) * 60 + Number(WORKDAY.end.slice(3));
  const tight = timeline.freeMin !== null && timeline.plannedMin > timeline.freeMin;

  return (
    <Panel id="tijdlijn" title="Komende 8 uur" aside={`${hhmm(w.start + 60)} tot ${hhmm(w.end)}`}>
      <div className="grid grid-cols-3 divide-x divide-lijn border-b border-lijn text-center">
        <div className="px-2 py-2.5">
          <p className="glow hud-mono text-lg font-bold tabular-nums text-nacht">{timeline.dayOver ? "–" : formatDuration(timeline.freeMin)}</p>
          <p className="text-[10px] uppercase tracking-[0.12em] text-steen">nog vrij</p>
        </div>
        <div className="px-2 py-2.5">
          <p className={`glow hud-mono text-lg font-bold tabular-nums ${tight ? "text-nacht" : "text-grafiet"}`}>{formatDuration(timeline.plannedMin)}</p>
          <p className="text-[10px] uppercase tracking-[0.12em] text-steen">ingeschat</p>
        </div>
        <div className="px-2 py-2.5">
          <p className="glow hud-mono text-lg font-bold tabular-nums text-nacht">{w.events.filter((e) => !e.past).length}</p>
          <p className="text-[10px] uppercase tracking-[0.12em] text-steen">afspraken</p>
        </div>
      </div>
      {tight && <p className="border-b border-lijn px-4 py-2 text-xs font-bold text-nacht">Meer ingepland dan er tijd is tot {WORKDAY.end}</p>}

      {timeline.allDay.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-lijn px-4 py-2.5">
          {timeline.allDay.map((e, i) => (
            <span key={i} className="chip" title={e.calendar}>Hele dag · {e.title}</span>
          ))}
        </div>
      )}

      <div className="px-3 py-4">
        <div className="relative" style={{ height: hours * HOUR_PX }}>
          {/* werkdag als zachte band */}
          {workTo > w.start && workFrom < w.end && (
            <div aria-hidden className="absolute left-12 right-0 bg-parel" style={{ top: y(workFrom), height: y(workTo) - y(workFrom) }} />
          )}
          {/* uurlijnen */}
          {Array.from({ length: hours + 1 }, (_, i) => (
            <div key={i} className="absolute left-0 right-0 flex items-start" style={{ top: i * HOUR_PX }}>
              <span className="hud-mono w-10 -translate-y-1/2 text-right text-[11px] tabular-nums text-steen">{hhmm(w.start + i * 60)}</span>
              <span className="ml-2 h-px flex-1 bg-lijn" />
            </div>
          ))}
          {/* agenda */}
          {w.events.map((e, i) => {
            const top = y(e.from);
            const height = Math.max(22, y(e.to) - top - 2);
            return (
              <div
                key={i}
                className={`absolute left-14 right-1 overflow-hidden rounded-[2px] border-l-[3px] bg-vlak px-2.5 py-1 shadow-sm ${e.current ? "border-nacht" : "border-steen"} ${e.past ? "opacity-45" : ""}`}
                style={{ top: top + 1, height }}
                title={`${e.title} · ${e.label}`}
              >
                <p className="truncate text-[13px] font-bold leading-tight text-nacht">{e.title}</p>
                {height > 34 && <p className="truncate text-[11px] text-steen">{e.label} · {e.calendar}{e.location ? ` · ${e.location}` : ""}</p>}
              </div>
            );
          })}
          {/* nu */}
          <div className="absolute left-0 right-0 z-10 flex -translate-y-1/2 items-center" style={{ top: y(w.now) }}>
            <span className="hud-mono w-10 text-right text-[11px] font-bold tabular-nums text-nacht">{hhmm(w.now)}</span>
            <span aria-hidden className="accent ml-1.5 h-2.5 w-2.5 rounded-full bg-nacht" />
            <span aria-hidden className="accent h-[2px] flex-1 bg-nacht" />
          </div>
        </div>
        {timeline.calendar === "none" && (
          <p className="mt-3 text-sm text-steen">
            Nog geen agenda gekoppeld. <Link href="/instellingen" className="underline decoration-lijn underline-offset-2 hover:decoration-nacht">Zo koppel je er een</Link>.
          </p>
        )}
        {timeline.errors.map((err) => (
          <p key={err} className="mt-2 text-xs text-steen">{err}</p>
        ))}
        <p className="mt-3 text-[11px] text-steen">Dagritme-blokken (dagstart, diep werk, sport) komen hier in gesprek 8.</p>
      </div>
    </Panel>
  );
}

/* ---------------- Plekken voor later ---------------- */

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
