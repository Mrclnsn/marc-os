import Link from "next/link";
import { getISOWeek, parseISO } from "date-fns";
import { PageHeader } from "@/components/brand";
import { Panel } from "@/components/cockpit";
import { HabitCheckList } from "@/components/habit-parts";
import { DayRhythmSelect, DropZone, PlanTask, type SlotOption } from "@/components/planning-parts";
import { PlanningTabs } from "@/components/planning-nav";
import { setDayRhythmAction } from "@/app/leven-actions";
import { getDayPlan, getWeekPlan, listHabits, listRhythms, type DayPlan, type TaskWithRefs } from "@/lib/data";
import { addDaysIso, formatLong, today, weekStart } from "@/lib/dates";
import { formatDuration } from "@/lib/duration";
import { BLOCK_KINDS, PLANNABLE_KINDS, WEEKDAYS, type BlockKind, type Weekday } from "@/lib/rhythm-shared";

export const dynamic = "force-dynamic";

const isoRe = /^\d{4}-\d{2}-\d{2}$/;
const short = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short" });
const dayShort = (iso: string) => short.format(new Date(`${iso}T12:00:00`));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Planning: dag- en weekweergave met dagritme, agenda en taken in blokken (timeblocking).
 * Op de Mac slepen, op de telefoon "Plan in" kiezen.
 */
export default async function PlanningPage({ searchParams }: { searchParams: Promise<{ weergave?: string; datum?: string }> }) {
  const sp = await searchParams;
  const t = today();
  const date = sp.datum && isoRe.test(sp.datum) ? sp.datum : t;
  return sp.weergave === "week" ? <WeekView date={date} t={t} /> : <DayView date={date} t={t} />;
}

/* ------------------------------------------------------------------ */
/* Dag                                                                 */
/* ------------------------------------------------------------------ */

function daySlots(plan: DayPlan, t: string): SlotOption[] {
  const g = plan.date === t ? "Vandaag" : dayShort(plan.date);
  const slots: SlotOption[] = plan.blocksPlanned
    .filter((b) => PLANNABLE_KINDS.includes(b.kind as BlockKind) && !(plan.isToday && b.past))
    .map((b) => ({ value: `${plan.date}|${b.id}`, label: `${b.startTime} ${b.title}`, group: g }));
  slots.push({ value: `${plan.date}|`, label: "Zonder blok", group: g });
  const next = addDaysIso(plan.date, 1);
  slots.push({ value: `${next}|`, label: next === addDaysIso(t, 1) ? "Morgen" : dayShort(next), group: "Andere dag" });
  slots.push({ value: `${addDaysIso(plan.date, 2)}|`, label: dayShort(addDaysIso(plan.date, 2)), group: "Andere dag" });
  return slots;
}

function slotOf(task: TaskWithRefs): string {
  return task.planDate ? `${task.planDate}|${task.planBlockId ?? ""}` : "";
}

