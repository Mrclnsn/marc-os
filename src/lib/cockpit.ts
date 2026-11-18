import "server-only";
import { calendarConfigured, getEvents, type CalendarEvent } from "./calendar";
import { blockTaskTitles, currentAndNext, dayRhythms, freeWithin, type DayRhythm } from "./rhythm";
import { habitSummary, listHabits } from "./habits";
import { healthSnapshot } from "./health";
import { goalBar } from "./goals";
import { GOAL_STATUS, type GoalStatus } from "./goals-shared";
import { fmtSleep } from "./health-shared";
import { fmtMin, toMin } from "./rhythm-shared";
import {
  completedBetween,
  expiringDomains,
  filingSignals,
  hourlyBudgets,
  inboxCount,
  listReviews,
  listTasks,
  pipelineSignals,
  revenueOverview,
  revenueSignals,
  weekHours,
  type TaskWithRefs,
} from "./data";
import { TIMEZONE, addDaysIso, daysBetween, formatDate, today } from "./dates";
import { formatDuration } from "./duration";
import { formatEuro, formatEuroRound } from "./money";
import { getHiddenKpis, getModules, KPIS, type KpiKey, type Modules } from "./settings";


export type Kpi = { key: KpiKey; value: string | number; label: string; sub?: string; href?: string; alert?: boolean };

export type Signal = {
  group: string;
  title: string;
  detail?: string;
  href: string;
  /** alert = er moet iets gebeuren (te laat, vandaag); info = goed om te weten */
  level: "alert" | "info";
};

export type Timeline = {
  allDay: CalendarEvent[];
  /** Agenda-items met tijd plus de "nu"-markering, op volgorde */
  items: ({ kind: "event"; event: CalendarEvent; past: boolean; current: boolean } | { kind: "now"; time: string })[];
  planned: TaskWithRefs[];
  freeMin: number | null; // nog vrij binnen de werkdag; null als de werkdag voorbij is of er geen werkdag is
  /** Werkdag uit het dagritme van vandaag; null = geen werkdag (bijv. weekend) */
  work: { start: string; end: string } | null;
  rhythmName: string | null;
  plannedMin: number; // som van de inschattingen van de taken voor vandaag
  estimated: number; // aantal taken met een inschatting
  dayOver: boolean;
  calendar: "none" | "ok";
  errors: string[];
};


const nf = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 });

