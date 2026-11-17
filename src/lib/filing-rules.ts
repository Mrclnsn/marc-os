/**
 * Aangiftecyclus: pure rekenregels (perioden, deadlines, teksten). Geen database, bruikbaar in server- en clientcode.
 *
 * Wettelijke termijnen (Belastingdienst, gecontroleerd november 2026):
 * - Btw, ICP en loonheffingen per maand of kwartaal: uiterlijk de laatste dag van de maand na de periode.
 * - Btw per jaar: uiterlijk 31 maart van het volgende jaar.
 * - IB: vóór 1 mei; met uitstel 4 maanden extra (vóór 1 september); met becon-uitstel tot en met 30 april van het jaar daarna.
 * - Vpb (boekjaar = kalenderjaar): vóór 1 juni; met uitstel 5 maanden extra (vóór 1 november); becon-uitstel tot en met 30 april van het jaar daarna.
 * Een deadline is per aangifte-item met de hand aan te passen (bijv. bij een afwijkende datum in de aangiftebrief).
 */
import { addDays, addMonths, endOfMonth, format, parseISO } from "date-fns";
import { FILING_DOCS_DAYS, FILING_KIND, type BillingPeriod, type FilingExtension, type FilingKind } from "./labels";

const iso = (d: Date) => format(d, "yyyy-MM-dd");

export type Period = { start: string; end: string };

/** De periode (maand, kwartaal of jaar) waarin `date` valt. */
export function periodOf(date: string, frequency: BillingPeriod): Period {
  const d = parseISO(date);
  const y = d.getFullYear();
  const m = d.getMonth();
  const startMonth = frequency === "month" ? m : frequency === "quarter" ? m - (m % 3) : 0;
  const len = frequency === "month" ? 1 : frequency === "quarter" ? 3 : 12;
  const start = new Date(y, startMonth, 1);
  return { start: iso(start), end: iso(endOfMonth(addMonths(start, len - 1))) };
}

/** De periode direct na `period`. */
export function nextPeriod(period: Period, frequency: BillingPeriod): Period {
  return periodOf(iso(addDays(parseISO(period.end), 1)), frequency);
}

const monthShort = new Intl.DateTimeFormat("nl-NL", { month: "short" });
const monthLong = new Intl.DateTimeFormat("nl-NL", { month: "long" });

/** "Q4 2026", "nov 2026", "2026". */
export function periodLabel(start: string, frequency: BillingPeriod): string {
  const d = parseISO(start);
  const y = d.getFullYear();
  if (frequency === "year") return String(y);
  if (frequency === "quarter") return `Q${Math.floor(d.getMonth() / 3) + 1} ${y}`;
  return `${monthShort.format(d).replace(".", "")} ${y}`;
}

/** Leesbare periode voor een klant: "het 4e kwartaal van 2026", "november 2026", "2026". */
export function periodPhrase(start: string, frequency: BillingPeriod): string {
  const d = parseISO(start);
  const y = d.getFullYear();
  if (frequency === "year") return String(y);
  if (frequency === "quarter") return `het ${Math.floor(d.getMonth() / 3) + 1}e kwartaal van ${y}`;
  return `${monthLong.format(d)} ${y}`;
}

/** Frequentie afleiden uit een periode (voor items zonder instelling). */
export function frequencyOf(p: Period): BillingPeriod {
  const months = (parseISO(p.end).getFullYear() - parseISO(p.start).getFullYear()) * 12 + parseISO(p.end).getMonth() - parseISO(p.start).getMonth() + 1;
  return months >= 12 ? "year" : months >= 3 ? "quarter" : "month";
}

/** Wettelijke deadline voor een aangifte over de periode die eindigt op `periodEnd`. */
export function defaultDeadline(kind: FilingKind, frequency: BillingPeriod, periodEnd: string, extension: FilingExtension = "none"): string {
  const y = parseISO(periodEnd).getFullYear();
  if (kind === "income_tax") {
    if (extension === "becon") return `${y + 2}-04-30`;
    if (extension === "individual") return `${y + 1}-08-31`;
    return `${y + 1}-04-30`;
  }
  if (kind === "corporate_tax") {
    if (extension === "becon") return `${y + 2}-04-30`;
    if (extension === "individual") return `${y + 1}-10-31`;
    return `${y + 1}-05-31`;
  }
  if (kind === "vat" && frequency === "year") return `${y + 1}-03-31`;
  // Maand, kwartaal (en overige jaaraangiftes): laatste dag van de maand na de periode
  return iso(endOfMonth(addMonths(parseISO(periodEnd), 1)));
}

