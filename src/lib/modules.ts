/**
 * Modules die Marc tijdelijk kan uitschakelen (zie werkplan, "Modules aan en uit").
 * Uit = verbergen, niet verwijderen: code, database en gegevens blijven bestaan.
 * Dit bestand bevat alleen beschrijvingen en mag ook in de browser gebruikt worden.
 */

export const MODULE_KEYS = ["dossier", "websites", "afspraken", "uren", "pipeline", "aangiftes"] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];
export type Modules = Record<ModuleKey, boolean>;

export const MODULES: Record<ModuleKey, { label: string; description: string; off: string; href?: string }> = {
  dossier: {
    label: "Klanten: uitgebreid dossier",
    description: "Registratie (KvK, btw), adressen, facturatie, compliance, documenten en tags in het klantdossier.",
    off: "Het dossier toont alleen bedrijfsnaam, status, contactpersonen, vaste informatie, projecten, taken en notities.",
  },
  websites: {
    label: "Websites",
    description: "Websites per klant met domein, registrar, verloopdatum, hosting en beheer.",
    off: "Pagina, dossierblok en domeinsignaal verborgen.",
    href: "/websites",
  },
  afspraken: {
    label: "Afspraken en termijnen",
    description: "Diensten per klant, termijnen, MRR en verwachte omzet.",
    off: "Pagina, dossierblok, KPI's en signalen verborgen. Geen automatische websiteprojecten of termijnen.",
    href: "/afspraken",
  },
  uren: {
    label: "Uren",
    description: "Urenregistratie met timer, weekoverzicht, te factureren uren, budgetten en effectief uurtarief.",
    off: "Pagina, timerbalk, ▶-knoppen, dossier- en projectblokken en KPI's verborgen.",
    href: "/uren",
  },
  pipeline: {
    label: "Pipeline",
    description: "Leads en offertes, met akkoord in één klik.",
    off: "Pagina, dossierblok en pipeline-signalen verborgen.",
    href: "/pipeline",
  },
  aangiftes: {
    label: "Aangiftes",
    description: "Aangiftecyclus voor boekhoudklanten met deadlines, stukken en taken.",
    off: "Pagina, dossierblok en signalen verborgen. Geen automatische aangifte-items en taken zolang de module uit staat.",
    href: "/aangiftes",
  },
};

/** MVP-stand: alle geavanceerde zakelijke modules uit. */
export const DEFAULT_MODULES: Modules = {
  dossier: false,
  websites: false,
  afspraken: false,
  uren: false,
  pipeline: false,
  aangiftes: false,
};

/* ---------------- KPI-tegels op Vandaag ---------------- */

export const KPI_KEYS = ["vandaag", "achterstallig", "inbox", "agenda", "gewoontes", "sport", "stappen", "doelen", "uren", "mrr", "factureren", "offertes", "aangiftes"] as const;
export type KpiKey = (typeof KPI_KEYS)[number];

export const KPIS: Record<KpiKey, { label: string; module?: ModuleKey }> = {
  vandaag: { label: "Taken vandaag" },
  achterstallig: { label: "Achterstallig" },
  inbox: { label: "Inbox" },
  agenda: { label: "Agenda vandaag" },
  gewoontes: { label: "Gewoontes vandaag" },
  sport: { label: "Sport deze week" },
  stappen: { label: "Stappen vandaag" },
  doelen: { label: "Doelen op schema" },
  uren: { label: "Uren deze week", module: "uren" },
  mrr: { label: "MRR", module: "afspraken" },
  factureren: { label: "Te factureren", module: "afspraken" },
  offertes: { label: "Openstaande offertes", module: "pipeline" },
  aangiftes: { label: "Aangiftes binnen 14 dagen", module: "aangiftes" },
};

/* ---------------- Weergave ---------------- */

export const THEMES = { systeem: "Volg systeem", licht: "Licht", donker: "Donker" } as const;
export type Theme = keyof typeof THEMES;
export const THEME_COOKIE = "marc-os-thema";
export function parseTheme(v: string | undefined | null): Theme {
  return v === "licht" || v === "donker" || v === "systeem" ? v : "systeem";
}

/* ---------------- Cockpitstijl ---------------- */

export const COCKPIT_STYLES = { strak: "Strak (MLC)", ironman: "Iron Man" } as const;
export type CockpitStyle = keyof typeof COCKPIT_STYLES;
export const COCKPIT_COOKIE = "marc-os-cockpit";
export function parseCockpitStyle(v: string | undefined | null): CockpitStyle {
  return v === "ironman" ? "ironman" : "strak";
}
