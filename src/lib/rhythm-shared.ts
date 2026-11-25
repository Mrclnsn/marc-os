/**
 * Dagritme en gewoontes: vaste lijsten en rekenhulpjes zonder database (ook in de browser te gebruiken).
 */

export const BLOCK_KINDS = {
  dagstart: "Dagstart",
  diep_werk: "Diep werk",
  klantwerk: "Klantwerk",
  administratie: "Administratie",
  sport: "Sport",
  pauze: "Pauze",
  dagafsluiting: "Dagafsluiting",
  weekreview: "Weekreview",
  leren: "Leren",
  prive: "Privé",
  overig: "Overig",
} as const;
export type BlockKind = keyof typeof BLOCK_KINDS;
export const BLOCK_KIND_KEYS = Object.keys(BLOCK_KINDS) as BlockKind[];

/** Blokken waar je taken in plant (timeblocking). Dagstart, pauze en dagafsluiting zijn momenten, geen werkblok. */
export const PLANNABLE_KINDS: BlockKind[] = ["diep_werk", "klantwerk", "administratie", "leren", "prive", "overig", "weekreview", "sport"];

export const WEEKDAYS = { 1: "ma", 2: "di", 3: "wo", 4: "do", 5: "vr", 6: "za", 7: "zo" } as const;
export const WEEKDAYS_LONG = { 1: "maandag", 2: "dinsdag", 3: "woensdag", 4: "donderdag", 5: "vrijdag", 6: "zaterdag", 7: "zondag" } as const;
export type Weekday = keyof typeof WEEKDAYS;

export const HABIT_FREQUENCIES = {
  daily: "Elke dag",
  weekly: "Aantal keer per week",
  days: "Vaste dagen",
} as const;
export type HabitFrequency = keyof typeof HABIT_FREQUENCIES;

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function fmtMin(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** "9:00", "900", "9" en "09.00" worden "09:00"; onzin geeft null. */
export function parseTime(input: string | null | undefined): string | null {
  if (!input) return null;
  const t = input.trim().replace(".", ":");
  let h: number, m: number;
  if (/^\d{1,2}:\d{2}$/.test(t)) [h, m] = t.split(":").map(Number);
  else if (/^\d{3,4}$/.test(t)) [h, m] = [Number(t.slice(0, -2)), Number(t.slice(-2))];
  else if (/^\d{1,2}$/.test(t)) [h, m] = [Number(t), 0];
  else return null;
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** ISO-weekdag (1 = maandag ... 7 = zondag) van een datum YYYY-MM-DD, onafhankelijk van de tijdzone. */
export function isoWeekday(iso: string): Weekday {
  const d = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return (d === 0 ? 7 : d) as Weekday;
}

/** Korte omschrijving van de frequentie, bijv. "elke dag", "3x per week", "ma, wo, vr". */
export function frequencyLabel(h: { frequency: string; timesPerWeek: number | null; weekdays: number[] }): string {
  if (h.frequency === "weekly") return `${h.timesPerWeek ?? 1}x per week`;
  if (h.frequency === "days") {
    const days = [...h.weekdays].sort((a, b) => a - b);
    if (days.length === 5 && days.join() === "1,2,3,4,5") return "werkdagen";
    return days.map((d) => WEEKDAYS[d as Weekday]).join(", ") || "geen dagen";
  }
  return "elke dag";
}

export function weekdaysLabel(days: number[]): string {
  const s = [...days].sort((a, b) => a - b);
  if (!s.length) return "geen vaste dagen";
  if (s.join() === "1,2,3,4,5") return "ma t/m vr";
  if (s.join() === "1,2,3,4") return "ma t/m do";
  if (s.join() === "6,7") return "za en zo";
  if (s.length > 2 && s.every((d, i) => i === 0 || d === s[i - 1] + 1)) return `${WEEKDAYS[s[0] as Weekday]} t/m ${WEEKDAYS[s[s.length - 1] as Weekday]}`;
  return s.map((d) => WEEKDAYS[d as Weekday]).join(", ");
}

/* ---------------- Gewoontes: dagdeel en tijdstip (herziening 25 november) ---------------- */

/** Dagdelen om gewoontes te groeperen. Met een vast tijdstip volgt het dagdeel uit de tijd. */
export const HABIT_MOMENTS = {
  ochtend: { label: "Ochtend", until: "12:00" },
  middag: { label: "Middag", until: "18:00" },
  avond: { label: "Avond", until: "24:00" },
} as const;
export type HabitMoment = keyof typeof HABIT_MOMENTS;
export const HABIT_MOMENT_KEYS = Object.keys(HABIT_MOMENTS) as HabitMoment[];

export function momentOfTime(hhmm: string): HabitMoment {
  return hhmm < "12:00" ? "ochtend" : hhmm < "18:00" ? "middag" : "avond";
}

/** Dagdeel van een gewoonte: uit het tijdstip, anders het gekozen dagdeel, anders uit het blok; null = op elk moment. */
export function habitMoment(h: { time?: string | null; moment?: string | null; blockStart?: string | null }): HabitMoment | null {
  if (h.time) return momentOfTime(h.time);
  if (h.moment && h.moment in HABIT_MOMENTS) return h.moment as HabitMoment;
  if (h.blockStart) return momentOfTime(h.blockStart);
  return null;
}

/** Snelkeuzes voor de dagen. */
export const DAY_PRESETS = {
  daily: { label: "Elke dag", days: [1, 2, 3, 4, 5, 6, 7] },
  workdays: { label: "Werkdagen", days: [1, 2, 3, 4, 5] },
  weekend: { label: "Weekend", days: [6, 7] },
} as const;

/** Volledige omschrijving: "werkdagen om 07:30", "3x per week, 's avonds", "elke dag". */
export function habitWhenLabel(h: { frequency: string; timesPerWeek: number | null; weekdays: number[]; time?: string | null; moment?: string | null; remind?: boolean }): string {
  let when = frequencyLabel(h);
  if (h.frequency === "days" && [...h.weekdays].sort().join() === "6,7") when = "weekend";
  const m = h.time ? null : h.moment && h.moment in HABIT_MOMENTS ? (h.moment as HabitMoment) : null;
  const at = h.time ? ` om ${h.time}` : m ? (m === "ochtend" ? ", 's ochtends" : m === "middag" ? ", 's middags" : ", 's avonds") : "";
  return `${when}${at}${h.time && h.remind ? " (herinnering)" : ""}`;
}
