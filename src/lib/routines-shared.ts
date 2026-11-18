/**
 * Vaste routines van Hermes (gesprek 13): beschrijvingen, standaardinstellingen en de planning.
 * Zonder database, zodat de instellingenpagina in de browser dezelfde definities gebruikt.
 */
import type { ModuleKey } from "./modules";

export const ROUTINE_KEYS = ["briefing", "dagafsluiting", "weekreview", "maandafsluiting", "aangiftecheck"] as const;
export type RoutineKey = (typeof ROUTINE_KEYS)[number];

/** workdays = dagen met een werkdag in het dagritme (vrije dagen slaan over), weekly = vaste weekdag, monthly = eerste werkdag van de maand */
export type RoutineSchedule = "workdays" | "weekly" | "monthly";

export type RoutineDef = {
  label: string;
  description: string;
  schedule: RoutineSchedule;
  /** Standaardtijd HH:mm */
  time: string;
  /** Weekdag (1 = ma ... 7 = zo) voor weekly */
  weekday?: number;
  /** Waar de tekst wordt opgeslagen, en onder welk kopje (dag-review kan briefing en dagafsluiting bevatten) */
  review: "day" | "week" | "month";
  heading: string;
  /** Loopt alleen als deze module aan staat */
  module?: ModuleKey;
  /** Waar de pushmelding naartoe wijst */
  href: string;
};

export const ROUTINES: Record<RoutineKey, RoutineDef> = {
  briefing: {
    label: "Ochtendbriefing",
    description: "Agenda, dagritme, top 3, achterstallig, gewoontes, doelen en een voorstel voor de dagindeling (taken in blokken, na akkoord).",
    schedule: "workdays",
    time: "07:30",
    review: "day",
    heading: "Ochtendbriefing",
    href: "/",
  },
  dagafsluiting: {
    label: "Dagafsluiting",
    description: "Gedaan tegenover gepland, gewoontes, open eindjes, en een voorstel om wat bleef liggen naar de volgende werkdag te schuiven.",
    schedule: "workdays",
    time: "17:30",
    review: "day",
    heading: "Dagafsluiting",
    href: "/reviews",
  },
  weekreview: {
    label: "Weekreview",
    description: "Per klant en privé, doelen, gewoontes, sport, leren, plus (met modules aan) uren, te factureren en pipeline. Voorstel voor de focus van volgende week.",
    schedule: "weekly",
    weekday: 5,
    time: "15:00",
    review: "week",
    heading: "Weekreview",
    href: "/reviews",
  },
  maandafsluiting: {
    label: "Maandafsluiting",
    description: "Terugblik op de vorige maand: doelen, gewoontes, gezondheid, leren, plus (met Afspraken aan) MRR en te factureren.",
    schedule: "monthly",
    time: "09:00",
    review: "month",
    heading: "Maandafsluiting",
    href: "/reviews",
  },
  aangiftecheck: {
    label: "Aangiftecheck",
    description: "Deadlines binnen 14 dagen, te laat en ontbrekende stukken per boekhoudklant, met conceptmails om stukken op te vragen.",
    schedule: "weekly",
    weekday: 1,
    time: "08:45",
    review: "week",
    heading: "Aangiftecheck",
    module: "aangiftes",
    href: "/aangiftes",
  },
};

export type RoutineSetting = {
  enabled: boolean;
  time: string;
  /** Alleen bij weekly */
  weekday?: number;
  /** Tekst naar WhatsApp (als WhatsApp gekoppeld is) */
  whatsapp: boolean;
  /** Pushmelding als hij klaar is */
  push: boolean;
};
export type RoutineSettings = Record<RoutineKey, RoutineSetting>;

export function defaultRoutineSettings(): RoutineSettings {
  return Object.fromEntries(
    ROUTINE_KEYS.map((k) => [k, { enabled: true, time: ROUTINES[k].time, weekday: ROUTINES[k].weekday, whatsapp: true, push: true }]),
  ) as RoutineSettings;
}

