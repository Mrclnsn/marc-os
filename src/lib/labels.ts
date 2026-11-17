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
