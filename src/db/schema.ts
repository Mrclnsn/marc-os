import {
  pgTable,
  uuid,
  text,
  timestamp,
  date,
  integer,
  boolean,
  pgEnum,
  index,
  numeric,
} from "drizzle-orm/pg-core";

export const areaEnum = pgEnum("area", ["zakelijk", "prive"]);

export const clientStatusEnum = pgEnum("client_status", [
  "lead",
  "active",
  "on_hold",
  "past",
]);

export const dpaStatusEnum = pgEnum("dpa_status", [
  "not_applicable",
  "needed",
  "sent",
  "signed",
]);

export const documentKindEnum = pgEnum("document_kind", [
  "quote",
  "agreement",
  "dpa",
  "other",
]);

export const projectStatusEnum = pgEnum("project_status", [
  "idea",
  "planned",
  "active",
  "waiting",
  "done",
  "archived",
]);

export const taskStatusEnum = pgEnum("task_status", [
  "todo",
  "doing",
  "waiting",
  "done",
]);

export const recurrenceEnum = pgEnum("recurrence", [
  "none",
  "daily",
  "weekdays",
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
]);

export const noteTypeEnum = pgEnum("note_type", [
  "inbox",
  "note",
  "meeting",
  "call",
  "email",
  "decision",
  "info",
  "idea",
]);

export const reviewKindEnum = pgEnum("review_kind", ["day", "week", "month"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const clients = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Basis
  name: text("name").notNull(), // bedrijfsnaam
  legalForm: text("legal_form"), // rechtsvorm: eenmanszaak, vof, bv, stichting, vereniging...
  status: clientStatusEnum("status").notNull().default("active"),
  clientSince: date("client_since"),
  source: text("source"), // hoe binnengekomen
  // Registratie
  kvkNumber: text("kvk_number"),
  vatNumber: text("vat_number"),
  // Adres (bezoekadres; factuuradres alleen als het afwijkt)
  address: text("address"),
  postcode: text("postcode"),
  city: text("city"),
  country: text("country").notNull().default("NL"),
  invoiceAddress: text("invoice_address"),
  invoicePostcode: text("invoice_postcode"),
  invoiceCity: text("invoice_city"),
  invoiceCountry: text("invoice_country"),
  // Facturatie
  invoiceEmail: text("invoice_email"),
  paymentTermDays: integer("payment_term_days").notNull().default(14),
  moneybirdContactId: text("moneybird_contact_id"),
  // Compliance
  dpaStatus: dpaStatusEnum("dpa_status").notNull().default("not_applicable"),
  dpaDate: date("dpa_date"),
  personalData: text("personal_data"), // welke persoonsgegevens verwerkt worden
  // Overig
  vaultRef: text("vault_ref"), // verwijzing naar de wachtwoordmanager, nooit wachtwoorden zelf
  tags: text("tags").array().notNull().default([]),
  info: text("info"), // vaste informatie, markdown
  ...timestamps,
});

export const clientContacts = pgTable(
  "client_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    role: text("role"),
    email: text("email"),
    phone: text("phone"),
    isPrimary: boolean("is_primary").notNull().default(false),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [index("client_contacts_client_idx").on(t.clientId)],
);

export const websites = pgTable(
  "websites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    registrar: text("registrar"),
    domainExpiresAt: date("domain_expires_at"),
    hostingLocation: text("hosting_location"),
    cms: text("cms"),
    liveDate: date("live_date"),
    hostingByUs: boolean("hosting_by_us").notNull().default(false), // hosting afgenomen bij MLC
    maintenanceByUs: boolean("maintenance_by_us").notNull().default(false), // beheer afgenomen bij MLC
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [
    index("websites_client_idx").on(t.clientId),
    index("websites_expires_idx").on(t.domainExpiresAt),
  ],
);

export const clientDocuments = pgTable(
  "client_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    kind: documentKindEnum("kind").notNull().default("other"),
    title: text("title").notNull(),
    url: text("url"), // link naar het bestand (OneDrive, Drive, Moneybird...)
    docDate: date("doc_date"),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [index("client_documents_client_idx").on(t.clientId)],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    area: areaEnum("area").notNull().default("zakelijk"),
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "set null",
    }),
    status: projectStatusEnum("status").notNull().default("planned"),
    startDate: date("start_date"),
    dueDate: date("due_date"),
    description: text("description"),
    ...timestamps,
  },
  (t) => [index("projects_client_idx").on(t.clientId)],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    area: areaEnum("area").notNull().default("zakelijk"),
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "set null",
    }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    status: taskStatusEnum("status").notNull().default("todo"),
    // planDate: wanneer je het wilt doen; dueDate: harde deadline
    planDate: date("plan_date"),
    dueDate: date("due_date"),
    priority: integer("priority").notNull().default(2), // 1 hoog, 2 normaal, 3 laag
    estimateMin: integer("estimate_min"),
    recurrence: recurrenceEnum("recurrence").notNull().default("none"),
    notes: text("notes"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("tasks_status_idx").on(t.status),
    index("tasks_plan_idx").on(t.planDate),
    index("tasks_client_idx").on(t.clientId),
    index("tasks_project_idx").on(t.projectId),
  ],
);

