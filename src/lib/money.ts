/** Geldbedragen: overal in centen, exclusief btw. Bruikbaar in server- en clientcode. */

const eur = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" });
const eurRound = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0, minimumFractionDigits: 0 });

/** € 1.250,00 */
export function formatEuro(cents: number | null | undefined): string {
  return cents == null ? "" : eur.format(cents / 100);
}

/** € 1.250 (afgerond, voor tegels en totalen) */
export function formatEuroRound(cents: number | null | undefined): string {
  return cents == null ? "" : eurRound.format(Math.round(cents / 100));
}

/**
 * Bedrag uit een invoerveld naar centen. Snapt "1250", "1.250", "1250,50", "1.250,50", "€ 125" en "1250.50".
 * Geeft null bij leeg of onleesbaar.
 */
export function parseEuro(input: string | null | undefined): number | null {
  if (input == null) return null;
  let s = String(input).replace(/[€\s]/g, "");
  if (s === "") return null;
  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, ""); // 1.250 = duizendtal
  }
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** Centen naar een invoerwaarde voor een formulier: 125000 → "1250", 12550 → "125,50". */
export function centsToInput(cents: number | null | undefined): string {
  if (cents == null) return "";
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2).replace(".", ",");
}

export type Period = "month" | "quarter" | "year";

export const MONTHS_IN: Record<Period, number> = { month: 1, quarter: 3, year: 12 };

/** Maandbedrag van een vast bedrag per periode. */
export function perMonth(amountCents: number, period: Period | null | undefined): number {
  return period ? amountCents / MONTHS_IN[period] : amountCents;
}
