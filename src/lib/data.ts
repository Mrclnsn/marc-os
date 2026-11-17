import "server-only";
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, lte, ne, or, sql, gte } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { clients, notes, projects, reviews, tasks, type Task } from "@/db/schema";
import { addDaysIso, nextOccurrence, today, type Recurrence } from "./dates";

/* ------------------------------------------------------------------ */
/* Invoerschema's (gedeeld door formulieren en de MCP-server)          */
/* ------------------------------------------------------------------ */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Gebruik YYYY-MM-DD");
const optDate = isoDate.nullable().optional();
const optId = z.string().uuid().nullable().optional();
const optText = z.string().nullable().optional();

export const areaSchema = z.enum(["zakelijk", "prive"]);
export const taskStatusSchema = z.enum(["todo", "doing", "waiting", "done"]);
export const recurrenceSchema = z.enum(["none", "daily", "weekdays", "weekly", "monthly", "quarterly", "yearly"]);
export const projectStatusSchema = z.enum(["idea", "planned", "active", "waiting", "done", "archived"]);
export const clientStatusSchema = z.enum(["lead", "active", "on_hold", "past"]);
export const noteTypeSchema = z.enum(["inbox", "note", "meeting", "call", "email", "decision", "info", "idea"]);
export const reviewKindSchema = z.enum(["day", "week", "month"]);

export const taskInput = z.object({
  title: z.string().min(1),
  area: areaSchema.optional(),
  clientId: optId,
  projectId: optId,
  status: taskStatusSchema.optional(),
  planDate: optDate,
  dueDate: optDate,
  priority: z.number().int().min(1).max(3).optional(),
  estimateMin: z.number().int().positive().nullable().optional(),
  recurrence: recurrenceSchema.optional(),
  notes: optText,
});
export type TaskInput = z.infer<typeof taskInput>;

export const projectInput = z.object({
  name: z.string().min(1),
  area: areaSchema.optional(),
  clientId: optId,
  status: projectStatusSchema.optional(),
  startDate: optDate,
  dueDate: optDate,
  description: optText,
});
export type ProjectInput = z.infer<typeof projectInput>;

export const clientInput = z.object({
  name: z.string().min(1),
  contactPerson: optText,
  email: optText,
  phone: optText,
  status: clientStatusSchema.optional(),
  info: optText,
});
export type ClientInput = z.infer<typeof clientInput>;

export const noteInput = z.object({
  title: z.string().min(1),
  body: optText,
  type: noteTypeSchema.optional(),
  area: areaSchema.nullable().optional(),
  clientId: optId,
  projectId: optId,
  noteDate: optDate,
});
export type NoteInput = z.infer<typeof noteInput>;

/* ------------------------------------------------------------------ */
/* Taken                                                               */
/* ------------------------------------------------------------------ */

export type TaskWithRefs = Task & { clientName: string | null; projectName: string | null };

const taskSelect = {
  task: tasks,
  clientName: clients.name,
  projectName: projects.name,
};

function withRefs(rows: { task: Task; clientName: string | null; projectName: string | null }[]): TaskWithRefs[] {
  return rows.map((r) => ({ ...r.task, clientName: r.clientName, projectName: r.projectName }));
}

export type TaskView = "today" | "overdue" | "upcoming" | "open" | "someday" | "done" | "all";

export type TaskFilter = {
  view?: TaskView;
  area?: "zakelijk" | "prive";
  clientId?: string;
  projectId?: string;
  /** "general" = zakelijk zonder klant */
  general?: boolean;
  search?: string;
  days?: number; // voor upcoming
  limit?: number;
};

