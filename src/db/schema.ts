import { sql } from "drizzle-orm";
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
  uniqueIndex,
  numeric,
  jsonb,
  doublePrecision,
  serial,
  type AnyPgColumn,
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
    // Timeblocking (gesprek 8): in welk dagritmeblok en eventueel hoe laat
    planBlockId: uuid("plan_block_id").references(() => rhythmBlocks.id, { onDelete: "set null" }),
    planTime: text("plan_time"), // HH:mm
    recurrence: recurrenceEnum("recurrence").notNull().default("none"),
    notes: text("notes"),
    // Stap in een leerplan (gesprek 10)
    learningId: uuid("learning_id").references(() => learningTopics.id, { onDelete: "set null" }),
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

/* ---------------- Second brain: bronnen en links ---------------- */

export const sourceKindEnum = pgEnum("source_kind", [
  "article", // artikel
  "video",
  "podcast",
  "book", // boek
  "course", // cursus
  "idea", // idee
  "link", // overige link
]);

export const sourceStatusEnum = pgEnum("source_status", [
  "new", // nog bekijken
  "read", // gelezen of bekeken
  "processed", // verwerkt (in notities of taken)
]);

/** Bronnen: links, artikelen, video's en ideeën om te bewaren, met samenvatting en eigen aantekeningen. */
export const sources = pgTable(
  "sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    url: text("url"),
    kind: sourceKindEnum("kind").notNull().default("link"),
    status: sourceStatusEnum("status").notNull().default("new"),
    author: text("author"), // maker, kanaal of site
    summary: text("summary"), // korte samenvatting (door Marc of Hermes)
    body: text("body"), // eigen aantekeningen in markdown, met [[links]]
    area: areaEnum("area"),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    capturedVia: text("captured_via"), // app, inbox, mcp, whatsapp
    // Bron bij een leeronderwerp (gesprek 10)
    learningId: uuid("learning_id").references(() => learningTopics.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("sources_status_idx").on(t.status), index("sources_client_idx").on(t.clientId)],
);

/**
 * [[Links]] uit notities en bronnen. Het doel wordt bewaard als tekst (genormaliseerd) en pas bij het lezen
 * opgezocht, zodat een link vanzelf werkt zodra de notitie, klant of het project met die naam bestaat.
 */
export const links = pgTable(
  "links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromKind: text("from_kind").notNull(), // note | source
    fromId: uuid("from_id").notNull(),
    targetKind: text("target_kind"), // note | client | project | source; leeg = automatisch
    targetKey: text("target_key").notNull(), // naam in kleine letters, zonder dubbele spaties
    label: text("label").notNull(), // zoals geschreven
    context: text("context"), // de regel waarin de link staat
    position: integer("position").notNull().default(0),
  },
  (t) => [index("links_from_idx").on(t.fromKind, t.fromId), index("links_target_idx").on(t.targetKey)],
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

/* ---------------- Urenregistratie ---------------- */

export const timeEntries = pgTable(
  "time_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    area: areaEnum("area").notNull().default("zakelijk"),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    // Afspraak waaronder de uren vallen (bij uurtarief: tarief en budget)
    agreementId: uuid("agreement_id").references(() => agreements.id, { onDelete: "set null" }),
    category: text("category"), // vrije soort werk: klantwerk, administratie, acquisitie, leren...
    description: text("description"),
    entryDate: date("entry_date").notNull(), // dag waarop de uren tellen
    startedAt: timestamp("started_at", { withTimezone: true }), // bij timer of ingevulde begintijd
    endedAt: timestamp("ended_at", { withTimezone: true }),
    durationMin: integer("duration_min"), // leeg = timer loopt nog
    billable: boolean("billable").notNull().default(false), // declarabel
    invoiced: boolean("invoiced").notNull().default(false), // gefactureerd
    installmentId: uuid("installment_id").references(() => installments.id, { onDelete: "set null" }), // termijn waarmee gefactureerd
    ...timestamps,
  },
  (t) => [
    index("time_entries_date_idx").on(t.entryDate),
    index("time_entries_client_idx").on(t.clientId),
    index("time_entries_project_idx").on(t.projectId),
    index("time_entries_agreement_idx").on(t.agreementId),
  ],
);

