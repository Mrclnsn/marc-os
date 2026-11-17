export const AREAS = { zakelijk: "Zakelijk", prive: "Privé" } as const;
export type Area = keyof typeof AREAS;

export const TASK_STATUS = {
  todo: "Te doen",
  doing: "Bezig",
  waiting: "Wacht op",
  done: "Klaar",
} as const;
export type TaskStatus = keyof typeof TASK_STATUS;

export const PROJECT_STATUS = {
  idea: "Idee",
  planned: "Gepland",
  active: "Actief",
  waiting: "Wacht",
  done: "Afgerond",
  archived: "Gearchiveerd",
} as const;
export type ProjectStatus = keyof typeof PROJECT_STATUS;

export const CLIENT_STATUS = {
  lead: "Lead",
  active: "Actief",
  on_hold: "On hold",
  past: "Oud-klant",
} as const;
export type ClientStatus = keyof typeof CLIENT_STATUS;

export const RECURRENCE = {
  none: "Niet",
  daily: "Dagelijks",
  weekdays: "Werkdagen",
  weekly: "Wekelijks",
  monthly: "Maandelijks",
  quarterly: "Per kwartaal",
  yearly: "Jaarlijks",
} as const;
export type RecurrenceKey = keyof typeof RECURRENCE;

export const NOTE_TYPES = {
  inbox: "Inbox",
  note: "Notitie",
  meeting: "Meeting",
  call: "Telefoon",
  email: "E-mail",
  decision: "Besluit",
  info: "Info",
  idea: "Idee",
} as const;
export type NoteType = keyof typeof NOTE_TYPES;

export const PRIORITY = { 1: "Hoog", 2: "Normaal", 3: "Laag" } as const;

export const DPA_STATUS = {
  not_applicable: "N.v.t.",
  needed: "Nodig",
  sent: "Verstuurd",
  signed: "Getekend",
} as const;
export type DpaStatus = keyof typeof DPA_STATUS;

export const DOCUMENT_KIND = {
  quote: "Offerte",
  agreement: "Overeenkomst",
  dpa: "Verwerkersovereenkomst",
  other: "Overig",
} as const;
export type DocumentKind = keyof typeof DOCUMENT_KIND;

/** Suggesties voor rechtsvorm (vrij invulbaar). */
export const LEGAL_FORMS = ["Eenmanszaak", "VOF", "BV", "Maatschap", "Stichting", "Vereniging", "Coöperatie", "NV"];

/** Suggesties voor bron (vrij invulbaar). */
export const CLIENT_SOURCES = ["Netwerk", "Doorverwijzing", "Website", "LinkedIn", "Bestaand contact", "Vereniging"];

/** Dagen vóór verlopen waarop een domein een signaal geeft. */
export const DOMAIN_WARNING_DAYS = 30;

/* ---------------- Afspraken en termijnen ---------------- */

export const SERVICE_KIND = {
  bookkeeping: "Boekhouding",
  website: "Website",
  hosting: "Hosting",
  maintenance: "Beheer",
  sparring: "Sparringpartner",
  custom: "Maatwerk",
} as const;
export type ServiceKind = keyof typeof SERVICE_KIND;

export const PRICING = {
  recurring: "Vast bedrag per periode",
  one_off: "Eenmalig",
  hourly: "Uurtarief",
} as const;
export type Pricing = keyof typeof PRICING;

export const PERIOD = { month: "Per maand", quarter: "Per kwartaal", year: "Per jaar" } as const;
export const PERIOD_SHORT = { month: "mnd", quarter: "kwartaal", year: "jaar" } as const;
export type BillingPeriod = keyof typeof PERIOD;

export const AGREEMENT_STATUS = {
  draft: "Concept",
  active: "Actief",
  cancelled: "Opgezegd",
  ended: "Beëindigd",
} as const;
export type AgreementStatus = keyof typeof AGREEMENT_STATUS;

export const INSTALLMENT_TRIGGER = {
  date: "Op datum",
  acceptance: "Bij akkoord",
  delivery: "Bij oplevering",
} as const;
export type InstallmentTrigger = keyof typeof INSTALLMENT_TRIGGER;

export const INSTALLMENT_STATUS = {
  planned: "Gepland",
  ready: "Klaar om te factureren",
  draft: "Concept in Moneybird",
  sent: "Verzonden",
  paid: "Betaald",
} as const;
export type InstallmentStatus = keyof typeof INSTALLMENT_STATUS;

/** Standaardinstellingen per soort dienst (bij nieuwe afspraak). Bedragen in centen. */
export const SERVICE_DEFAULTS: Record<ServiceKind, { pricing: Pricing; period: BillingPeriod | null; amountCents?: number }> = {
  bookkeeping: { pricing: "recurring", period: "month" },
  website: { pricing: "one_off", period: null },
  hosting: { pricing: "recurring", period: "month" },
  maintenance: { pricing: "recurring", period: "month" },
  sparring: { pricing: "recurring", period: "month", amountCents: 12500 },
  custom: { pricing: "hourly", period: null },
};

/** Dagen vóór de einddatum waarop een afspraak een signaal geeft. */
export const AGREEMENT_WARNING_DAYS = 30;

/** Waarschuwing bij maatwerk: percentage van het budget dat met declarabele uren besteed is. */
export const BUDGET_WARNING_PCT = 80;

/* ---------------- Uren ---------------- */

/** Suggesties voor de soort werk; vrij in te vullen. */
export const TIME_CATEGORIES = ["Klantwerk", "Overleg", "Administratie", "Acquisitie", "Marketing", "Leren", "Reistijd", "Sport", "Privé"];
