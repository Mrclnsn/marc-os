/**
 * Doelen (gesprek 10): beschrijvingen, perioden, notatie en de on-track-berekening.
 * Zonder database, dus ook in de browser te gebruiken (formulieren) en goed te testen.
 */
import type { ModuleKey } from "./modules";

export const GOAL_AREAS = { zakelijk: "Zakelijk", prive: "Privé", gezondheid: "Gezondheid", leren: "Leren" } as const;
export type GoalArea = keyof typeof GOAL_AREAS;

export const GOAL_PERIODS = { year: "Jaar", quarter: "Kwartaal", month: "Maand", custom: "Eigen periode" } as const;
export type GoalPeriod = keyof typeof GOAL_PERIODS;

export const GOAL_MEASURES = {
  auto: "Automatisch uit de app",
  health: "Automatisch uit gezondheid",
  habit: "Gewoonte",
  manual: "Handmatig getal",
  milestones: "Mijlpalen",
  subgoals: "Subdoelen",
} as const;
export type GoalMeasure = keyof typeof GOAL_MEASURES;

export const GOAL_CURVES = {
  linear: "Gelijkmatig",
  late: "Rustige start (meeste groei later)",
  early: "Snelle start",
} as const;
export type GoalCurve = keyof typeof GOAL_CURVES;

export const GOAL_PER = { day: "per dag", week: "per week", month: "per maand" } as const;
export type GoalPer = keyof typeof GOAL_PER;
const PER_DAYS: Record<GoalPer, number> = { day: 1, week: 7, month: 365.25 / 12 };

/** Hoe een bron telt: stand (level), optellen in de periode (sum) of gemiddelde (avg). */
export type GoalAgg = "level" | "sum" | "avg";
/** Notatie: euro, euro per uur, uren, kilo, procent of een getal (met `noun`). */
export type GoalUnit = "eur" | "eur_h" | "hours" | "kg" | "pct" | "num";

export type GoalSourceDef = {
  label: string;
  measure: "auto" | "health";
  agg: GoalAgg;
  unit: GoalUnit;
  noun?: string;
  /** Werkt pas als deze modules aan staan */
  modules?: ModuleKey[];
  /** Bij optellen: standaard per week/maand of over de hele periode (null) */
  defaultPer?: GoalPer | null;
  hint: string;
};

export const GOAL_SOURCES = {
  mrr: { label: "MRR (vaste maandomzet)", measure: "auto", agg: "level", unit: "eur", modules: ["afspraken"], hint: "Som van de lopende vaste afspraken per maand." },
  revenue: { label: "Omzet", measure: "auto", agg: "sum", unit: "eur", modules: ["afspraken"], defaultPer: "month", hint: "Vaste afspraken naar rato, eenmalig werk (klaar of gefactureerd) en declarabele uren, zoals bij het effectief uurtarief." },
  billable_hours: { label: "Declarabele uren", measure: "auto", agg: "sum", unit: "hours", modules: ["uren"], defaultPer: null, hint: "Geschreven uren met vinkje declarabel." },
  effective_rate: { label: "Effectief uurtarief", measure: "auto", agg: "avg", unit: "eur_h", modules: ["uren", "afspraken"], hint: "Omzet gedeeld door alle zakelijke uren in de periode (tot nu toe)." },
  quotes_won: { label: "Offertes gewonnen", measure: "auto", agg: "sum", unit: "num", noun: "offertes", modules: ["pipeline"], defaultPer: null, hint: "Offertes met akkoord in de periode." },
  active_clients: { label: "Actieve klanten", measure: "auto", agg: "level", unit: "num", noun: "klanten", hint: "Klanten met status actief." },
  tasks_done: { label: "Taken afgerond", measure: "auto", agg: "sum", unit: "num", noun: "taken", defaultPer: "week", hint: "Afgeronde taken, zakelijk en privé." },
  learning_hours: { label: "Uren leren", measure: "auto", agg: "sum", unit: "hours", defaultPer: "week", hint: "Tijd vastgelegd bij leeronderwerpen (alle, of één onderwerp)." },
  health_sessions: { label: "Sportsessies", measure: "health", agg: "sum", unit: "num", noun: "sessies", defaultPer: "week", hint: "Trainingen van minstens 10 minuten, geen wandeling (zoals op Gezondheid)." },
  health_steps: { label: "Stappen per dag", measure: "health", agg: "avg", unit: "num", noun: "stappen", hint: "Gemiddeld over afgelopen dagen met gegevens." },
  health_exercise: { label: "Beweegminuten per dag", measure: "health", agg: "avg", unit: "num", noun: "min", hint: "Gemiddeld over afgelopen dagen met gegevens." },
  health_sleep: { label: "Slaap per nacht", measure: "health", agg: "avg", unit: "hours", hint: "Gemiddeld over de nachten met gegevens." },
  weight: { label: "Gewicht", measure: "health", agg: "level", unit: "kg", hint: "Laatste weging uit Apple Health." },
} satisfies Record<string, GoalSourceDef>;
export type GoalSource = keyof typeof GOAL_SOURCES;
export const isGoalSource = (s: string | null | undefined): s is GoalSource => !!s && s in GOAL_SOURCES;
export const sourceDef = (s: string | null | undefined): GoalSourceDef | null => (isGoalSource(s) ? GOAL_SOURCES[s] : null);