/* ---------------- Pipeline: leads en offertes ---------------- */

export const leadStatusEnum = pgEnum("lead_status", [
  "new", // nieuw
  "contact", // in gesprek
  "quoted", // offerte verstuurd
  "won", // gewonnen
  "lost", // verloren
]);

export const quoteStatusEnum = pgEnum("quote_status", [
  "draft", // concept
  "sent", // verstuurd
  "accepted", // akkoord
  "rejected", // afgewezen
  "expired", // verlopen
]);

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(), // waar gaat het over, bijv. "Nieuwe website met webshop"
    companyName: text("company_name").notNull(), // bedrijfsnaam (bij een bestaande klant: de klantnaam)
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }), // bestaande klant, of de klant die bij akkoord is aangemaakt
    contactName: text("contact_name"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    source: text("source"), // hoe binnengekomen
    interests: text("interests").array().notNull().default([]), // soorten dienst (service_kind)
    estimatedValueCents: integer("estimated_value_cents"), // geschatte waarde eerste jaar, excl. btw
    probabilityPct: integer("probability_pct").notNull().default(50), // kans in procenten
    nextStep: text("next_step"),
    nextStepDate: date("next_step_date"),
    status: leadStatusEnum("status").notNull().default("new"),
    lostReason: text("lost_reason"),
    closedAt: date("closed_at"), // gewonnen of verloren op
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [
    index("leads_status_idx").on(t.status),
    index("leads_client_idx").on(t.clientId),
    index("leads_next_step_idx").on(t.nextStepDate),
  ],
);

export const quotes = pgTable(
  "quotes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    number: text("number").notNull().unique(), // OFF-2026-001
    title: text("title"),
    quoteDate: date("quote_date").notNull(),
    validUntil: date("valid_until"),
    status: quoteStatusEnum("status").notNull().default("draft"),
    sentAt: date("sent_at"),
    decidedAt: date("decided_at"), // akkoord, afgewezen of verlopen op
    url: text("url"), // link naar het offertedocument (OneDrive, Drive...)
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [
    index("quotes_lead_idx").on(t.leadId),
    index("quotes_status_idx").on(t.status),
  ],
);

export const quoteLines = pgTable(
  "quote_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    kind: serviceKindEnum("kind").notNull(),
    description: text("description"),
    // Zelfde betekenis als bij een afspraak: centen excl. btw; bij uurtarief het tarief per uur
    amountCents: integer("amount_cents").notNull(),
    pricing: pricingEnum("pricing").notNull(),
    period: billingPeriodEnum("period"),
    budgetCents: integer("budget_cents"),
    sessionsPerMonth: integer("sessions_per_month"),
    domain: text("domain"), // website waar de regel bij hoort (website, hosting, beheer)
    startDate: date("start_date"), // leeg = datum van akkoord
    sortOrder: integer("sort_order").notNull().default(0),
    agreementId: uuid("agreement_id").references(() => agreements.id, { onDelete: "set null" }), // afspraak die bij akkoord is aangemaakt
    ...timestamps,
  },
  (t) => [index("quote_lines_quote_idx").on(t.quoteId)],
);

/* ---------------- Aangiftecyclus (boekhoudklanten) ---------------- */

export const filingKindEnum = pgEnum("filing_kind", [
  "vat", // btw (omzetbelasting)
  "income_tax", // inkomstenbelasting (IB)
  "corporate_tax", // vennootschapsbelasting (Vpb)
  "icp", // opgaaf intracommunautaire prestaties
  "payroll", // loonheffingen
  "other", // overig (eigen naam)
]);

export const filingExtensionEnum = pgEnum("filing_extension", [
  "none", // standaard termijn
  "individual", // uitstel aangevraagd (IB 4 maanden, Vpb 5 maanden)
  "becon", // becon-uitstel via fiscaal dienstverlener
]);

