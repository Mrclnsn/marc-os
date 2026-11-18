/** Leren (gesprek 10): soorten, statussen en voortgang. Zonder database, ook in de browser. */

export const LEARNING_KINDS = { cursus: "Cursus", boek: "Boek", vaardigheid: "Vaardigheid", certificering: "Certificering", overig: "Overig" } as const;
export type LearningKind = keyof typeof LEARNING_KINDS;

export const LEARNING_STATUS = { idee: "Idee", bezig: "Bezig", gepauzeerd: "Gepauzeerd", afgerond: "Afgerond" } as const;
export type LearningStatus = keyof typeof LEARNING_STATUS;

/** Voortgang in procenten: met een eenheid (hoofdstukken, lessen) als deel van het totaal, anders het getal zelf. */
export function learningPct(t: { progressDone: number; progressTotal: number | null; progressUnit: string | null; status?: string }): number {
  if (t.progressUnit && t.progressTotal && t.progressTotal > 0) return Math.max(0, Math.min(100, Math.round((t.progressDone / t.progressTotal) * 100)));
  if (!t.progressUnit) return Math.max(0, Math.min(100, Math.round(t.progressDone)));
  return t.status === "afgerond" ? 100 : 0;
}

const nf = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 1 });

/** "4 van 12 hoofdstukken" of "35%". */
export function learningProgressLabel(t: { progressDone: number; progressTotal: number | null; progressUnit: string | null }): string {
  if (t.progressUnit) return t.progressTotal ? `${nf.format(t.progressDone)} van ${nf.format(t.progressTotal)} ${t.progressUnit}` : `${nf.format(t.progressDone)} ${t.progressUnit}`;
  return `${Math.round(t.progressDone)}%`;
}