export async function listTasks(filter: TaskFilter = {}): Promise<TaskWithRefs[]> {
  const t = today();
  const conds = [];
  const view = filter.view ?? "open";

  // "Wanneer" = planDate, anders dueDate
  const when = sql`coalesce(${tasks.planDate}, ${tasks.dueDate})`;

  switch (view) {
    case "today":
      conds.push(ne(tasks.status, "done"), sql`${when} <= ${t}`);
      break;
    case "overdue":
      conds.push(ne(tasks.status, "done"), sql`${when} < ${t}`);
      break;
    case "upcoming":
      conds.push(
        ne(tasks.status, "done"),
        sql`${when} > ${t}`,
        sql`${when} <= ${addDaysIso(t, filter.days ?? 7)}`,
      );
      break;
    case "someday":
      conds.push(ne(tasks.status, "done"), isNull(tasks.planDate), isNull(tasks.dueDate));
      break;
    case "open":
      conds.push(ne(tasks.status, "done"));
      break;
    case "done":
      conds.push(eq(tasks.status, "done"));
      break;
  }
  if (filter.area) conds.push(eq(tasks.area, filter.area));
  if (filter.clientId) conds.push(eq(tasks.clientId, filter.clientId));
  if (filter.projectId) conds.push(eq(tasks.projectId, filter.projectId));
  if (filter.general) conds.push(eq(tasks.area, "zakelijk"), isNull(tasks.clientId));
  if (filter.search) conds.push(ilike(tasks.title, `%${filter.search}%`));

  const order =
    view === "done"
      ? [desc(tasks.completedAt)]
      : [sql`${when} asc nulls last`, asc(tasks.priority), asc(tasks.createdAt)];

  const rows = await db
    .select(taskSelect)
    .from(tasks)
    .leftJoin(clients, eq(tasks.clientId, clients.id))
    .leftJoin(projects, eq(tasks.projectId, projects.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(...order)
    .limit(filter.limit ?? 500);
  return withRefs(rows);
}

export async function getTask(id: string): Promise<TaskWithRefs | null> {
  const rows = await db
    .select(taskSelect)
    .from(tasks)
    .leftJoin(clients, eq(tasks.clientId, clients.id))
    .leftJoin(projects, eq(tasks.projectId, projects.id))
    .where(eq(tasks.id, id));
  return withRefs(rows)[0] ?? null;
}

/** Als een taak aan een project hangt, neem dan klant en gebied van het project over. */
async function inheritFromProject<T extends { projectId?: string | null; clientId?: string | null; area?: "zakelijk" | "prive" }>(input: T): Promise<T> {
  if (!input.projectId) return input;
  const [p] = await db.select().from(projects).where(eq(projects.id, input.projectId));
  if (!p) return input;
  return {
    ...input,
    clientId: input.clientId ?? p.clientId,
    area: input.area ?? p.area,
  };
}

export async function createTask(input: TaskInput) {
  const data = await inheritFromProject(taskInput.parse(input));
  const [row] = await db
    .insert(tasks)
    .values({ ...data, completedAt: data.status === "done" ? new Date() : null })
    .returning();
  return row;
}

export async function updateTask(id: string, patch: Partial<TaskInput>) {
  const data = await inheritFromProject(taskInput.partial().parse(patch));
  const [row] = await db.update(tasks).set(data).where(eq(tasks.id, id)).returning();
  if (!row) throw new Error("Taak niet gevonden");
  if (data.status === "done") return completeTask(id);
  if (data.status && row.completedAt) {
    await db.update(tasks).set({ completedAt: null }).where(eq(tasks.id, id));
  }
  return row;
}

/**
 * Rondt een taak af. Bij een terugkerende taak wordt de volgende keer
 * automatisch aangemaakt (de afgeronde taak blijft bewaard als historie).
 */
export async function completeTask(id: string) {
  const [row] = await db
    .update(tasks)
    .set({ status: "done", completedAt: new Date() })
    .where(eq(tasks.id, id))
    .returning();
  if (!row) throw new Error("Taak niet gevonden");

  let next = null;
  if (row.recurrence !== "none") {
    const base = row.planDate ?? row.dueDate ?? today();
    // Nooit een volgende keer in het verleden plannen
    let nextPlan = nextOccurrence(base, row.recurrence as Recurrence)!;
    while (nextPlan <= today()) nextPlan = nextOccurrence(nextPlan, row.recurrence as Recurrence)!;
    const shift = row.dueDate && row.planDate ? daysDiff(row.planDate, row.dueDate) : null;
    [next] = await db
      .insert(tasks)
      .values({
        title: row.title,
        area: row.area,
        clientId: row.clientId,
        projectId: row.projectId,
        priority: row.priority,
        estimateMin: row.estimateMin,
        recurrence: row.recurrence,
        notes: row.notes,
        planDate: row.planDate || !row.dueDate ? nextPlan : null,
        dueDate: row.dueDate ? (shift !== null ? addDaysIso(nextPlan, shift) : nextPlan) : null,
      })
      .returning();
  }
  return { completed: row, next };
}

function daysDiff(a: string, b: string) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

export async function reopenTask(id: string) {
  const [row] = await db
    .update(tasks)
    .set({ status: "todo", completedAt: null })
    .where(eq(tasks.id, id))
    .returning();
  return row;
}

export async function deleteTask(id: string) {
  await db.delete(tasks).where(eq(tasks.id, id));
}

/* ------------------------------------------------------------------ */
/* Projecten                                                           */
/* ------------------------------------------------------------------ */

export async function listProjects(filter: { area?: "zakelijk" | "prive"; clientId?: string; general?: boolean; includeClosed?: boolean } = {}) {
  const conds = [];
  if (!filter.includeClosed) conds.push(inArray(projects.status, ["idea", "planned", "active", "waiting"]));
  if (filter.area) conds.push(eq(projects.area, filter.area));
  if (filter.clientId) conds.push(eq(projects.clientId, filter.clientId));
  if (filter.general) conds.push(eq(projects.area, "zakelijk"), isNull(projects.clientId));

  const openCount = sql<number>`(select count(*)::int from ${tasks} where ${tasks.projectId} = ${projects.id} and ${tasks.status} <> 'done')`;
  const doneCount = sql<number>`(select count(*)::int from ${tasks} where ${tasks.projectId} = ${projects.id} and ${tasks.status} = 'done')`;

  return db
    .select({ project: projects, clientName: clients.name, openTasks: openCount, doneTasks: doneCount })
    .from(projects)
    .leftJoin(clients, eq(projects.clientId, clients.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(sql`${projects.dueDate} asc nulls last`, asc(projects.name));
}

export async function getProject(id: string) {
  const [row] = await db
    .select({ project: projects, clientName: clients.name })
    .from(projects)
    .leftJoin(clients, eq(projects.clientId, clients.id))
    .where(eq(projects.id, id));
  return row ?? null;
}

export async function createProject(input: ProjectInput) {
  const data = projectInput.parse(input);
  const [row] = await db.insert(projects).values(data).returning();
  return row;
}

export async function updateProject(id: string, patch: Partial<ProjectInput>) {
  const data = projectInput.partial().parse(patch);
  const [row] = await db.update(projects).set(data).where(eq(projects.id, id)).returning();
  return row;
}

export async function deleteProject(id: string) {
  await db.delete(projects).where(eq(projects.id, id));
}

/* ------------------------------------------------------------------ */
/* Klanten                                                             */
/* ------------------------------------------------------------------ */

export async function listClients(filter: { includePast?: boolean } = {}) {
  const openTasks = sql<number>`(select count(*)::int from ${tasks} where ${tasks.clientId} = ${clients.id} and ${tasks.status} <> 'done')`;
  const activeProjects = sql<number>`(select count(*)::int from ${projects} where ${projects.clientId} = ${clients.id} and ${projects.status} in ('planned','active','waiting'))`;
  return db
    .select({ client: clients, openTasks, activeProjects })
    .from(clients)
    .where(filter.includePast ? undefined : ne(clients.status, "past"))
    .orderBy(asc(clients.name));
}

export async function getClient(id: string) {
  const [row] = await db.select().from(clients).where(eq(clients.id, id));
  return row ?? null;
}

export async function findClientByName(name: string) {
  const [row] = await db.select().from(clients).where(ilike(clients.name, `%${name}%`)).limit(1);
  return row ?? null;
}

export async function createClient(input: ClientInput) {
  const data = clientInput.parse(input);
  const [row] = await db.insert(clients).values(data).returning();
  return row;
}

export async function updateClient(id: string, patch: Partial<ClientInput>) {
  const data = clientInput.partial().parse(patch);
  const [row] = await db.update(clients).set(data).where(eq(clients.id, id)).returning();
  return row;
}

export async function deleteClient(id: string) {
  await db.delete(clients).where(eq(clients.id, id));
}

/* ------------------------------------------------------------------ */
/* Notities en inbox                                                   */
/* ------------------------------------------------------------------ */

export async function listNotes(filter: { type?: z.infer<typeof noteTypeSchema>; excludeInbox?: boolean; clientId?: string; projectId?: string; area?: "zakelijk" | "prive"; search?: string; limit?: number } = {}) {
  const conds = [];
  if (filter.type) conds.push(eq(notes.type, filter.type));
  if (filter.excludeInbox) conds.push(ne(notes.type, "inbox"));
  if (filter.clientId) conds.push(eq(notes.clientId, filter.clientId));
  if (filter.projectId) conds.push(eq(notes.projectId, filter.projectId));
  if (filter.area) conds.push(eq(notes.area, filter.area));
  if (filter.search) conds.push(or(ilike(notes.title, `%${filter.search}%`), ilike(notes.body, `%${filter.search}%`)));
  return db
    .select({ note: notes, clientName: clients.name, projectName: projects.name })
    .from(notes)
    .leftJoin(clients, eq(notes.clientId, clients.id))
    .leftJoin(projects, eq(notes.projectId, projects.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(sql`coalesce(${notes.noteDate}::timestamptz, ${notes.createdAt}) desc`)
    .limit(filter.limit ?? 200);
}

export async function getNote(id: string) {
  const [row] = await db
    .select({ note: notes, clientName: clients.name, projectName: projects.name })
    .from(notes)
    .leftJoin(clients, eq(notes.clientId, clients.id))
    .leftJoin(projects, eq(notes.projectId, projects.id))
    .where(eq(notes.id, id));
  return row ?? null;
}

export async function createNote(input: NoteInput) {
  const data = noteInput.parse(input);
  const [row] = await db
    .insert(notes)
    .values({ ...data, noteDate: data.noteDate ?? (data.type && data.type !== "inbox" ? today() : null) })
    .returning();
  return row;
}

/** Snel iets in de inbox gooien (braindump). */
export async function capture(text: string) {
  const trimmed = text.trim();
  const [first, ...rest] = trimmed.split("\n");
  return createNote({ title: first.slice(0, 200), body: rest.join("\n").trim() || null, type: "inbox" });
}

export async function updateNote(id: string, patch: Partial<NoteInput>) {
  const data = noteInput.partial().parse(patch);
  const [row] = await db.update(notes).set(data).where(eq(notes.id, id)).returning();
  return row;
}

export async function deleteNote(id: string) {
  await db.delete(notes).where(eq(notes.id, id));
}

/** Zet een inbox-item om naar een taak en verwijdert het inbox-item. */
export async function inboxToTask(noteId: string, extra: Partial<TaskInput> = {}) {
  const [n] = await db.select().from(notes).where(eq(notes.id, noteId));
  if (!n) throw new Error("Inbox-item niet gevonden");
  const task = await createTask({
    title: n.title,
    notes: n.body,
    area: n.area ?? undefined,
    clientId: n.clientId,
    projectId: n.projectId,
    ...extra,
  });
  await deleteNote(noteId);
  return task;
}

/* ------------------------------------------------------------------ */
/* Reviews                                                             */
/* ------------------------------------------------------------------ */

export async function listReviews(kind?: z.infer<typeof reviewKindSchema>, limit = 30) {
  return db
    .select()
    .from(reviews)
    .where(kind ? eq(reviews.kind, kind) : undefined)
    .orderBy(desc(reviews.periodDate))
    .limit(limit);
}

export async function saveReview(kind: z.infer<typeof reviewKindSchema>, periodDate: string, body: string, append = false) {
  const [existing] = await db
    .select()
    .from(reviews)
    .where(and(eq(reviews.kind, kind), eq(reviews.periodDate, periodDate)));
  if (existing) {
    const next = append ? `${existing.body}\n\n---\n\n${body}` : body;
    const [row] = await db.update(reviews).set({ body: next }).where(eq(reviews.id, existing.id)).returning();
    return row;
  }
  const [row] = await db.insert(reviews).values({ kind, periodDate, body }).returning();
  return row;
}

/* ------------------------------------------------------------------ */
/* Overzichten                                                         */
/* ------------------------------------------------------------------ */

export async function completedBetween(fromIso: string, toIso: string) {
  return db
    .select(taskSelect)
    .from(tasks)
    .leftJoin(clients, eq(tasks.clientId, clients.id))
    .leftJoin(projects, eq(tasks.projectId, projects.id))
    .where(
      and(
        eq(tasks.status, "done"),
        isNotNull(tasks.completedAt),
        gte(tasks.completedAt, new Date(`${fromIso}T00:00:00`)),
        lte(tasks.completedAt, new Date(`${toIso}T23:59:59`)),
      ),
    )
    .orderBy(asc(tasks.completedAt))
    .then(withRefs);
}

export async function inboxCount() {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(notes).where(eq(notes.type, "inbox"));
  return r?.n ?? 0;
}
