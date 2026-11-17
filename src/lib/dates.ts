import { addDays, addMonths, addWeeks, addYears, differenceInCalendarDays, format, parseISO } from "date-fns";

export const TIMEZONE = process.env.APP_TIMEZONE ?? "Europe/Amsterdam";

/** Vandaag als YYYY-MM-DD in de ingestelde tijdzone. */
export function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date());
}

export function addDaysIso(iso: string, days: number): string {
  return format(addDays(parseISO(iso), days), "yyyy-MM-dd");
}

/** Maandag van de week waarin `iso` valt. */
export function weekStart(iso: string): string {
  const d = parseISO(iso);
  const dow = (d.getDay() + 6) % 7; // ma=0
  return format(addDays(d, -dow), "yyyy-MM-dd");
}

export type Recurrence =
  | "none"
  | "daily"
  | "weekdays"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "yearly";

/** Volgende datum voor een terugkerende taak. */
export function nextOccurrence(iso: string, rule: Recurrence): string | null {
  const d = parseISO(iso);
  let next: Date;
  switch (rule) {
    case "daily":
      next = addDays(d, 1);
      break;
    case "weekdays": {
      next = addDays(d, 1);
      while (next.getDay() === 0 || next.getDay() === 6) next = addDays(next, 1);
      break;
    }
    case "weekly":
      next = addWeeks(d, 1);
      break;
    case "monthly":
      next = addMonths(d, 1);
      break;
    case "quarterly":
      next = addMonths(d, 3);
      break;
    case "yearly":
      next = addYears(d, 1);
      break;
    default:
      return null;
  }
  return format(next, "yyyy-MM-dd");
}

export function daysBetween(fromIso: string, toIso: string): number {
  return differenceInCalendarDays(parseISO(toIso), parseISO(fromIso));
}

const nlDate = new Intl.DateTimeFormat("nl-NL", { weekday: "short", day: "numeric", month: "short" });
const nlLong = new Intl.DateTimeFormat("nl-NL", { weekday: "long", day: "numeric", month: "long" });

export function formatShort(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = today();
  const diff = daysBetween(t, iso);
  if (diff === 0) return "Vandaag";
  if (diff === 1) return "Morgen";
  if (diff === -1) return "Gisteren";
  return nlDate.format(parseISO(iso));
}

export function formatLong(iso: string): string {
  return nlLong.format(parseISO(iso));
}