function nowMinutes(): number {
  const parts = new Intl.DateTimeFormat("nl-NL", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

/** Vrije minuten tussen nu (of het begin van de werkdag) en het einde, min de agenda-items daarbinnen. */
function freeMinutes(events: CalendarEvent[], now: number, work: { start: string; end: string } | null): number | null {
  if (!work) return null;
  const start = Math.max(toMin(work.start), now);
  const end = toMin(work.end);
  if (start >= end) return null;
  return freeWithin(start, end, events);
}

function buildTimeline(events: CalendarEvent[], planned: TaskWithRefs[], now: number, configured: boolean, errors: string[], day: DayRhythm): Timeline {
  const timed = events.filter((e) => !e.allDay && e.time);
  const items: Timeline["items"] = [];
  let nowPlaced = false;
  for (const e of timed) {
    const s = toMin(e.time!);
    const end = e.endTime ? toMin(e.endTime) || 24 * 60 : s;
    if (!nowPlaced && s > now) {
      items.push({ kind: "now", time: fmtMin(now) });
      nowPlaced = true;
    }
    items.push({ kind: "event", event: e, past: end <= now, current: s <= now && end > now });
  }
  if (!nowPlaced) items.push({ kind: "now", time: fmtMin(now) });
  const free = freeMinutes(events, now, day.work);
  const withEstimate = planned.filter((t) => t.estimateMin);
  return {
    allDay: events.filter((e) => e.allDay),
    items,
    planned,
    freeMin: free,
    plannedMin: withEstimate.reduce((s, t) => s + (t.estimateMin ?? 0), 0),
    estimated: withEstimate.length,
    dayOver: free === null,
    work: day.work,
    rhythmName: day.rhythm?.name ?? null,
    calendar: configured ? "ok" : "none",
    errors,
  };
}

/** Tijdlijn voor de komende uren met echte tijdas (minuten vanaf middernacht vandaag; morgen = +1440). */
export type HourWindow = {
  start: number;
  end: number;
  now: number;
  events: { title: string; calendar: string; location: string | null; from: number; to: number; label: string; past: boolean; current: boolean }[];
  /** Dagritmeblokken (vandaag en morgen) binnen het venster, met de taken die erin staan */
  blocks: { id: string; title: string; kind: string; from: number; to: number; label: string; past: boolean; current: boolean; tasks: string[] }[];
  /** Werkdag van vandaag als minuten, voor de band op de tijdas */
  work: { from: number; to: number } | null;
};

export type HabitToday = { id: string; title: string; done: boolean; due: boolean; streak: number; streakUnit: string; weekPct: number | null; frequency: string; block: string | null };

export type Goal = {
  id: string | null;
  title: string;
  valueLabel: string;
  targetLabel: string;
  pct: number;
  /** Waar je nu zou moeten staan (streepje op de balk) */
  expectedPct: number | null;
  status: GoalStatus | null;
  statusLabel: string | null;
  note: string;
  provisional: boolean;
  /** Hoe de andere lopende doelen ervoor staan */
  others: { good: number; warn: number; bad: number; total: number } | null;
};

export type Cockpit = {
  date: string;
  nowLabel: string;
  window: HourWindow;
  focus: TaskWithRefs[];
  rest: TaskWithRefs[];
  goal: Goal;
  doneCount: number;
  autoBriefing: string;
  briefingAt: string | null;
  modules: Modules;
  kpis: Kpi[];
  signals: Signal[];
  timeline: Timeline;
  overdue: TaskWithRefs[];
  upcoming: TaskWithRefs[];
  briefing: { body: string } | null;
  habits: HabitToday[];
  rhythm: { name: string | null; current: string | null; next: string | null };
};

/** Wat er bovenaan moet: achterstallig en hoge prioriteit eerst, dan deadline, dan plandatum. */
function byFocus(a: TaskWithRefs, b: TaskWithRefs, t: string) {
  const late = (x: TaskWithRefs) => ((x.planDate ?? x.dueDate)! < t ? 0 : 1);
  return (
    a.priority - b.priority ||
    late(a) - late(b) ||
    (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
    (a.planDate ?? "9999").localeCompare(b.planDate ?? "9999")
  );
}

/** Alles voor het Vandaag-scherm. Onderdelen van uitgeschakelde modules worden niet opgehaald. */
export async function getCockpit(area?: "zakelijk" | "prive"): Promise<Cockpit> {
  const t = today();
  const tomorrow = addDaysIso(t, 1);
  const [modules, hidden] = await Promise.all([getModules(), getHiddenKpis()]);
  const work = area !== "prive"; // zakelijke signalen niet in de privé-weergave
  const none = Promise.resolve(null);
  const configured = await calendarConfigured();

  const [todayTasks, upcoming, inbox, cal, lastDay, doneToday, hours, revenue, money, budgets, pipeline, filings, domains] = await Promise.all([
    listTasks({ view: "today", area }),
    listTasks({ view: "upcoming", days: 7, area }),
    inboxCount(),
    configured ? getEvents(t, tomorrow) : Promise.resolve({ events: [] as CalendarEvent[], errors: [] as string[] }),
    listReviews("day", 1),
    completedBetween(t, t),
    modules.uren ? weekHours(t) : none,
    modules.afspraken && work ? revenueOverview(1) : none,
    modules.afspraken && work ? revenueSignals() : none,
    modules.uren && modules.afspraken && work ? hourlyBudgets({ onlyWarnings: true }) : none,
    modules.pipeline && work ? pipelineSignals() : none,
    modules.aangiftes && work ? filingSignals() : none,
    modules.websites && work ? expiringDomains() : none,
  ]);
  const [rhythmsByDay, habitList, blockTitles, blockTitlesTomorrow, health, goals] = await Promise.all([
    dayRhythms([t, tomorrow]),
    listHabits(),
    blockTaskTitles(t),
    blockTaskTitles(tomorrow),
    area === "zakelijk" ? Promise.resolve(null) : healthSnapshot(t),
    goalBar().catch(() => null),
  ]);
  const dayToday = rhythmsByDay.get(t)!;
  const dayTomorrow = rhythmsByDay.get(tomorrow)!;

  const overdue = todayTasks.filter((x) => (x.planDate ?? x.dueDate)! < t);
  const planned = todayTasks.filter((x) => (x.planDate ?? x.dueDate)! >= t);
  const now = nowMinutes();
  const eventsToday = cal.events.filter((e) => e.date === t);
  const timeline = buildTimeline(eventsToday, planned, now, configured, cal.errors, dayToday);
  const { current: blockNow, next: blockNext } = currentAndNext(dayToday.blocks, now);
  const habitSum = habitSummary(habitList);
  const visibleHabits = habitList.filter((h) => (!area || h.area === area) && (h.dueToday || h.doneToday));
  const doneCount = doneToday.filter((x) => !area || x.area === area).length;

  /* ---------------- KPI-tegels ---------------- */

  const nextEvent = timeline.items.find((i) => i.kind === "event" && !i.past && !i.current);
  const currentEvent = timeline.items.find((i) => i.kind === "event" && i.current);
  const filingAlerts = filings ? filings.overdue.length + filings.dueSoon.length : 0;
  const all: Record<KpiKey, Kpi | null> = {
    vandaag: { key: "vandaag", value: planned.length, label: KPIS.vandaag.label, sub: doneCount ? `${doneCount} afgerond` : "nog niets afgerond", href: "#vandaag" },
    achterstallig: { key: "achterstallig", value: overdue.length, label: KPIS.achterstallig.label, sub: overdue.length ? "inplannen of afronden" : "alles bij", href: overdue.length ? "#achterstallig" : undefined, alert: overdue.length > 0 },
    inbox: { key: "inbox", value: inbox, label: KPIS.inbox.label, sub: inbox ? "te verwerken" : "leeg", href: "/inbox" },
    agenda: {
      key: "agenda",
      value: configured ? eventsToday.length : "–",
      label: KPIS.agenda.label,
      sub: !configured
        ? "niet gekoppeld"
        : currentEvent && currentEvent.kind === "event"
          ? `nu: ${currentEvent.event.title}`
          : nextEvent && nextEvent.kind === "event"
            ? `${nextEvent.event.time} ${nextEvent.event.title}`
            : "geen afspraken meer",
      href: "#tijdlijn",
    },
    gewoontes: habitSum.total
      ? { key: "gewoontes", value: `${habitSum.done}/${habitSum.total}`, label: KPIS.gewoontes.label, sub: habitSum.weekPct !== null ? `${habitSum.weekPct}% deze week` : "vandaag", href: "#gewoontes", alert: false }
      : null,
    sport:
      health && (health.configured || health.week.workouts)
        ? {
            key: "sport",
            value: `${health.week.sessions}/${health.week.goal}`,
            label: KPIS.sport.label,
            sub: health.today.workouts.length ? `vandaag: ${health.today.workouts.map((w) => w.name).join(", ")}` : health.week.sessions >= health.week.goal ? "weekdoel gehaald" : `nog ${health.week.goal - health.week.sessions} te gaan`,
            href: "/gezondheid",
          }
        : null,
    stappen:
      health?.configured
        ? {
            key: "stappen",
            value: health.today.values.steps != null ? nf.format(health.today.values.steps) : "–",
            label: KPIS.stappen.label,
            sub: health.yesterday.values.steps != null ? `gisteren ${nf.format(health.yesterday.values.steps)}` : "nog niets binnen",
            href: "/gezondheid",
          }
        : null,
    doelen:
      goals && goals.counts.total
        ? {
            key: "doelen",
            value: `${goals.counts.good}/${goals.counts.total}`,
            label: KPIS.doelen.label,
            sub: goals.counts.bad ? `${goals.counts.bad} met risico` : goals.counts.warn ? `${goals.counts.warn} achter` : "alles op schema",
            href: "/doelen",
            alert: goals.counts.bad > 0,
          }
        : null,
    uren: hours ? { key: "uren", value: formatDuration(hours.totalMin), label: KPIS.uren.label, sub: `${formatDuration(hours.billableMin)} declarabel`, href: "/uren" } : null,
    mrr: revenue ? { key: "mrr", value: formatEuroRound(revenue.mrrCents), label: KPIS.mrr.label, sub: `${revenue.activeRecurring} vaste afspraken`, href: "/afspraken" } : null,
    factureren: revenue ? { key: "factureren", value: revenue.ready.count, label: KPIS.factureren.label, sub: formatEuroRound(revenue.ready.cents), href: "/afspraken", alert: revenue.ready.count > 0 } : null,
    offertes: pipeline ? { key: "offertes", value: pipeline.openQuotes.count, label: KPIS.offertes.label, sub: formatEuroRound(pipeline.openQuotes.cents), href: "/pipeline" } : null,
    aangiftes: filings ? { key: "aangiftes", value: filingAlerts, label: KPIS.aangiftes.label, sub: filings.overdue.length ? `${filings.overdue.length} te laat` : `${filings.docsMissing.length} stukken ontbreken`, href: "/aangiftes", alert: filings.overdue.length > 0 } : null,
  };
  const kpis = (Object.keys(all) as KpiKey[]).filter((k) => all[k] && !hidden.includes(k)).map((k) => all[k]!);

  /* ---------------- Signalen ---------------- */

  const signals: Signal[] = [];
  if (overdue.length) {
    signals.push({ group: "Taken", title: `${overdue.length} ${overdue.length === 1 ? "taak" : "taken"} achterstallig`, detail: overdue.slice(0, 3).map((x) => x.title).join(", ") + (overdue.length > 3 ? ", ..." : ""), href: "#achterstallig", level: "alert" });
  }
  for (const task of [...todayTasks, ...upcoming].filter((x, i, arr) => x.dueDate && x.dueDate <= tomorrow && arr.findIndex((y) => y.id === x.id) === i)) {
    const d = task.dueDate!;
    signals.push({
      group: "Deadline",
      title: task.title,
      detail: d < t ? `deadline was ${formatDate(d)}` : d === t ? "deadline vandaag" : "deadline morgen",
      href: `/taken/${task.id}`,
      level: d <= t ? "alert" : "info",
    });
  }
  for (const err of cal.errors) signals.push({ group: "Agenda", title: "Agenda niet geladen", detail: err, href: "/instellingen", level: "info" });
  if (health?.stale) signals.push({ group: "Gezondheid", title: "Geen gegevens uit Apple Health", detail: `laatst ontvangen ${formatDate(new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(health.lastReceived!))}; draait Health Auto Export nog?`, href: "/instellingen#apple-health", level: "info" });
  const risky = (goals?.atRisk ?? []).filter((g) => !area || (area === "zakelijk") === (g.area === "zakelijk"));
  if (risky.length > 3) signals.push({ group: "Doel", title: `${risky.length} doelen op risico`, detail: risky.map((g) => g.title).join(", "), href: "/doelen", level: "info" });
  else for (const g of risky) {
    signals.push({ group: "Doel", title: g.title, detail: `${GOAL_STATUS[g.eval.status].toLowerCase()}: ${g.eval.valueLabel} tegenover ${g.eval.targetLabel}${g.eval.needed ? ` · nodig: ${g.eval.needed}` : ""}`, href: `/doelen/${g.id}`, level: "info" });
  }
  if (inbox >= 10) signals.push({ group: "Inbox", title: `${inbox} items in je inbox`, detail: "tijd om te verwerken", href: "/inbox", level: "info" });

  if (filings) {
    for (const f of [...filings.overdue, ...filings.dueSoon]) {
      signals.push({ group: "Aangifte", title: `${f.clientName} · ${f.title}`, detail: f.state === "overdue" ? `te laat, deadline ${formatDate(f.deadline)}` : `deadline ${formatDate(f.deadline)}`, href: `/aangiftes/${f.id}`, level: f.state === "overdue" ? "alert" : "info" });
    }
    for (const f of filings.docsMissing.filter((x) => x.state !== "overdue" && x.state !== "due_soon")) {
      signals.push({ group: "Aangifte", title: `${f.clientName} · ${f.title}`, detail: `stukken ${f.docsRequestedAt ? "opgevraagd, nog niet binnen" : "nog niet opgevraagd"} (uiterlijk ${formatDate(f.docsDueDate)})`, href: `/aangiftes/${f.id}`, level: "info" });
    }
  }
  if (pipeline) {
    for (const l of pipeline.nextSteps) {
      signals.push({ group: "Pipeline", title: l.clientName ?? l.companyName, detail: `${l.nextStep ?? l.title}${l.nextStepDate && l.nextStepDate < t ? ` · sinds ${formatDate(l.nextStepDate)}` : ""}`, href: `/pipeline/${l.id}`, level: l.nextStepDate && l.nextStepDate < t ? "alert" : "info" });
    }
    for (const q of pipeline.expiringQuotes) {
      signals.push({ group: "Offerte", title: `${q.companyName} · ${q.number}`, detail: `geldig tot ${formatDate(q.validUntil)}`, href: `/pipeline/offertes/${q.id}`, level: "info" });
    }
  }
  if (money) {
    for (const i of money.ready) signals.push({ group: "Factureren", title: `${i.clientName} · ${formatEuro(i.amountCents)}`, detail: i.description, href: `/klanten/${i.clientId}`, level: "info" });
    for (const a of money.ending) signals.push({ group: "Afspraak", title: a.label, detail: `${a.clientName} · loopt af ${formatDate(a.endDate)}`, href: `/klanten/${a.clientId}`, level: "info" });
  }
  if (budgets) {
    for (const b of budgets) signals.push({ group: "Budget", title: `${b.clientName} · ${b.pct}%`, detail: `${b.label} · ${b.over ? "budget overschreden" : "meer dan 80% besteed"}`, href: `/klanten/${b.clientId}`, level: b.over ? "alert" : "info" });
  }
  if (domains) {
    for (const { website, clientName } of domains) {
      const days = website.domainExpiresAt ? daysBetween(t, website.domainExpiresAt) : 0;
      signals.push({ group: "Domein", title: website.domain, detail: `${clientName} · ${days < 0 ? `verlopen ${formatDate(website.domainExpiresAt)}` : `verloopt ${formatDate(website.domainExpiresAt)}`}`, href: `/klanten/${website.clientId}`, level: days <= 7 ? "alert" : "info" });
    }
  }
  // Eerst wat aandacht vraagt, de volgorde binnen een niveau blijft staan
  signals.sort((a, b) => (a.level === b.level ? 0 : a.level === "alert" ? -1 : 1));

  const today_ = lastDay[0]?.periodDate === t ? lastDay[0] : null;
  const briefing = today_ ? { body: today_.body } : null;
  const clock = new Intl.DateTimeFormat("nl-NL", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit" });

  /* ---------------- Tijdlijn komende 8 uur ---------------- */

  const winStart = Math.floor(now / 60) * 60 - 60;
  const winEnd = winStart + 9 * 60;
  const window: HourWindow = {
    start: winStart,
    end: winEnd,
    now,
    events: cal.events
      .filter((e) => !e.allDay && e.time && (e.date === t || e.date === tomorrow))
      .map((e) => {
        const shift = e.date === tomorrow ? 1440 : 0;
        const from = toMin(e.time!) + shift;
        let to = (e.endTime ? toMin(e.endTime) : toMin(e.time!) + 30) + shift;
        if (to <= from) to += 1440; // loopt over middernacht
        return { title: e.title, calendar: e.calendar, location: e.location, from, to, label: `${e.time} tot ${e.endTime}`, past: to <= now, current: from <= now && to > now };
      })
      .filter((e) => e.to > winStart && e.from < winEnd),
    blocks: [
      ...dayToday.blocks.map((b) => ({ b, shift: 0, titles: blockTitles })),
      ...dayTomorrow.blocks.map((b) => ({ b, shift: 1440, titles: blockTitlesTomorrow })),
    ]
      .map(({ b, shift, titles }) => {
        const from = toMin(b.startTime) + shift;
        const to = toMin(b.endTime) + shift;
        return { id: b.id, title: b.title, kind: b.kind, from, to, label: `${b.startTime} tot ${b.endTime}`, past: to <= now, current: from <= now && to > now, tasks: titles.get(b.id) ?? [] };
      })
      .filter((b) => b.to > winStart && b.from < winEnd),
    work: dayToday.work ? { from: toMin(dayToday.work.start), to: toMin(dayToday.work.end) } : null,
  };

  /* ---------------- Focus ---------------- */

  const open = [...overdue, ...planned].sort((a, b) => byFocus(a, b, t));
  const focus = open.slice(0, 3);
  const rest = open.slice(3);

  /* ---------------- Doelbalk ---------------- */

  // Hoofddoel (gesprek 10); zonder doelen: de dag zelf als voorlopig doel
  const main = goals?.goal ?? null;
  const tasksTarget = doneCount + open.length;
  const goal: Goal = main
    ? {
        id: main.id,
        title: main.title,
        valueLabel: main.eval.valueLabel,
        targetLabel: main.eval.targetLabel,
        pct: main.eval.pct ?? 0,
        expectedPct: main.eval.expectedPct,
        status: main.eval.status,
        statusLabel: GOAL_STATUS[main.eval.status],
        note: `${main.eval.summary}${main.eval.needed ? ` Nodig: ${main.eval.needed}.` : ""}`,
        provisional: false,
        others: goals && goals.counts.total > 1 ? goals.counts : null,
      }
    : {
        id: null,
        title: "Taken van vandaag afgerond",
        valueLabel: String(doneCount),
        targetLabel: String(tasksTarget),
        pct: tasksTarget > 0 ? Math.round((doneCount / tasksTarget) * 100) : 0,
        expectedPct: null,
        status: null,
        statusLabel: null,
        note: "Voorlopig doel. Stel een hoofddoel in op Doelen (bijv. omzet, MRR of 4x per week sporten).",
        provisional: true,
        others: null,
      };

  /* ---------------- Briefing zonder Hermes ---------------- */

  const parts: string[] = [];
  const next = timeline.items.find((i) => i.kind === "event" && !i.past && !i.current);
  const cur = timeline.items.find((i) => i.kind === "event" && i.current);
  parts.push(
    open.length
      ? `Je hebt vandaag ${planned.length} ${planned.length === 1 ? "taak" : "taken"} gepland${overdue.length ? ` en ${overdue.length} achterstallig` : ""}.`
      : "Er staat vandaag niets meer open.",
  );
  if (focus[0]) parts.push(`Begin met: ${focus[0].title}.`);
  if (blockNow) {
    const inIt = blockTitles.get(blockNow.id) ?? [];
    parts.push(`Nu in je dagritme: ${blockNow.title} tot ${blockNow.endTime}${inIt.length ? ` (${inIt.slice(0, 2).join(", ")})` : ""}.`);
  } else if (blockNext) parts.push(`Volgende blok: ${blockNext.startTime} ${blockNext.title}.`);
  else if (!dayToday.rhythm) parts.push("Vandaag staat er geen dagritme.");
  if (cur && cur.kind === "event") parts.push(`Nu bezig: ${cur.event.title} (tot ${cur.event.endTime}).`);
  else if (next && next.kind === "event") parts.push(`Volgende afspraak: ${next.event.time} ${next.event.title}.`);
  if (timeline.freeMin !== null && timeline.work) parts.push(`Nog ${formatDuration(timeline.freeMin)} vrij tot ${timeline.work.end}${timeline.plannedMin > timeline.freeMin ? ", minder dan je hebt ingeschat" : ""}.`);
  const alerts = signals.filter((x) => x.level === "alert").length;
  if (alerts) parts.push(`${alerts} ${alerts === 1 ? "signaal vraagt" : "signalen vragen"} aandacht.`);
  if (inbox) parts.push(`${inbox} in je inbox.`);
  if (main && main.eval.status !== "inactive") parts.push(`Hoofddoel ${main.title}: ${GOAL_STATUS[main.eval.status].toLowerCase()} (${main.eval.valueLabel}, doel ${main.eval.targetLabel}).`);
  if (goals?.counts.bad) parts.push(`${goals.counts.bad} ${goals.counts.bad === 1 ? "doel staat" : "doelen staan"} op risico.`);
  if (habitSum.open.length) parts.push(`Gewoontes nog te doen: ${habitSum.open.map((h) => h.title).join(", ")}.`);
  if (health && (health.configured || health.week.workouts)) {
    const w = health.week;
    const sleep = health.today.sleep?.totalMin;
    parts.push(`Sport deze week: ${w.sessions} van ${w.goal}${w.sessions >= w.goal ? ", doel gehaald" : ""}.${sleep ? ` Vannacht ${fmtSleep(sleep)} geslapen.` : ""}`);
  }

  return {
    date: t,
    nowLabel: clock.format(new Date()),
    window,
    focus,
    rest,
    goal,
    doneCount,
    autoBriefing: parts.join(" "),
    briefingAt: today_ ? clock.format(today_.createdAt) : null,
    modules,
    kpis,
    signals,
    timeline,
    overdue,
    upcoming,
    briefing,
    habits: visibleHabits.map((h) => ({ id: h.id, title: h.title, done: h.doneToday, due: h.dueToday, streak: h.streak, streakUnit: h.streakUnit, weekPct: h.week.pct, frequency: h.frequencyLabel, block: h.blockTitle })),
    rhythm: { name: dayToday.rhythm?.name ?? null, current: blockNow ? `${blockNow.title} tot ${blockNow.endTime}` : null, next: blockNext ? `${blockNext.startTime} ${blockNext.title}` : null },
  };
}
