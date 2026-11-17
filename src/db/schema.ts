import {
  pgTable,
  uuid,
  text,
  timestamp,
  date,
  integer,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";

export const areaEnum = pgEnum("area", ["zakelijk", "prive"]);

export const clientStatusEnum = pgEnum("client_status", [
  "lead",
  "active",
  "on_hold",
  "past",
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
  name: text("name").notNull(), // bedrijfsnaam
  contactPerson: text("contact_person"),
  email: text("email"),
  phone: text("phone"),
  status: clientStatusEnum("status").notNull().default("active"),
  info: text("info"), // vaste informatie, markdown
  ...timestamps,
});

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

export const reviews = pgTable("reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: reviewKindEnum("kind").notNull(),
  periodDate: date("period_date").notNull(), // dag, maandag van de week, of 1e van de maand
  body: text("body").notNull(),
  ...timestamps,
});

export type Client = typeof clients.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type Note = typeof notes.$inferSelect;
export type Review = typeof reviews.$inferSelect;
