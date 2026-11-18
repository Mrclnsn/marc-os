import Link from "next/link";
import type { Goal, HabitToday, HourWindow, Kpi, Signal, Timeline } from "@/lib/cockpit";
import { HabitCheckList } from "./habit-parts";
import { formatDuration } from "@/lib/duration";
import { Beeldmerk } from "./brand";
import { StatusChip } from "./goal-view";
import { ProposalCard } from "./hermes-parts";
import type { ProposalView } from "@/app/hermes-actions";

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
  const pct = Math.max(0, Math.round(goal.pct));
  const head = (
    <p className="mt-1 text-xl font-bold leading-tight text-nacht md:text-2xl">{goal.title}</p>
  );
  return (
    <section className="card hoeken relative overflow-hidden px-5 py-4 md:px-6 md:py-5">
      <span aria-hidden className="accent absolute left-0 top-0 h-[3px] w-16 bg-nacht" />
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <p className="hud-mono flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-steen">
            Hoofddoel{goal.provisional ? " · voorlopig" : ""}
            {goal.status && <StatusChip status={goal.status} />}
          </p>
          {goal.id ? (
            <Link href={`/doelen/${goal.id}`} className="hover:underline">{head}</Link>
          ) : (
            head
          )}
        </div>
        <p className="glow hud-mono text-3xl font-bold tabular-nums leading-none text-nacht md:text-5xl">
          {goal.valueLabel}
          <span className="text-lg text-steen md:text-2xl"> / {goal.targetLabel}</span>
          <span className="ml-3 align-middle text-sm font-normal text-steen md:text-base">{pct}%</span>
        </p>
      </div>
      <div className="relative mt-4 h-2.5 rounded-[2px] bg-parel">
        <div className="accent h-full rounded-[2px] bg-nacht transition-[width] duration-700" style={{ width: `${Math.min(100, pct)}%` }} />
        {/* maatstreepjes per 10% */}
        <div aria-hidden className="pointer-events-none absolute inset-0 grid grid-cols-10">
          {Array.from({ length: 10 }, (_, i) => <span key={i} className="border-r border-lijn last:border-r-0" />)}
        </div>
        {goal.expectedPct != null && goal.expectedPct > 0 && goal.expectedPct < 100 && (
          <span aria-hidden title={`Verwacht rond deze tijd: ${goal.expectedPct}%`} className="absolute -top-1.5 bottom-[-6px] w-[2px] bg-steen" style={{ left: `calc(${goal.expectedPct}% - 1px)` }} />
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs text-steen">
        <p className="min-w-0">{goal.note}</p>
        {goal.others && (
          <Link href="/doelen" className="hud-mono shrink-0 whitespace-nowrap hover:text-nacht">
            Doelen: {goal.others.good} op schema{goal.others.warn ? ` · ${goal.others.warn} achter` : ""}{goal.others.bad ? ` · ${goal.others.bad} risico` : ""} →
          </Link>
        )}
      </div>
    </section>
  );
}

/* ---------------- KPI-tegels ---------------- */

export function KpiTiles({ kpis }: { kpis: Tile[] }) {
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

/** Tegel: een KPI van Vandaag of een eigen tegel (bijv. op Gezondheid). */
export type Tile = Omit<Kpi, "key"> & { key: string };

function KpiTile({ k }: { k: Tile }) {
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

export function BriefingPanel({ hud, briefing, auto, at, nowLabel }: { hud: boolean; briefing: { body: string; heading?: string | null } | null; auto: string; at: string | null; nowLabel: string }) {
  return (
    <section className="card hoeken relative overflow-hidden">
      <span aria-hidden className="accent absolute left-0 top-0 h-[3px] w-10 bg-nacht" />
      {hud && <span aria-hidden className="scanlijn pointer-events-none absolute inset-0" />}
      <div className="flex flex-col items-center gap-5 p-5 sm:flex-row sm:items-start md:p-6">
        <Orb hud={hud} />
        <div className="min-w-0 flex-1">
          <p className="hud-mono text-[11px] uppercase tracking-[0.18em] text-steen">
            {briefing ? `Hermes · ${(briefing.heading ?? "briefing").toLowerCase()} ${at ?? ""}` : `Briefing · ${nowLabel}`}
          </p>
          <p className="mt-2 whitespace-pre-wrap text-[16px] leading-relaxed text-nacht md:text-[17px]">{briefing ? briefing.body : auto}</p>
          {!briefing && <p className="mt-2 text-xs text-steen">Automatisch samengesteld uit je taken en agenda. Op werkdagen schrijft Hermes hier om 07:30 je ochtendbriefing (Hermes → Routines).</p>}
        </div>
      </div>
    </section>
  );
}

/* ---------------- Hermes en agents ---------------- */

export type AgentsData = {
  status: { configured: boolean; online: boolean };
  pending: ProposalView[];
  pendingTotal: number;
  hermesLast: { at: string; summary: string } | null;
  claudeLast: { at: string; summary: string } | null;
  /** null = niet gekoppeld */
  whatsapp: string | null;
  routines: { name: string; when: string; state: "ok" | "failed" | "running" | null; detail: string | null }[];
};

const ago = (iso: string) => {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "zojuist";
  if (min < 60) return `${min} min`;
  if (min < 24 * 60) return `${Math.round(min / 60)} uur`;
  return `${Math.round(min / 1440)} d`;
};

export function AgentsPanel({ data }: { data: AgentsData }) {
  const { status } = data;
  const hermes = status.online ? "actief" : status.configured ? "offline" : "gepland";
  const rows: { name: string; role: string; status: "actief" | "klaar" | "gepland" | "offline"; detail: string }[] = [
    {
      name: "Hermes",
      role: data.hermesLast ? data.hermesLast.summary : "Assistent in de app",
      status: hermes,
      detail: status.online ? (data.hermesLast ? ago(data.hermesLast.at) : "online") : status.configured ? "offline" : "installeren",
    },
    { name: "Executive assistant", role: "Planning en briefings", status: status.online ? "klaar" : "gepland", detail: "rol" },
    { name: "Coach", role: "Dagritme, gewoontes, sport", status: status.online ? "klaar" : "gepland", detail: "rol" },
    { name: "Kennis", role: "Second brain", status: status.online ? "klaar" : "gepland", detail: "rol" },
    { name: "Administratie", role: "Uren, aangiftes, facturen", status: status.online ? "klaar" : "gepland", detail: "rol" },
    { name: "Claude (MCP)", role: data.claudeLast ? data.claudeLast.summary : "Grotere klussen", status: "klaar", detail: data.claudeLast ? ago(data.claudeLast.at) : "gekoppeld" },
  ];
  const dot = (s: (typeof rows)[number]["status"]) =>
    s === "actief" ? "accent bg-nacht" : s === "klaar" ? "border border-nacht bg-transparent" : s === "offline" ? "border-2 border-nacht bg-transparent" : "border border-steen bg-transparent";
  return (
    <Panel title="Hermes · agents" aside={<Link href="/hermes?tab=akkoord" className="hover:text-nacht">akkoord nodig: {data.pendingTotal}</Link>}>
      <ul className="divide-y divide-lijn">
        {rows.map((a) => (
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
      {data.pending.length > 0 && (
        <div className="space-y-2 border-t border-lijn px-4 py-3">
          <p className="hud-mono text-[10px] uppercase tracking-[0.14em] text-steen">Akkoord nodig</p>
          {data.pending.map((p) => (
            <ProposalCard key={p.id} proposal={p} via="cockpit" compact />
          ))}
          {data.pendingTotal > data.pending.length && (
            <Link href="/hermes?tab=akkoord" className="block text-xs text-steen hover:text-nacht">
              Nog {data.pendingTotal - data.pending.length} → alle voorstellen
            </Link>
          )}
        </div>
      )}
      <div className="border-t border-lijn px-4 py-3">
        <p className="hud-mono mb-2 text-[10px] uppercase tracking-[0.14em] text-steen">Vaste routines</p>
        {data.routines.length === 0 ? (
          <p className="text-xs text-steen">
            Geen routines aan. <Link href="/hermes?tab=routines" className="underline">Instellen</Link>
          </p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {data.routines.map((r) => (
              <li key={r.name} className="flex items-center justify-between gap-3">
                <Link href="/hermes?tab=routines" className="text-grafiet hover:text-nacht">
                  {r.name}
                </Link>
                <span className={`text-xs ${r.state === "failed" ? "font-bold text-nacht" : r.state === "ok" ? "text-nacht" : "text-steen"}`}>{r.detail ?? r.when}</span>
              </li>
            ))}
          </ul>
        )}
        {data.whatsapp && <p className="mt-2 text-xs text-steen">WhatsApp: {data.whatsapp}</p>}
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

/**
 * Echte tijdas: uurlijnen, dagritmeblokken (links) en agenda (rechts) op hun plek, de nu-lijn en de werkdag als band.
 * Zonder agenda-items in beeld krijgen de blokken de volle breedte.
 */
export function HourTimeline({ window: w, timeline }: { window: HourWindow; timeline: Timeline }) {
  const hours = (w.end - w.start) / 60;
  const y = (min: number) => ((Math.max(w.start, Math.min(w.end, min)) - w.start) / 60) * HOUR_PX;
  const tight = timeline.freeMin !== null && timeline.plannedMin > timeline.freeMin;
  const split = w.events.length > 0 && w.blocks.length > 0;
  const blockLane = split ? "left-14 right-[calc(50%-6px)]" : "left-14 right-1";
  const eventLane = split ? "left-[calc(50%+2px)] right-1" : "left-14 right-1";

  return (
    <Panel id="tijdlijn" title="Komende 8 uur" aside={<Link href="/planning" className="hover:text-nacht">{timeline.rhythmName ? `${timeline.rhythmName} · planning` : "Planning"}</Link>}>
      <div className="grid grid-cols-3 divide-x divide-lijn border-b border-lijn text-center">
        <div className="px-2 py-2.5">
          <p className="glow hud-mono text-lg font-bold tabular-nums text-nacht">{timeline.dayOver ? "–" : formatDuration(timeline.freeMin)}</p>
          <p className="text-[10px] uppercase tracking-[0.12em] text-steen">{timeline.work ? "nog vrij" : "geen werkdag"}</p>
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
      {tight && timeline.work && <p className="border-b border-lijn px-4 py-2 text-xs font-bold text-nacht">Meer ingepland dan er tijd is tot {timeline.work.end}</p>}

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
          {w.work && w.work.to > w.start && w.work.from < w.end && (
            <div aria-hidden className="absolute left-12 right-0 bg-parel" style={{ top: y(w.work.from), height: y(w.work.to) - y(w.work.from) }} />
          )}
          {/* uurlijnen */}
          {Array.from({ length: hours + 1 }, (_, i) => (
            <div key={i} className="absolute left-0 right-0 flex items-start" style={{ top: i * HOUR_PX }}>
              <span className="hud-mono w-10 -translate-y-1/2 text-right text-[11px] tabular-nums text-steen">{hhmm(w.start + i * 60)}</span>
              <span className="ml-2 h-px flex-1 bg-lijn" />
            </div>
          ))}
          {/* dagritmeblokken: gestippelde rand, taken erin */}
          {w.blocks.map((b) => {
            const top = y(b.from);
            const height = Math.max(18, y(b.to) - top - 2);
            return (
              <Link
                key={`${b.id}-${b.from}`}
                href="/planning"
                className={`absolute ${blockLane} overflow-hidden rounded-[2px] border border-dashed px-2 py-0.5 transition-colors hover:border-nacht ${b.current ? "border-nacht bg-vlak" : "border-steen/60 bg-vlak/60"} ${b.past ? "opacity-45" : ""}`}
                style={{ top: top + 1, height }}
                title={`${b.title} · ${b.label}${b.tasks.length ? ` · ${b.tasks.join(", ")}` : ""}`}
              >
                <p className={`truncate text-[12px] leading-tight ${b.current ? "font-bold text-nacht" : "text-grafiet"}`}>
                  {b.title}
                  {b.tasks.length > 0 && <span className="text-steen"> · {b.tasks.length}</span>}
                </p>
                {height > 34 && b.tasks.length > 0 && <p className="truncate text-[11px] text-steen">{b.tasks.slice(0, 2).join(", ")}</p>}
              </Link>
            );
          })}
          {/* agenda */}
          {w.events.map((e, i) => {
            const top = y(e.from);
            const height = Math.max(22, y(e.to) - top - 2);
            return (
              <div
                key={i}
                className={`absolute ${eventLane} overflow-hidden rounded-[2px] border-l-[3px] bg-vlak px-2.5 py-1 shadow-sm ${e.current ? "border-nacht" : "border-steen"} ${e.past ? "opacity-45" : ""}`}
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
            Nog geen agenda gekoppeld. <Link href="/instellingen#agenda" className="underline decoration-lijn underline-offset-2 hover:decoration-nacht">Agenda toevoegen</Link>.
          </p>
        )}
        {timeline.errors.map((err) => (
          <p key={err} className="mt-2 text-xs text-steen">{err}</p>
        ))}
        {!timeline.rhythmName && (
          <p className="mt-3 text-[11px] text-steen">
            Vandaag geen dagritme. <Link href="/planning/dagritme" className="underline decoration-lijn underline-offset-2 hover:decoration-nacht">Dagritmes instellen</Link>
          </p>
        )}
      </div>
    </Panel>
  );
}

/* ---------------- Plekken voor later ---------------- */

/** Gewoontes van vandaag om af te vinken, met reeks en percentage van deze week. */
export function HabitsPanel({ habits, date }: { habits: HabitToday[]; date: string }) {
  const done = habits.filter((h) => h.done).length;
  return (
    <Panel id="gewoontes" title="Gewoontes" aside={<Link href="/planning/gewoontes" className="hover:text-nacht">{habits.length ? `${done} van ${habits.length}` : "instellen"}</Link>}>
      {habits.length ? (
        <HabitCheckList habits={habits} date={date} />
      ) : (
        <p className="px-4 py-4 text-sm text-steen">
          Nog geen gewoontes voor vandaag. <Link href="/planning/gewoontes" className="underline decoration-lijn underline-offset-2 hover:decoration-nacht">Gewoonte toevoegen</Link>
        </p>
      )}
    </Panel>
  );
}