async function DayView({ date, t }: { date: string; t: string }) {
  const [plan, rhythms, habits] = await Promise.all([getDayPlan(date), listRhythms(), date === t ? listHabits() : Promise.resolve([])]);
  const slots = daySlots(plan, t);
  const prev = addDaysIso(date, -1);
  const next = addDaysIso(date, 1);

  type Item = { at: number; kind: "block"; block: DayPlan["blocksPlanned"][number] } | { at: number; kind: "event"; event: DayPlan["events"][number] };
  const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const items: Item[] = [
    ...plan.blocksPlanned.map((b) => ({ at: b.from, kind: "block" as const, block: b })),
    ...plan.events.filter((e) => !e.allDay && e.time).map((e) => ({ at: toMin(e.time!), kind: "event" as const, event: e })),
  ].sort((a, b) => a.at - b.at || (a.kind === "event" ? -1 : 1));
  const allDay = plan.events.filter((e) => e.allDay);
  const todaysHabits = habits.filter((h) => h.dueToday || h.doneToday);
  const habitsByBlock = new Map<string, string[]>();
  for (const h of habits) if (h.blockId && (h.dueToday || h.doneToday)) habitsByBlock.set(h.blockId, [...(habitsByBlock.get(h.blockId) ?? []), `${h.doneToday ? "✓ " : ""}${h.title}`]);

  const rhythmOptions = [
    { value: "default", label: plan.override ? "Standaardritme" : `${plan.rhythm?.name ?? "Geen ritme"} (standaard)` },
    ...rhythms.map((r) => ({ value: r.id, label: r.name })),
    { value: "free", label: "Vrije dag (geen blokken)" },
  ];
  const rhythmValue = plan.override ? (plan.rhythm?.id ?? "free") : "default";
  const over = plan.workMin !== null && plan.plannedMin > plan.workMin;

  return (
    <div className="space-y-5">
      <PageHeader eyebrow={`Planning · week ${getISOWeek(parseISO(date))}`} title={date === t ? `Vandaag, ${formatLong(date)}` : cap(formatLong(date))}>
        <div className="flex items-center gap-1">
          <Link href={`/planning?datum=${prev}`} className="btn-ghost" aria-label="Vorige dag">←</Link>
          {date !== t && <Link href="/planning" className="btn-ghost">Vandaag</Link>}
          <Link href={`/planning?datum=${next}`} className="btn-ghost" aria-label="Volgende dag">→</Link>
        </div>
      </PageHeader>

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <PlanningTabs active="dag" date={date} />
        <DayRhythmSelect action={setDayRhythmAction.bind(null, date)} value={rhythmValue} options={rhythmOptions} />
      </div>

      {/* Samenvatting */}
      <div className="card grid grid-cols-2 divide-lijn text-center sm:grid-cols-4 sm:divide-x">
        <Stat value={plan.rhythm?.name ?? "Geen ritme"} label={plan.work ? `werkdag ${plan.work.start} tot ${plan.work.end}` : "geen werkdag"} />
        <Stat value={plan.workMin !== null ? formatDuration(plan.workMin) : "–"} label="werktijd zonder agenda" />
        <Stat value={formatDuration(plan.plannedMin)} label={over ? "ingeschat, meer dan er tijd is" : "ingeschat"} strong={over} />
        <Stat value={`${plan.done}`} label="afgerond" />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* Dagindeling */}
        <div className="min-w-0 space-y-5">
          <Panel title="Dagindeling" aside={plan.override ? `ander ritme dan standaard${plan.overrideNote ? ` · ${plan.overrideNote}` : ""}` : plan.rhythm ? <Link href="/planning/dagritme" className="hover:text-nacht">ritme aanpassen</Link> : undefined}>
            {allDay.length > 0 && (
              <div className="flex flex-wrap gap-1.5 border-b border-lijn px-4 py-2.5">
                {allDay.map((e, i) => <span key={i} className="chip">Hele dag · {e.title}</span>)}
              </div>
            )}
            {items.length === 0 && (
              <p className="px-4 py-4 text-sm text-steen">
                {plan.rhythm ? "Dit ritme heeft nog geen blokken." : "Geen dagritme voor deze dag."} <Link href="/planning/dagritme" className="underline decoration-lijn underline-offset-2 hover:decoration-nacht">Dagritmes instellen</Link>
              </p>
            )}
            <ol className="divide-y divide-lijn">
              {items.map((it) =>
                it.kind === "event" ? (
                  <li key={`e-${it.event.start}-${it.event.title}`} className="flex gap-3 px-4 py-2.5">
                    <span className="hud-mono w-12 shrink-0 pt-0.5 text-[12px] tabular-nums text-steen">{it.event.time}<br />{it.event.endTime}</span>
                    <span className="min-w-0 flex-1 border-l-[3px] border-steen pl-2.5">
                      <span className="block truncate text-[14px] font-bold text-nacht">{it.event.title}</span>
                      <span className="block truncate text-xs text-steen">Agenda · {it.event.calendar}{it.event.location ? ` · ${it.event.location}` : ""}</span>
                    </span>
                  </li>
                ) : (
                  <li key={`b-${it.block.id}`} className={`relative ${it.block.past ? "opacity-55" : ""}`}>
                    {it.block.current && <span aria-hidden className="accent absolute inset-y-0 left-0 w-[3px] bg-nacht" />}
                    <DropZone date={date} blockId={it.block.id} className="flex gap-3 px-4 py-2.5">
                      <span className="hud-mono w-12 shrink-0 pt-0.5 text-[12px] tabular-nums text-steen">{it.block.startTime}<br />{it.block.endTime}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                          <span className={`text-[14px] ${it.block.current ? "font-bold text-nacht" : "font-bold text-grafiet"}`}>
                            {it.block.title}
                            {it.block.current && <span className="ml-2 text-xs font-normal text-steen">nu</span>}
                            {it.block.remind && <span className="ml-2 text-xs font-normal text-steen">· herinnering</span>}
                          </span>
                          <span className="text-[11px] text-steen">
                            {[
                              (BLOCK_KINDS[it.block.kind as BlockKind] ?? it.block.kind) !== it.block.title ? (BLOCK_KINDS[it.block.kind as BlockKind] ?? it.block.kind) : null,
                              PLANNABLE_KINDS.includes(it.block.kind as BlockKind) ? `${formatDuration(it.block.plannedMin)} van ${formatDuration(it.block.minutes)}` : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </div>
                        {PLANNABLE_KINDS.includes(it.block.kind as BlockKind) && it.block.minutes > 0 && (
                          <div className="mt-1 h-1 overflow-hidden rounded-[1px] bg-parel">
                            <div className="accent h-full bg-nacht" style={{ width: `${Math.min(100, Math.round((it.block.plannedMin / it.block.minutes) * 100))}%` }} />
                          </div>
                        )}
                        {(habitsByBlock.get(it.block.id) ?? []).length > 0 && (
                          <p className="mt-1 text-[11px] text-steen">Gewoonte: {habitsByBlock.get(it.block.id)!.join(", ")}</p>
                        )}
                        {it.block.tasks.length > 0 ? (
                          <div className="mt-2 divide-y divide-lijn border border-lijn">
                            {it.block.tasks.map((task) => <PlanTask key={task.id} task={task} slots={slots} current={slotOf(task)} today={t} />)}
                          </div>
                        ) : (
                          PLANNABLE_KINDS.includes(it.block.kind as BlockKind) &&
                          !it.block.past && <p className="mt-1.5 hidden text-[11px] text-steen md:block">Sleep een taak hierheen</p>
                        )}
                      </div>
                    </DropZone>
                  </li>
                ),
              )}
            </ol>
          </Panel>

          <Panel title="Op deze dag, zonder blok" aside={`${plan.loose.length}`}>
            <DropZone date={date} blockId={null} className="min-h-12">
              {plan.loose.length ? (
                <div className="divide-y divide-lijn">
                  {plan.loose.map((task) => <PlanTask key={task.id} task={task} slots={slots} current={slotOf(task)} today={t} />)}
                </div>
              ) : (
                <p className="px-4 py-3 text-sm text-steen">Alles van deze dag staat in een blok.</p>
              )}
            </DropZone>
          </Panel>
        </div>

        {/* In te plannen */}
        <div className="min-w-0 space-y-5">
          {date === t && todaysHabits.length > 0 && (
            <Panel title="Gewoontes vandaag" aside={<Link href="/planning/gewoontes" className="hover:text-nacht">alle</Link>}>
              <HabitCheckList date={t} habits={todaysHabits.map((h) => ({ id: h.id, title: h.title, done: h.doneToday, due: h.dueToday, streak: h.streak, streakUnit: h.streakUnit, weekPct: h.week.pct, frequency: h.whenLabel, block: h.blockTitle, time: h.time, moment: h.momentKey }))} />
            </Panel>
          )}
          {plan.overdue.length > 0 && <TaskPile title="Achterstallig" tasks={plan.overdue} slots={slots} t={t} />}
          <TaskPile title="Deadline komende 7 dagen" tasks={plan.deadlinesSoon} slots={slots} t={t} empty="Geen deadlines zonder plandatum." />
          <TaskPile title="Zonder plek" tasks={plan.unplaced} slots={slots} t={t} empty="Geen taken zonder datum." />
          {plan.calendarErrors.map((e) => <p key={e} className="text-xs text-steen">{e}</p>)}
        </div>
      </div>
    </div>
  );
}

function Stat({ value, label, strong }: { value: string; label: string; strong?: boolean }) {
  return (
    <div className="px-3 py-3">
      <p className={`hud-mono truncate text-lg font-bold tabular-nums ${strong ? "text-nacht underline decoration-2 underline-offset-4" : "text-nacht"}`}>{value}</p>
      <p className="text-[10px] uppercase tracking-[0.12em] text-steen">{label}</p>
    </div>
  );
}

function TaskPile({ title, tasks, slots, t, empty, showDate = true }: { title: string; tasks: TaskWithRefs[]; slots: SlotOption[]; t: string; empty?: string; showDate?: boolean }) {
  return (
    <Panel title={title} aside={`${tasks.length}`}>
      {tasks.length ? (
        <div className="max-h-[420px] divide-y divide-lijn overflow-y-auto">
          {tasks.map((task) => <PlanTask key={task.id} task={task} slots={slots} current={slotOf(task)} today={t} showDate={showDate} />)}
        </div>
      ) : (
        <p className="px-4 py-3 text-sm text-steen">{empty ?? "Niets hier."}</p>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Week                                                                */
/* ------------------------------------------------------------------ */

async function WeekView({ date, t }: { date: string; t: string }) {
  const monday = weekStart(date);
  const week = await getWeekPlan(monday);
  const slots: SlotOption[] = week.days.map((d) => ({ value: `${d.date}|`, label: `${WEEKDAYS[d.weekday as Weekday]} ${dayShort(d.date)}`, group: "Deze week" }));
  const totalPlanned = week.days.reduce((s, d) => s + d.plannedMin, 0);
  const totalWork = week.days.reduce((s, d) => s + (d.workMin ?? 0), 0);

  return (
    <div className="space-y-5">
      <PageHeader eyebrow={`Planning · ${dayShort(monday)} tot ${dayShort(addDaysIso(monday, 6))}`} title={`Week ${getISOWeek(parseISO(monday))}`}>
        <div className="flex items-center gap-1">
          <Link href={`/planning?weergave=week&datum=${addDaysIso(monday, -7)}`} className="btn-ghost" aria-label="Vorige week">←</Link>
          {weekStart(t) !== monday && <Link href="/planning?weergave=week" className="btn-ghost">Deze week</Link>}
          <Link href={`/planning?weergave=week&datum=${addDaysIso(monday, 7)}`} className="btn-ghost" aria-label="Volgende week">→</Link>
        </div>
      </PageHeader>

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <PlanningTabs active="week" date={date} />
        <p className="text-sm text-steen">
          {formatDuration(totalPlanned)} ingeschat · {formatDuration(totalWork)} werktijd zonder agenda
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
        {week.days.map((d) => (
          <DropZone key={d.date} date={d.date} blockId={null} className={`card relative flex min-w-0 flex-col ${d.isToday ? "border-nacht" : ""}`}>
            {d.isToday && <span aria-hidden className="accent absolute left-0 top-0 h-[3px] w-full bg-nacht" />}
            <Link href={`/planning?datum=${d.date}`} className="block border-b border-lijn px-3 pb-2 pt-3 hover:bg-parel">
              <p className="hud-mono text-[11px] uppercase tracking-[0.14em] text-steen">{WEEKDAYS[d.weekday as Weekday]} {dayShort(d.date)}</p>
              <p className="truncate text-[14px] font-bold text-nacht">{d.rhythm?.name ?? "Geen ritme"}{d.override ? " *" : ""}</p>
              <p className={`text-[11px] ${d.workMin !== null && d.plannedMin > d.workMin ? "font-bold text-nacht" : "text-steen"}`}>
                {formatDuration(d.plannedMin)} ingeschat{d.workMin !== null ? ` / ${formatDuration(d.workMin)}` : ""}
              </p>
            </Link>
            <div className="flex-1 space-y-2 px-2 py-2">
              {d.events.map((e, i) => (
                <p key={i} className="truncate border-l-[3px] border-steen pl-2 text-[12px] text-grafiet" title={`${e.title} · ${e.calendar}`}>
                  <span className="hud-mono text-steen">{e.allDay ? "dag" : e.time}</span> {e.title}
                </p>
              ))}
              {d.blocksPlanned
                .filter((b) => b.tasks.length > 0)
                .map((b) => (
                  <div key={b.id}>
                    <p className="truncate text-[11px] uppercase tracking-[0.1em] text-steen">{b.startTime} {b.title}</p>
                    <div className="mt-1 divide-y divide-lijn border border-dashed border-steen/60">
                      {b.tasks.map((task) => <PlanTask key={task.id} task={task} slots={slots} current={slotOf(task)} today={t} compact />)}
                    </div>
                  </div>
                ))}
              {d.loose.length > 0 && (
                <div className="divide-y divide-lijn border border-lijn">
                  {d.loose.map((task) => <PlanTask key={task.id} task={task} slots={slots} current={slotOf(task)} today={t} compact />)}
                </div>
              )}
              {!d.events.length && !d.loose.length && !d.blocksPlanned.some((b) => b.tasks.length) && <p className="px-1 text-[12px] text-steen">Nog niets gepland</p>}
            </div>
          </DropZone>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <TaskPile title="Taken zonder plek" tasks={week.unplaced} slots={slots} t={t} empty="Alle taken hebben een datum." showDate={false} />
        {week.overdue.length > 0 && <TaskPile title="Achterstallig" tasks={week.overdue} slots={slots} t={t} />}
      </div>
      <p className="text-xs text-steen">Sleep een taak naar een dag, of kies &quot;Plan in&quot;. In de dagweergave zet je hem in een blok. * = ander ritme dan standaard.</p>
      {week.calendarErrors.map((e) => <p key={e} className="text-xs text-steen">{e}</p>)}
    </div>
  );
}