export const filingStatusEnum = pgEnum("filing_status", [
  "todo", // te doen
  "waiting_docs", // wacht op stukken van klant
  "in_progress", // in behandeling
  "review", // klaar voor controle
  "filed", // ingediend
  "done", // afgerond (betaald of ontvangen)
]);

/** Welke aangiftes Marc voor een klant doet, en hoe vaak. Hieruit ontstaan per periode aangifte-items. */
export const filingSchedules = pgTable(
  "filing_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    agreementId: uuid("agreement_id").references(() => agreements.id, { onDelete: "set null" }), // boekhoudafspraak; concept = nog geen items
    kind: filingKindEnum("kind").notNull(),
    label: text("label"), // eigen naam, vooral bij "overig"
    frequency: billingPeriodEnum("frequency").notNull(), // maand / kwartaal / jaar
    extension: filingExtensionEnum("extension").notNull().default("none"),
    startDate: date("start_date").notNull(), // eerste periode = de periode waarin deze datum valt
    endDate: date("end_date"), // laatste periode = de periode waarin deze datum valt
    docsDueDays: integer("docs_due_days"), // stukken binnen X dagen na einde periode (leeg = standaard)
    createTasks: boolean("create_tasks").notNull().default(true),
    active: boolean("active").notNull().default(true),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [index("filing_schedules_client_idx").on(t.clientId)],
);

/** Eén aangifte over één periode, met deadline en status. */
export const filings = pgTable(
  "filings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    scheduleId: uuid("schedule_id").references(() => filingSchedules.id, { onDelete: "set null" }),
    kind: filingKindEnum("kind").notNull(),
    label: text("label"),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    deadline: date("deadline").notNull(),
    deadlineManual: boolean("deadline_manual").notNull().default(false), // zelf aangepast: niet meer herberekenen
    docsDueDate: date("docs_due_date"), // stukken van de klant graag binnen op
    docsRequestedAt: date("docs_requested_at"), // stukken opgevraagd op
    docsReceivedAt: date("docs_received_at"),
    status: filingStatusEnum("status").notNull().default("todo"),
    filedAt: date("filed_at"),
    doneAt: date("done_at"),
    amountCents: integer("amount_cents"), // uitkomst: positief = te betalen, negatief = terug te ontvangen
    reference: text("reference"), // betalingskenmerk of kenmerk aangifte
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    taskCreated: boolean("task_created").notNull().default(false), // taak is ooit aangemaakt (ook als die later is verwijderd)
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [
    index("filings_client_idx").on(t.clientId),
    index("filings_deadline_idx").on(t.deadline),
    index("filings_status_idx").on(t.status),
    uniqueIndex("filings_schedule_period_uq").on(t.scheduleId, t.periodStart),
  ],
);

export const reviews = pgTable("reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: reviewKindEnum("kind").notNull(),
  periodDate: date("period_date").notNull(), // dag, maandag van de week, of 1e van de maand
  body: text("body").notNull(),
  ...timestamps,
});

/** Instellingen van de app als sleutel/waarde (bijv. welke modules aan staan). */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

/** Telefoons en browsers die pushmeldingen ontvangen (Web Push). */
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  /** Korte naam van het apparaat, bijv. "iPhone" of "Mac (Safari)" */
  label: text("label").notNull(),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastError: text("last_error"),
  failures: integer("failures").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* Leven 1 (gesprek 8): dagritme, gewoontes en agenda-links            */
/* ------------------------------------------------------------------ */

/**
 * Dagritme-sjabloon (bijv. werkdag, vrijdag, weekend).
 * `weekdays`: ISO-weekdagen (1 = maandag ... 7 = zondag) waarop dit ritme standaard geldt; een dag hoort bij hooguit één ritme.
 * `workStart`/`workEnd`: de werkdag voor "nog vrij" op de tijdlijn; leeg = geen werkdag (weekend).
 */
export const rhythms = pgTable("rhythms", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  weekdays: integer("weekdays").array().notNull().default([]),
  workStart: text("work_start"),
  workEnd: text("work_end"),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
});