/* ---------------- Datums en perioden ---------------- */

const dayMs = 86_400_000;
const parse = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
export const daysDiff = (from: string, to: string) => Math.round((parse(to) - parse(from)) / dayMs);
const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m: 1-12

/** Begin en einde van het jaar, kwartaal of de maand rond `ref`. */
export function periodBounds(kind: Exclude<GoalPeriod, "custom">, ref: string): { start: string; end: string } {
  const y = +ref.slice(0, 4);
  const m = +ref.slice(5, 7);
  if (kind === "year") return { start: `${y}-01-01`, end: `${y}-12-31` };
  if (kind === "month") return { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${lastDay(y, m)}` };
  const q0 = Math.floor((m - 1) / 3) * 3 + 1;
  return { start: `${y}-${pad(q0)}-01`, end: `${y}-${pad(q0 + 2)}-${lastDay(y, q0 + 2)}` };
}

const monthName = new Intl.DateTimeFormat("nl-NL", { month: "long", year: "numeric", timeZone: "UTC" });
const shortDate = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", timeZone: "UTC" });
const shortDateY = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function periodLabel(g: { periodKind: string; startDate: string; endDate: string }): string {
  const d = (iso: string) => new Date(parse(iso));
  if (g.periodKind === "year") return g.startDate.slice(0, 4);
  if (g.periodKind === "quarter") return `Q${Math.floor((+g.startDate.slice(5, 7) - 1) / 3) + 1} ${g.startDate.slice(0, 4)}`;
  if (g.periodKind === "month") return monthName.format(d(g.startDate));
  const sameYear = g.startDate.slice(0, 4) === g.endDate.slice(0, 4);
  return `${(sameYear ? shortDate : shortDateY).format(d(g.startDate))} tot ${shortDateY.format(d(g.endDate))}`;
}

/* ---------------- Notatie ---------------- */

const nf0 = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 1 });
const eur0 = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

const SINGULAR: Record<string, string> = { sessies: "sessie", taken: "taak", offertes: "offerte", klanten: "klant", volgers: "volger", stappen: "stap", reviews: "review", mijlpalen: "mijlpaal" };

/** Getal netjes, met eenheid. Kleine getallen met één decimaal. */
export function fmtGoalValue(v: number | null | undefined, unit: GoalUnit | string | null | undefined, noun?: string | null): string {
  if (v == null || !Number.isFinite(v)) return "–";
  const num = (x: number) => (Math.abs(x) < 100 && x % 1 !== 0 ? nf1.format(x) : nf0.format(x));
  switch (unit) {
    case "eur":
      return eur0.format(v);
    case "eur_h":
      return `${eur0.format(v)} per uur`;
    case "hours":
      return `${nf1.format(v)} uur`;
    case "kg":
      return `${nf1.format(v)} kg`;
    case "pct":
      return `${nf0.format(v)}%`;
    case "num":
    case null:
    case undefined:
    case "":
      return noun ? `${num(v)} ${v === 1 ? (SINGULAR[noun] ?? noun) : noun}` : num(v);
    default:
      // handmatig doel: vrije eenheid, bijv. "volgers"
      return `${num(v)} ${unit}`;
  }
}

/* ---------------- On track ---------------- */

export const GOAL_STATUS = {
  upcoming: "Nog niet begonnen",
  ahead: "Voor op schema",
  on_track: "Op schema",
  behind: "Achter",
  at_risk: "Risico",
  achieved: "Gehaald",
  missed: "Niet gehaald",
  inactive: "Module uit",
  no_data: "Nog geen meting",
} as const;
export type GoalStatus = keyof typeof GOAL_STATUS;

/** Wat er gemeten is, per soort meetwijze. */
export type Measured =
  | { kind: "level"; value: number | null; start: number | null }
  | { kind: "sum"; total: number; current?: { label: string; value: number } | null }
  | { kind: "avg"; value: number | null; count?: number }
  | { kind: "fraction"; done: number; total: number; expected?: number | null; noun: string };

export type GoalEval = {
  status: GoalStatus;
  /** Huidige waarde als tekst, en het doel als tekst */
  valueLabel: string;
  targetLabel: string;
  /** Balk: vulling in procenten van het doel (0-100+) en de plek waar je nu zou moeten zijn (null = geen marker) */
  pct: number | null;
  expectedPct: number | null;
  /** Werkelijk tegenover verwacht (1 = precies op schema) */
  ratio: number | null;
  /** Deel van de periode dat voorbij is (0-1) en dagen tot het einde */
  timeFraction: number;
  daysLeft: number;
  /** Uitleg in een of twee zinnen, voor de app en voor Claude/Hermes */
  summary: string;
  /** Wat er nog nodig is om het doel te halen (bijv. "nog € 4.200 per maand"), als dat zinnig is */
  needed: string | null;
};

export type EvalGoal = {
  startDate: string;
  endDate: string;
  targetValue: number | null;
  targetPer: string | null;
  direction: string | null;
  curve: string;
};

function curveAt(curve: string, f: number) {
  if (f <= 0) return 0;
  if (f >= 1) return 1;
  if (curve === "late") return f ** 1.6;
  if (curve === "early") return 1 - (1 - f) ** 1.6;
  return f;
}

function statusOf(ratio: number | null): GoalStatus {
  if (ratio == null) return "on_track";
  if (ratio >= 1.1) return "ahead";
  if (ratio >= 0.95) return "on_track";
  if (ratio >= 0.8) return "behind";
  return "at_risk";
}

const round = (x: number) => Math.round(x * 10) / 10;

/**
 * On-track-status van een doel op dag `t`.
 * Verwacht = waar je nu zou moeten staan: het deel van de periode dat voorbij is (vandaag nog niet), volgens het verloop.
 * - Stand (MRR, gewicht, handmatig): voortgang van startwaarde naar doel tegenover het verwachte deel.
 * - Optellen zonder "per": totaal tegenover doel x verwacht deel.
 * - Optellen met "per week/maand": totaal tegenover doel x verstreken weken/maanden; getoond als gemiddelde.
 * - Gemiddelde (stappen, slaap, uurtarief, gewoonte-percentage): gemiddelde tegenover doel.
 * - Mijlpalen en subdoelen: deel gedaan tegenover verwacht (bij mijlpalen met datum: wat er nu af had moeten zijn).
 * Status: voor op schema vanaf 110%, op schema vanaf 95%, achter vanaf 80%, daaronder risico.
 */
export function evaluateGoal(g: EvalGoal, m: Measured, unit: GoalUnit | string | null, noun: string | null, t: string): GoalEval {
  const totalDays = Math.max(1, daysDiff(g.startDate, g.endDate) + 1);
  const started = t >= g.startDate;
  const ended = t > g.endDate;
  const passed = ended ? totalDays : Math.max(0, Math.min(totalDays, daysDiff(g.startDate, t)));
  const f = passed / totalDays;
  const daysLeft = ended ? 0 : Math.max(0, daysDiff(t, g.endDate));
  const exp = curveAt(g.curve, f);
  const target = g.targetValue;
  const per = g.targetPer && g.targetPer in GOAL_PER ? (g.targetPer as GoalPer) : null;
  const fmt = (v: number | null | undefined) => fmtGoalValue(v, unit, noun);
  const base = { timeFraction: f, daysLeft };

  const targetLabel =
    m.kind === "fraction" ? (m.noun === "subdoelen" ? "100%" : `${m.total} ${m.noun}`) : target == null ? "geen doel" : `${fmt(target)}${per && m.kind === "sum" ? ` ${GOAL_PER[per]}` : ""}`;

  if (!started) {
    return { ...base, status: "upcoming", valueLabel: "–", targetLabel, pct: null, expectedPct: null, ratio: null, summary: `Begint op ${shortDateY.format(new Date(parse(g.startDate)))}.`, needed: null };
  }

  const pctOf = (x: number | null) => (x == null || !Number.isFinite(x) ? null : Math.max(0, Math.round(x * 100)));
  const leftLabel = daysLeft >= 14 ? `${Math.round(daysLeft / 7)} weken` : `${daysLeft} ${daysLeft === 1 ? "dag" : "dagen"}`;

  /* ---- Mijlpalen en subdoelen ---- */
  if (m.kind === "fraction") {
    if (!m.total) return { ...base, status: "no_data", valueLabel: `0 ${m.noun}`, targetLabel, pct: null, expectedPct: null, ratio: null, summary: `Nog geen ${m.noun}.`, needed: null };
    const progress = m.done / m.total;
    const expected = m.expected ?? exp;
    const ratio = expected > 0.02 ? progress / expected : null;
    const status: GoalStatus = progress >= 0.9999 ? "achieved" : ended ? "missed" : statusOf(ratio);
    const doneLabel = m.noun === "subdoelen" ? `${Math.round(progress * 100)}% van de subdoelen` : `${m.done} van ${m.total} ${m.noun}`;
    const expLabel = m.noun === "subdoelen" ? `${Math.round(expected * 100)}%` : nf1.format(round(expected * m.total));
    return {
      ...base,
      status,
      valueLabel: m.noun === "subdoelen" ? `${Math.round(progress * 100)}%` : `${m.done}/${m.total}`,
      targetLabel,
      pct: pctOf(progress),
      expectedPct: ended ? null : pctOf(expected),
      ratio,
      summary: `${doneLabel}${ended ? "" : `; verwacht rond deze tijd ${expLabel}`}.`,
      needed: !ended && progress < 1 ? `nog ${m.noun === "subdoelen" ? `${Math.round((1 - progress) * 100)}%` : `${m.total - m.done} ${m.noun}`} in ${leftLabel}` : null,
    };
  }

  if (target == null) {
    return { ...base, status: "no_data", valueLabel: "–", targetLabel, pct: null, expectedPct: null, ratio: null, summary: "Stel een doelwaarde in.", needed: null };
  }

  /* ---- Stand ---- */
  if (m.kind === "level") {
    if (m.value == null) return { ...base, status: "no_data", valueLabel: "–", targetLabel, pct: null, expectedPct: null, ratio: null, summary: "Nog geen meting.", needed: null };
    const start = m.start ?? m.value;
    const down = g.direction ? g.direction === "down" : target < start;
    const span = target - start;
    const progress = span === 0 ? ((down ? m.value <= target : m.value >= target) ? 1 : 0) : (m.value - start) / span;
    const ratio = exp > 0.02 ? progress / exp : null;
    const reached = progress >= 0.9999;
    const status: GoalStatus = ended ? (reached ? "achieved" : "missed") : reached ? "ahead" : statusOf(ratio);
    const expectedValue = start + span * exp;
    return {
      ...base,
      status,
      valueLabel: fmt(m.value),
      targetLabel,
      pct: pctOf(progress),
      expectedPct: ended ? null : pctOf(exp),
      ratio,
      summary: `Nu ${fmt(m.value)}${m.start != null && m.start !== m.value ? ` (start ${fmt(m.start)})` : ""}, doel ${fmt(target)}.${ended || reached ? "" : ` Verwacht rond deze tijd: ${fmt(expectedValue)}.`}${reached && !ended ? " Doel nu al bereikt." : ""}`,
      needed: !ended && !reached ? `nog ${fmt(Math.abs(target - m.value))} ${down ? "eraf" : "erbij"} in ${leftLabel}` : null,
    };
  }

  /* ---- Gemiddelde ---- */
  if (m.kind === "avg") {
    if (m.value == null) return { ...base, status: "no_data", valueLabel: "–", targetLabel, pct: null, expectedPct: null, ratio: null, summary: "Nog geen gegevens in deze periode.", needed: null };
    const down = g.direction === "down";
    const ratio = down ? (m.value > 0 ? target / m.value : 2) : target > 0 ? m.value / target : null;
    const status: GoalStatus = ended ? ((ratio ?? 0) >= 0.9999 ? "achieved" : "missed") : statusOf(ratio);
    return {
      ...base,
      status,
      valueLabel: fmt(m.value),
      targetLabel,
      pct: pctOf(down ? (m.value > 0 ? target / m.value : 1) : target > 0 ? m.value / target : null),
      expectedPct: null,
      ratio,
      summary: `Gemiddeld ${fmt(m.value)}${m.count != null ? ` (${m.count} ${m.count === 1 ? "dag" : "dagen"})` : ""}, doel ${down ? "hooguit " : ""}${fmt(target)}.`,
      needed: null,
    };
  }

  /* ---- Optellen ---- */
  const down = g.direction === "down";
  const current = m.current ? ` ${m.current.label}: ${fmt(m.current.value)}.` : "";
  if (per) {
    const units = passed / PER_DAYS[per];
    const expectedTotal = target * units;
    const ratio = expectedTotal > 0 ? (down ? (m.total > 0 ? expectedTotal / m.total : 2) : m.total / expectedTotal) : null;
    const avg = units >= 1 ? m.total / units : null;
    const status: GoalStatus = ended ? ((ratio ?? 0) >= 0.9999 ? "achieved" : "missed") : statusOf(ratio);
    const remainingUnits = daysLeft / PER_DAYS[per];
    const periodTotal = target * (totalDays / PER_DAYS[per]);
    const needPer = remainingUnits >= 1 ? (periodTotal - m.total) / remainingUnits : null;
    return {
      ...base,
      status,
      valueLabel: avg != null ? `${fmt(avg)} ${GOAL_PER[per]}` : `${fmt(m.total)} tot nu toe`,
      targetLabel,
      pct: ratio == null ? null : pctOf(down ? 1 / Math.max(ratio, 0.01) : ratio),
      expectedPct: null,
      ratio,
      summary: `${avg != null ? `Gemiddeld ${fmt(avg)} ${GOAL_PER[per]}` : `${fmt(m.total)} tot nu toe`}, doel ${down ? "hooguit " : ""}${fmt(target)} ${GOAL_PER[per]} (totaal ${fmt(m.total)}, verwacht ${fmt(round(expectedTotal))}).${current}`,
      needed: !ended && !down && ratio != null && ratio < 1 && needPer != null && needPer > target * 1.02 ? `${fmt(round(needPer))} ${GOAL_PER[per]} om het gemiddelde nog te halen` : null,
    };
  }
  const progress = target > 0 ? m.total / target : null;
  const ratio = progress != null && exp > 0.02 ? (down ? (progress > 0 ? exp / progress : 2) : progress / exp) : null;
  const reached = !down && progress != null && progress >= 0.9999;
  const status: GoalStatus = ended ? ((down ? m.total <= target : reached) ? "achieved" : "missed") : reached ? "achieved" : statusOf(ratio);
  return {
    ...base,
    status,
    valueLabel: fmt(m.total),
    targetLabel,
    pct: pctOf(progress),
    expectedPct: ended ? null : pctOf(exp),
    ratio,
    summary: `${fmt(m.total)} van ${fmt(target)}${ended || reached ? "" : `; verwacht rond deze tijd ${fmt(round(target * exp))}`}.${current}`,
    needed: !ended && !reached && !down && daysLeft > 0 ? `nog ${fmt(round(target - m.total))} in ${leftLabel}` : null,
  };
}

/** Kort label voor de status met een teken, voor lijsten en meldingen. */
export const STATUS_TONE: Record<GoalStatus, "good" | "neutral" | "warn" | "bad"> = {
  upcoming: "neutral",
  ahead: "good",
  on_track: "good",
  behind: "warn",
  at_risk: "bad",
  achieved: "good",
  missed: "bad",
  inactive: "neutral",
  no_data: "neutral",
};

/* ---------------- Voorbeelden (uit de propositie, G1 en G11) ---------------- */

export type GoalTemplate = {
  key: string;
  title: string;
  area: GoalArea;
  periodKind: Exclude<GoalPeriod, "custom">;
  measure: GoalMeasure;
  source?: GoalSource;
  targetValue: number;
  targetPer?: GoalPer | null;
  unit?: string;
  note: string;
};

export const GOAL_TEMPLATES: GoalTemplate[] = [
  { key: "omzet", title: "€ 5.500 omzet per maand", area: "zakelijk", periodKind: "year", measure: "auto", source: "revenue", targetValue: 5500, targetPer: "month", note: "G1: € 5.500 bruto per maand" },
  { key: "uurtarief", title: "Effectief € 82 per uur", area: "zakelijk", periodKind: "year", measure: "auto", source: "effective_rate", targetValue: 82, note: "G11: effectief uurtarief" },
  { key: "uren", title: "1.100 declarabele uren", area: "zakelijk", periodKind: "year", measure: "auto", source: "billable_hours", targetValue: 1100, note: "G11: capaciteit per jaar" },
  { key: "mrr", title: "Groeiende MRR", area: "zakelijk", periodKind: "year", measure: "auto", source: "mrr", targetValue: 2500, note: "Vul zelf de MRR in die je eind van het jaar wilt hebben" },
  { key: "sport", title: "4x per week sporten", area: "gezondheid", periodKind: "quarter", measure: "health", source: "health_sessions", targetValue: 4, targetPer: "week", note: "Uit Apple Health" },
  { key: "leren", title: "3 uur per week leren", area: "leren", periodKind: "quarter", measure: "auto", source: "learning_hours", targetValue: 3, targetPer: "week", note: "Tijd bij leeronderwerpen" },
];