/** Uitstel speelt alleen bij IB en Vpb. */
export function extensionApplies(kind: FilingKind): boolean {
  return kind === "income_tax" || kind === "corporate_tax";
}

/** Datum waarop de stukken van de klant binnen moeten zijn. */
export function docsDueDate(periodEnd: string, frequency: BillingPeriod, days?: number | null): string {
  return iso(addDays(parseISO(periodEnd), days ?? FILING_DOCS_DAYS[frequency]));
}

/** "Btw-aangifte Q4 2026" (bij overig de eigen naam). */
export function filingTitle(f: { kind: FilingKind; label?: string | null; periodStart: string; periodEnd: string }): string {
  const name = f.label || (f.kind === "other" ? "Aangifte" : FILING_KIND[f.kind]);
  return `${name} ${periodLabel(f.periodStart, frequencyOf({ start: f.periodStart, end: f.periodEnd }))}`;
}

/* ---------------- Herinnering stukken ---------------- */

const DOCS_LIST: Record<FilingKind, string[]> = {
  vat: ["verkoopfacturen", "inkoopfacturen en bonnetjes", "bankafschriften (als de bankkoppeling niet loopt)"],
  icp: ["verkoopfacturen aan klanten in andere EU-landen, met hun btw-nummer"],
  payroll: ["gewerkte uren en wijzigingen in het personeel (in- en uitdienst, salaris)"],
  income_tax: [
    "jaaropgaven van loon, uitkering of pensioen",
    "jaaroverzichten van bankrekeningen, spaargeld en beleggingen per 1 januari",
    "jaaroverzicht van de hypotheek en de WOZ-beschikking",
    "betaalde zorgkosten, giften en lijfrentepremies, als je die hebt",
  ],
  corporate_tax: ["de laatste bankafschriften van het jaar", "een overzicht van de voorraad en onderhanden werk per 31 december", "leningen, rekening-courant en eventuele dividendbesluiten"],
  other: ["de stukken die horen bij deze aangifte"],
};

const KIND_PHRASE: Record<FilingKind, string> = {
  vat: "de btw-aangifte",
  income_tax: "je aangifte inkomstenbelasting",
  corporate_tax: "de aangifte vennootschapsbelasting",
  icp: "de ICP-opgaaf",
  payroll: "de aangifte loonheffingen",
  other: "de aangifte",
};

const SUBJECT_KIND: Record<FilingKind, string> = {
  vat: "btw",
  income_tax: "aangifte IB",
  corporate_tax: "aangifte Vpb",
  icp: "ICP-opgaaf",
  payroll: "loonheffingen",
  other: "aangifte",
};

const nlDate = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", year: "numeric" });
const longDate = (d: string) => nlDate.format(parseISO(d));

/**
 * Conceptmail om de stukken op te vragen, in de toon van MLC: direct, menselijk, "je" en voornaam.
 * Marc verstuurt zelf (of later Hermes, na akkoord).
 */
export function docsReminder(f: { kind: FilingKind; label?: string | null; periodStart: string; periodEnd: string; deadline: string; docsDueDate: string | null }, contactName?: string | null) {
  const freq = frequencyOf({ start: f.periodStart, end: f.periodEnd });
  const first = contactName?.trim().split(/\s+/)[0];
  const what = f.kind === "other" && f.label ? `de ${f.label.toLowerCase()}` : KIND_PHRASE[f.kind];
  const due = f.docsDueDate ?? docsDueDate(f.periodEnd, freq);
  const subject = `Stukken ${f.kind === "other" && f.label ? f.label.toLowerCase() : SUBJECT_KIND[f.kind]} ${periodLabel(f.periodStart, freq)}`;
  const body = [
    `Hoi${first ? ` ${first}` : ""},`,
    "",
    `Het is weer tijd voor ${what} over ${periodPhrase(f.periodStart, freq)}. Wil je de stukken uiterlijk ${longDate(due)} aanleveren? Het gaat om:`,
    "",
    ...DOCS_LIST[f.kind].map((x) => `- ${x}`),
    "",
    `Dan heb ik genoeg tijd om alles te verwerken vóór de deadline van ${longDate(f.deadline)}.`,
    "",
    "Vragen? Bel of mail me gerust.",
    "",
    "Met vriendelijke groet,",
    "",
    "Marc Lonsain",
    "Marc Lonsain Consultancy",
  ].join("\n");
  return { subject, body };
}