/** Vast blok in een dagritme: dagstart, diep werk, administratie, sport, pauze, dagafsluiting ... */
export const rhythmBlocks = pgTable(
  "rhythm_blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rhythmId: uuid("rhythm_id")
      .notNull()
      .references(() => rhythms.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    kind: text("kind").notNull().default("overig"),
    area: areaEnum("area"),
    startTime: text("start_time").notNull(), // HH:mm
    endTime: text("end_time").notNull(),
    /** Pushmelding bij het begin (of `remindBefore` minuten ervoor) */
    remind: boolean("remind").notNull().default(false),
    remindBefore: integer("remind_before").notNull().default(0),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [index("rhythm_blocks_rhythm_idx").on(t.rhythmId)],
);

/** Ander ritme voor één datum (bijv. vrije dag of een werkdag op zaterdag). rhythmId leeg = vrije dag zonder blokken. */
export const rhythmOverrides = pgTable("rhythm_overrides", {
  date: date("date").primaryKey(),
  rhythmId: uuid("rhythm_id").references(() => rhythms.id, { onDelete: "cascade" }),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Gewoonte. Frequentie: daily (elke dag), weekly (x keer per week, `timesPerWeek`) of days (vaste weekdagen, `weekdays` 1-7).
 * Optioneel gekoppeld aan een dagritmeblok. `archivedAt` = gestopt (historie blijft).
 */
export const habits = pgTable("habits", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  area: areaEnum("area").notNull().default("prive"),
  frequency: text("frequency").notNull().default("daily"),
  timesPerWeek: integer("times_per_week"),
  weekdays: integer("weekdays").array().notNull().default([]),
  blockId: uuid("block_id").references(() => rhythmBlocks.id, { onDelete: "set null" }),
  startDate: date("start_date").notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  sortOrder: integer("sort_order").notNull().default(0),
  notes: text("notes"),
  /** Automatisch afvinken uit Apple Health (gesprek 9), bijv. {"metric":"workout","min":1}. Leeg = alleen met de hand. */
  healthRule: jsonb("health_rule").$type<HealthRule | null>(),
  ...timestamps,
});

/** Regel om een gewoonte automatisch af te vinken uit gezondheidsdata. */
export type HealthRule = {
  /** workout = aantal trainingen, steps = stappen, exercise = beweegminuten, active_energy = actieve kcal, sleep = uren slaap */
  metric: "workout" | "steps" | "exercise" | "active_energy" | "sleep";
  /** Drempel: aantal trainingen, stappen, minuten, kcal of uren */
  min: number;
  /** Alleen bij workout: soort training (kracht, cardio, ...) en minimale duur in minuten */
  kind?: string | null;
  minMinutes?: number | null;
};

/** Eén keer afgevinkt op een dag. `source`: app, mcp, whatsapp, health (gesprek 9). */
export const habitChecks = pgTable(
  "habit_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    habitId: uuid("habit_id")
      .notNull()
      .references(() => habits.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    source: text("source").notNull().default("app"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("habit_checks_habit_date_uq").on(t.habitId, t.date), index("habit_checks_date_idx").on(t.date)],
);

/** Agenda-link (ICS, alleen lezen), in de app toe te voegen. De URL is geheim. */
export const calendarFeeds = pgTable("calendar_feeds", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  active: boolean("active").notNull().default(true),
  lastOkAt: timestamp("last_ok_at", { withTimezone: true }),
  lastError: text("last_error"),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
});

/* ------------------------------------------------------------------ */
/* Gezondheid (gesprek 9): Apple Health via Health Auto Export          */
/* ------------------------------------------------------------------ */

/**
 * Meetwaarde uit Apple Health (stappen, actieve energie, voeding, gewicht ...), omgerekend naar vaste eenheden
 * (kcal, kg, g, ml, km, min). Per dag of per uur, zoals Health Auto Export het stuurt. Opnieuw sturen overschrijft.
 */
export const healthSamples = pgTable(
  "health_samples",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    metric: text("metric").notNull(),
    /** Lokale datum waar de waarde bij hoort */
    date: date("date").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    qty: doublePrecision("qty").notNull(),
    unit: text("unit").notNull(),
    source: text("source").notNull().default(""),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("health_samples_uq").on(t.metric, t.at), index("health_samples_date_idx").on(t.date, t.metric)],
);

/** Slaap per nacht (datum = de dag waarop je wakker wordt). Minuten. */
export const healthSleep = pgTable("health_sleep", {
  date: date("date").primaryKey(),
  totalMin: integer("total_min").notNull(),
  deepMin: integer("deep_min"),
  remMin: integer("rem_min"),
  coreMin: integer("core_min"),
  awakeMin: integer("awake_min"),
  inBedMin: integer("in_bed_min"),
  sleepStart: timestamp("sleep_start", { withTimezone: true }),
  sleepEnd: timestamp("sleep_end", { withTimezone: true }),
  source: text("source"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Training: uit Apple Health (source health) of met de hand in de app (source app/mcp). */
export const healthWorkouts = pgTable(
  "health_workouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Id uit Health Auto Export (of naam + start); leeg bij handmatig */
    externalId: text("external_id"),
    name: text("name").notNull(),
    /** kracht, cardio, hardlopen, fietsen, wandelen, zwemmen, yoga, sport, overig */
    kind: text("kind").notNull().default("overig"),
    date: date("date").notNull(),
    startAt: timestamp("start_at", { withTimezone: true }),
    durationMin: integer("duration_min").notNull(),
    activeKcal: integer("active_kcal"),
    distanceKm: doublePrecision("distance_km"),
    avgHr: integer("avg_hr"),
    maxHr: integer("max_hr"),
    source: text("source").notNull().default("health"),
    /** App die de training vastlegde (bijv. Virtuagym, Apple Watch) */
    device: text("device"),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [uniqueIndex("health_workouts_external_uq").on(t.externalId), index("health_workouts_date_idx").on(t.date)],
);

/** Logboek van ontvangen zendingen, voor de status op Instellingen. */
export const healthImports = pgTable("health_imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  samples: integer("samples").notNull().default(0),
  workouts: integer("workouts").notNull().default(0),
  sleep: integer("sleep").notNull().default(0),
  fromDate: date("from_date"),
  toDate: date("to_date"),
  /** Namen van metingen die niet herkend zijn (genegeerd) */
  skipped: text("skipped").array().notNull().default([]),
  error: text("error"),
});

/* ------------------------------------------------------------------ */
/* Leven 3 (gesprek 10): doelen en leren                                */
/* ------------------------------------------------------------------ */

/**
 * Doel met een meetwijze en on-track-status.
 * - area: zakelijk, prive, gezondheid, leren
 * - periodKind: year, quarter, month of custom (eigen start en einde)
 * - measure: auto (uit de app of gezondheid, zie `source`), habit, manual (handmatig getal), milestones, subgoals
 * - targetPer: bij optellende bronnen het doel per day/week/month in plaats van over de hele periode
 * - curve: linear, late (rustige start) of early (snelle start): het verwachte verloop binnen de periode
 * Alle getallen in gewone eenheden (euro's, uren, kg), niet in centen.
 */
export const goals = pgTable(
  "goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    area: text("area").notNull().default("zakelijk"),
    periodKind: text("period_kind").notNull().default("year"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => goals.id, { onDelete: "set null" }),
    measure: text("measure").notNull().default("manual"),
    source: text("source"),
    habitId: uuid("habit_id").references(() => habits.id, { onDelete: "set null" }),
    learningId: uuid("learning_id").references(() => learningTopics.id, { onDelete: "set null" }),
    targetValue: doublePrecision("target_value"),
    startValue: doublePrecision("start_value"),
    unit: text("unit"),
    targetPer: text("target_per"),
    direction: text("direction"),
    curve: text("curve").notNull().default("linear"),
    /** In de doelbalk van de cockpit (hooguit één) */
    featured: boolean("featured").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    sortOrder: integer("sort_order").notNull().default(0),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [index("goals_parent_idx").on(t.parentId)],
);

/** Handmatige meting bij een doel (bijv. LinkedIn-volgers). Eén per dag; opnieuw invullen overschrijft. */
export const goalEntries = pgTable(
  "goal_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => goals.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    value: doublePrecision("value").notNull(),
    note: text("note"),
    source: text("source").notNull().default("app"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("goal_entries_goal_date_uq").on(t.goalId, t.date)],
);

/** Mijlpaal: losse stap of een gekoppeld project (klaar als het project is afgerond). */
export const goalMilestones = pgTable(
  "goal_milestones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => goals.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    dueDate: date("due_date"),
    done: boolean("done").notNull().default(false),
    doneAt: date("done_at"),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("goal_milestones_goal_idx").on(t.goalId)],
);

/**
 * Leeronderwerp: cursus, boek, vaardigheid of certificering.
 * Voortgang: met `progressUnit` (bijv. hoofdstukken) als `progressDone` van `progressTotal`, anders `progressDone` als percentage.
 * Status: idee, bezig, gepauzeerd, afgerond.
 */
export const learningTopics = pgTable("learning_topics", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  kind: text("kind").notNull().default("cursus"),
  area: areaEnum("area").notNull().default("zakelijk"),
  status: text("status").notNull().default("bezig"),
  goal: text("goal"),
  url: text("url"),
  progressDone: doublePrecision("progress_done").notNull().default(0),
  progressTotal: doublePrecision("progress_total"),
  progressUnit: text("progress_unit"),
  hoursTarget: doublePrecision("hours_target"),
  startDate: date("start_date"),
  targetDate: date("target_date"),
  finishedAt: date("finished_at"),
  /** Aantekeningen in markdown, met [[links]] */
  notes: text("notes"),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
});

/** Tijd besteed aan een leeronderwerp. `source`: app, mcp, whatsapp. */
export const learningSessions = pgTable(
  "learning_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    topicId: uuid("topic_id")
      .notNull()
      .references(() => learningTopics.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    minutes: integer("minutes").notNull(),
    note: text("note"),
    source: text("source").notNull().default("app"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("learning_sessions_topic_idx").on(t.topicId), index("learning_sessions_date_idx").on(t.date)],
);

export type Client = typeof clients.$inferSelect;
export type ClientContact = typeof clientContacts.$inferSelect;
export type Website = typeof websites.$inferSelect;
export type ClientDocument = typeof clientDocuments.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type Note = typeof notes.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type Source = typeof sources.$inferSelect;
export type Link = typeof links.$inferSelect;
export type Agreement = typeof agreements.$inferSelect;
export type Installment = typeof installments.$inferSelect;
export type TimeEntry = typeof timeEntries.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type Quote = typeof quotes.$inferSelect;
export type QuoteLine = typeof quoteLines.$inferSelect;
export type FilingSchedule = typeof filingSchedules.$inferSelect;
export type Filing = typeof filings.$inferSelect;
export type Rhythm = typeof rhythms.$inferSelect;
export type RhythmBlock = typeof rhythmBlocks.$inferSelect;
export type Habit = typeof habits.$inferSelect;
export type HabitCheck = typeof habitChecks.$inferSelect;
export type CalendarFeed = typeof calendarFeeds.$inferSelect;
export type HealthWorkout = typeof healthWorkouts.$inferSelect;
export type HealthSleep = typeof healthSleep.$inferSelect;
export type HealthImport = typeof healthImports.$inferSelect;
export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
export type Goal = typeof goals.$inferSelect;
export type GoalEntry = typeof goalEntries.$inferSelect;
export type GoalMilestone = typeof goalMilestones.$inferSelect;
export type LearningTopic = typeof learningTopics.$inferSelect;
export type LearningSession = typeof learningSessions.$inferSelect;

/* ---------------- Hermes (gesprek 12) ---------------- */

/**
 * Akkoordwachtrij: een schrijfactie die Hermes wil doen, opgeslagen als MCP-aanroep (tool + argumenten).
 * Na akkoord voert Marc OS de aanroep zelf uit. Status: pending → executed / failed / rejected / withdrawn.
 */
export const agentProposals = pgTable(
  "agent_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Kort volgnummer voor WhatsApp ("ja 12", gesprek 13) */
    nr: serial("nr").notNull(),
    actor: text("actor").notNull().default("hermes"),
    tool: text("tool").notNull(),
    args: jsonb("args").notNull(),
    title: text("title").notNull(),
    /** Korte uitleg van Hermes waarom */
    reason: text("reason"),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** Waar besloten: app, chat, cockpit, whatsapp */
    decidedVia: text("decided_via"),
    decisionNote: text("decision_note"),
    /** Argumenten zijn voor akkoord door Marc aangepast */
    edited: boolean("edited").notNull().default(false),
    result: jsonb("result"),
    error: text("error"),
  },
  (t) => [index("agent_proposals_status_idx").on(t.status, t.createdAt), uniqueIndex("agent_proposals_nr_uq").on(t.nr)],
);

/** Logboek van alles wat Hermes (en Claude via MCP) doet: lezen, voorstellen, akkoord, uitvoeren. Voor ISO 27001. */
export const agentLog = pgTable(
  "agent_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    /** hermes, claude of marc */
    actor: text("actor").notNull(),
    /** read, direct (zonder akkoord uitgevoerd), proposed, approved, rejected, withdrawn, executed, failed, chat */
    kind: text("kind").notNull(),
    tool: text("tool"),
    summary: text("summary").notNull(),
    proposalId: uuid("proposal_id"),
    detail: jsonb("detail"),
  },
  (t) => [index("agent_log_at_idx").on(t.at)],
);