export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    body: text("body"),
    type: noteTypeEnum("type").notNull().default("note"),
    area: areaEnum("area"),
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "set null",
    }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    noteDate: date("note_date"),
    ...timestamps,
  },
  (t) => [
    index("notes_type_idx").on(t.type),
    index("notes_client_idx").on(t.clientId),
  ],
);

/* ---------------- Afspraken (diensten per klant) en termijnen ---------------- */

export const serviceKindEnum = pgEnum("service_kind", [
  "bookkeeping", // boekhouding
  "website", // websiteproject (eenmalig)
  "hosting",
  "maintenance", // beheer
  "sparring", // sparringpartner
  "custom", // maatwerk
]);

export const pricingEnum = pgEnum("pricing", [
  "recurring", // vast bedrag per periode
  "one_off", // eenmalig
  "hourly", // uurtarief
]);

export const billingPeriodEnum = pgEnum("billing_period", ["month", "quarter", "year"]);

export const agreementStatusEnum = pgEnum("agreement_status", [
  "draft", // concept
  "active", // actief
  "cancelled", // opgezegd (loopt tot de einddatum)
  "ended", // beëindigd
]);

export const installmentTriggerEnum = pgEnum("installment_trigger", [
  "date", // op een datum
  "acceptance", // bij akkoord
  "delivery", // bij oplevering
]);

export const installmentStatusEnum = pgEnum("installment_status", [
  "planned", // gepland
  "ready", // klaar om te factureren
  "draft", // concept in Moneybird
  "sent", // verzonden
  "paid", // betaald
]);

export const agreements = pgTable(
  "agreements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    kind: serviceKindEnum("kind").notNull(),
    title: text("title"), // optionele omschrijving, bijv. "Boekhouding en btw-aangiftes"
    websiteId: uuid("website_id").references(() => websites.id, { onDelete: "set null" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    // Bedragen in centen, exclusief btw. Bij uurtarief is dit het tarief per uur.
    amountCents: integer("amount_cents").notNull(),
    pricing: pricingEnum("pricing").notNull(),
    period: billingPeriodEnum("period"), // alleen bij een vast bedrag per periode
    budgetCents: integer("budget_cents"), // maatwerk: optioneel plafond
    sessionsPerMonth: integer("sessions_per_month"), // sparringpartner: optioneel
    startDate: date("start_date"),
    endDate: date("end_date"),
    noticeMonths: integer("notice_months"), // opzegtermijn in maanden
    indexationPct: numeric("indexation_pct", { precision: 5, scale: 2, mode: "number" }), // jaarlijkse indexatie
    status: agreementStatusEnum("status").notNull().default("draft"),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [
    index("agreements_client_idx").on(t.clientId),
    index("agreements_status_idx").on(t.status),
  ],
);

export const installments = pgTable(
  "installments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    agreementId: uuid("agreement_id").references(() => agreements.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    description: text("description").notNull(),
    amountCents: integer("amount_cents").notNull(), // exclusief btw
    trigger: installmentTriggerEnum("trigger").notNull().default("date"),
    dueDate: date("due_date"), // bij trigger "date"; anders optioneel een verwachte datum
    status: installmentStatusEnum("status").notNull().default("planned"),
    readyAt: date("ready_at"), // sinds wanneer klaar om te factureren
    moneybirdInvoiceId: text("moneybird_invoice_id"),
    invoicedAt: date("invoiced_at"),
    paidAt: date("paid_at"),
    sortOrder: integer("sort_order").notNull().default(0),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [
    index("installments_client_idx").on(t.clientId),
    index("installments_agreement_idx").on(t.agreementId),
    index("installments_status_idx").on(t.status),
  ],
);

export const reviews = pgTable("reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: reviewKindEnum("kind").notNull(),
  periodDate: date("period_date").notNull(), // dag, maandag van de week, of 1e van de maand
  body: text("body").notNull(),
  ...timestamps,
});

export type Client = typeof clients.$inferSelect;
export type ClientContact = typeof clientContacts.$inferSelect;
export type Website = typeof websites.$inferSelect;
export type ClientDocument = typeof clientDocuments.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type Note = typeof notes.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type Agreement = typeof agreements.$inferSelect;
export type Installment = typeof installments.$inferSelect;