export const WEEKDAY_LONG = ["", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"];

export function isTime(v: unknown): v is string {
  return typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

export const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** "werkdagen 07:30", "vrijdag 15:00", "1e werkdag van de maand 09:00" */
export function scheduleLabel(key: RoutineKey, s: RoutineSetting): string {
  const def = ROUTINES[key];
  if (def.schedule === "workdays") return `werkdagen ${s.time}`;
  if (def.schedule === "weekly") return `${WEEKDAY_LONG[s.weekday ?? def.weekday ?? 1]} ${s.time}`;
  return `1e werkdag van de maand ${s.time}`;
}

/** Hoe lang na het geplande tijdstip een routine nog alsnog mag lopen (bijv. als de VPS even weg was). */
export const CATCH_UP_MINUTES = 180;

/** Periode waar een run bij hoort: de dag, de maandag van de week, of de 1e van de maand. */
export function routinePeriod(key: RoutineKey, date: string): string {
  const s = ROUTINES[key].schedule;
  if (s === "workdays") return date;
  if (s === "monthly") return `${date.slice(0, 8)}01`;
  const d = new Date(`${date}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export type DueContext = {
  /** Vandaag (YYYY-MM-DD) en nu in minuten na middernacht, in Marc's tijdzone */
  date: string;
  minutes: number;
  /** 1 = ma ... 7 = zo */
  weekday: number;
  /** Heeft vandaag een werkdag in het dagritme (geen vrije dag) */
  workday: boolean;
  /** Is vandaag de eerste werkdag van de maand */
  firstWorkdayOfMonth: boolean;
};

/** Valt de routine vandaag, en zitten we tussen het tijdstip en het einde van de inhaaltijd? */
export function isDue(key: RoutineKey, s: RoutineSetting, ctx: DueContext): boolean {
  if (!s.enabled || !isTime(s.time)) return false;
  const def = ROUTINES[key];
  const today =
    def.schedule === "workdays" ? ctx.workday : def.schedule === "weekly" ? ctx.weekday === (s.weekday ?? def.weekday) : ctx.firstWorkdayOfMonth;
  if (!today) return false;
  const at = toMinutes(s.time);
  return ctx.minutes >= at && ctx.minutes < at + CATCH_UP_MINUTES;
}

/**
 * Zet een stuk tekst onder een eigen kopje in een review. Bestaat het kopje al (bijv. een tweede keer draaien),
 * dan wordt dat stuk vervangen; anders komt het eronder. Zo staan briefing en dagafsluiting samen in de dag-review.
 */
export function upsertSection(existing: string | null | undefined, heading: string, text: string): string {
  const block = `## ${heading}\n\n${text.trim()}`;
  const body = (existing ?? "").trim();
  if (!body) return block;
  const parts = body.split(/\n(?=## )/);
  const i = parts.findIndex((p) => p.trimStart().startsWith(`## ${heading}\n`) || p.trim() === `## ${heading}`);
  if (i >= 0) {
    parts[i] = block;
    return parts.map((p) => p.trim()).join("\n\n");
  }
  return `${body}\n\n${block}`;
}

/** Eerste zin of regel van een tekst, voor een pushmelding of de cockpit. */
export function firstLine(text: string, max = 160): string {
  const line =
    text
      .split("\n")
      .map((l) => l.replace(/^[#>*\-\s]+/, "").trim())
      .find((l) => l.length > 0) ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Het laatst toegevoegde stuk van een review met kopjes (bijv. de dagafsluiting na de briefing), zonder het kopje. */
export function latestSection(body: string): { heading: string | null; text: string } {
  const parts = body.trim().split(/\n(?=## )/);
  const last = parts[parts.length - 1] ?? "";
  const m = last.match(/^## (.+)\n+([\s\S]*)$/);
  return m ? { heading: m[1].trim(), text: m[2].trim() } : { heading: null, text: body.trim() };
}