/** Chatgesprekken met Hermes in de app. De geschiedenis voor het model houdt Hermes zelf bij (conversation). */
export const chatThreads = pgTable("chat_threads", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull().default("Nieuw gesprek"),
  ...timestamps,
});

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => chatThreads.id, { onDelete: "cascade" }),
    /** user of assistant */
    role: text("role").notNull(),
    content: text("content").notNull(),
    /** Tools die Hermes in dit antwoord gebruikte (namen) */
    tools: jsonb("tools").$type<string[]>(),
    /** Voorstellen die tijdens dit antwoord zijn gemaakt */
    proposalIds: jsonb("proposal_ids").$type<string[]>(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("chat_messages_thread_idx").on(t.threadId, t.createdAt)],
);

/**
 * Vaste routines van Hermes (gesprek 13): elke run met status, voor de cockpit en het logboek.
 * Per routine en periode hooguit één geplande run (unieke index op routine + periode voor trigger "schedule").
 */
export const agentRoutineRuns = pgTable(
  "agent_routine_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** briefing, dagafsluiting, weekreview, maandafsluiting, aangiftecheck */
    routine: text("routine").notNull(),
    /** Datum van de dag, maandag van de week of 1e van de maand (YYYY-MM-DD) */
    period: date("period").notNull(),
    /** schedule (cron) of manual (knop "Nu draaien") */
    trigger: text("trigger").notNull().default("schedule"),
    /** running, ok, failed */
    status: text("status").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** Eerste regels van het antwoord */
    summary: text("summary"),
    error: text("error"),
    reviewId: uuid("review_id"),
    /** Tools die Hermes gebruikte */
    tools: jsonb("tools").$type<string[]>(),
    /** Voorstellen die tijdens de run zijn gedaan */
    proposalIds: jsonb("proposal_ids").$type<string[]>(),
    /** Afgeleverd: { whatsapp: "ok" | fout, push: "ok" | reden } */
    delivered: jsonb("delivered").$type<Record<string, string>>(),
  },
  (t) => [
    index("agent_routine_runs_started_idx").on(t.startedAt),
    uniqueIndex("agent_routine_runs_schedule_uq").on(t.routine, t.period).where(sql`${t.trigger} = 'schedule'`),
  ],
);

export type AgentProposal = typeof agentProposals.$inferSelect;
export type AgentRoutineRun = typeof agentRoutineRuns.$inferSelect;
export type AgentLogRow = typeof agentLog.$inferSelect;
export type ChatThread = typeof chatThreads.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
