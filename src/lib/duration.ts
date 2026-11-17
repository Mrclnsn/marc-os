/** Tijdsduren: overal in hele minuten. Bruikbaar in server- en clientcode. */

/**
 * Duur uit vrije invoer naar minuten. Snapt:
 * "1:30", "1,5", "1.5", "2" (uren), "90m", "90 min", "1u30", "1u", "1h30", "2 uur", "45 minuten".
 * Een los getal is in uren; boven de 24 wordt het als minuten gelezen ("90" = 90 minuten).
 * Geeft null bij leeg of onleesbaar.
 */
export function parseDuration(input: string | null | undefined): number | null {
  if (input == null) return null;
  const s = String(input).trim().toLowerCase().replace(/\s+/g, "");
  if (s === "") return null;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{1,2}):(\d{1,2})$/))) return Number(m[1]) * 60 + Number(m[2]);
  if ((m = s.match(/^(\d+)(m|min|mins|minuut|minuten)$/))) return Number(m[1]);
  if ((m = s.match(/^(\d+(?:[.,]\d+)?)(u|h|uur|uren|hr|hrs)(?:(\d{1,2})(m|min|minuten)?)?$/))) {
    return Math.round(Number(m[1].replace(",", ".")) * 60) + (m[3] ? Number(m[3]) : 0);
  }
  if ((m = s.match(/^(\d+(?:[.,]\d+)?)$/))) {
    const n = Number(m[1].replace(",", "."));
    return n > 24 && Number.isInteger(n) ? n : Math.round(n * 60);
  }
  return null;
}

/** 90 → "1:30" */
export function formatDuration(min: number | null | undefined): string {
  if (min == null) return "";
  const m = Math.max(0, Math.round(min));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

/** 750 → "12,5 u" (voor totalen) */
export function formatHours(min: number | null | undefined): string {
  if (!min) return "0 u";
  const h = Math.round((min / 60) * 10) / 10;
  return `${String(h).replace(".", ",")} u`;
}

/** Waarde van een aantal minuten tegen een uurtarief, in centen. */
export function hoursValue(min: number, rateCents: number): number {
  return Math.round((min / 60) * rateCents);
}
