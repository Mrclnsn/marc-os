import "server-only";
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, lte, ne, or, sql, gte } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { clientContacts, clientDocuments, clients, notes, projects, reviews, tasks, websites, type Task } from "@/db/schema";
import { addDaysIso, nextOccurrence, today, type Recurrence } from "./dates";
import { listAgreements, listInstallments, markProjectDelivered } from "./agreements";
import { onTaskCompleted, onTaskReopened } from "./filings";

export * from "./agreements";
export * from "./time";
export * from "./pipeline";
export * from "./filings";

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
export const dpaStatusSchema = z.enum(["not_applicable", "needed", "sent", "signed"]);
export const documentKindSchema = z.enum(["quote", "agreement", "dpa", "other"]);
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
  legalForm: optText,
  status: clientStatusSchema.optional(),
  clientSince: optDate,
  source: optText,
  kvkNumber: optText,
  vatNumber: optText,
  address: optText,
  postcode: optText,
  city: optText,
  country: z.string().min(2).optional(),
  invoiceAddress: optText,
  invoicePostcode: optText,
  invoiceCity: optText,
  invoiceCountry: optText,
  invoiceEmail: optText,
  paymentTermDays: z.number().int().min(0).max(365).optional(),
  moneybirdContactId: optText,
  dpaStatus: dpaStatusSchema.optional(),
  dpaDate: optDate,
  personalData: optText,
  vaultRef: optText,
  tags: z.array(z.string().min(1)).optional(),
  info: optText,
});
export type ClientInput = z.infer<typeof clientInput>;

export const contactInput = z.object({
  clientId: z.string().uuid(),
  name: z.string().min(1),
  role: optText,
  email: optText,
  phone: optText,
  isPrimary: z.boolean().optional(),
  notes: optText,
});
export type ContactInput = z.infer<typeof contactInput>;

export const websiteInput = z.object({
  clientId: z.string().uuid(),
  domain: z.string().min(1),
  registrar: optText,
  domainExpiresAt: optDate,
  hostingLocation: optText,
  cms: optText,
  liveDate: optDate,
  hostingByUs: z.boolean().optional(),
  maintenanceByUs: z.boolean().optional(),
  notes: optText,
});
export type WebsiteInput = z.infer<typeof websiteInput>;

export const documentInput = z.object({
  clientId: z.string().uuid(),
  kind: documentKindSchema.optional(),
  title: z.string().min(1),
  url: optText,
  docDate: optDate,
  notes: optText,
});
export type DocumentInput = z.infer<typeof documentInput>;

/** Tags netjes maken: getrimd, kleine letters, uniek. */
export function cleanTags(tags: string[] | string | null | undefined): string[] {
  const list = Array.isArray(tags) ? tags : (tags ?? "").split(",");
  return [...new Set(list.map((t) => t.trim().toLowerCase()).filter(Boolean))];
}

/** Domein zonder protocol, www-voorvoegsel en pad. */
export function cleanDomain(input: string): string {
  return input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

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
    await onTaskReopened(id);
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
  await onTaskCompleted(row.id);

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
  await onTaskReopened(id);
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

  // Let op: in subqueries kolommen expliciet met tabelnaam; drizzle laat die weg als de hoofdquery één tabel heeft
  const openCount = sql<number>`(select count(*)::int from "tasks" t where t.project_id = "projects"."id" and t.status <> 'done')`;
  const doneCount = sql<number>`(select count(*)::int from "tasks" t where t.project_id = "projects"."id" and t.status = 'done')`;

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
  const [before] = await db.select({ status: projects.status }).from(projects).where(eq(projects.id, id));
  const [row] = await db.update(projects).set(data).where(eq(projects.id, id)).returning();
  // Project afgerond = opgeleverd: termijnen "bij oplevering" worden klaar om te factureren
  if (row && row.status === "done" && before?.status !== "done") await markProjectDelivered(id);
  return row;
}

export async function deleteProject(id: string) {
  await db.delete(projects).where(eq(projects.id, id));
}

/* ------------------------------------------------------------------ */
/* Klanten                                                             */
/* ------------------------------------------------------------------ */

export async function listClients(filter: { includePast?: boolean; tag?: string; status?: z.infer<typeof clientStatusSchema> } = {}) {
  // Let op: in subqueries kolommen expliciet met tabelnaam; drizzle laat die weg als de hoofdquery één tabel heeft
  const openTasks = sql<number>`(select count(*)::int from "tasks" t where t.client_id = "clients"."id" and t.status <> 'done')`;
  const activeProjects = sql<number>`(select count(*)::int from "projects" p where p.client_id = "clients"."id" and p.status in ('planned','active','waiting'))`;
  const websiteCount = sql<number>`(select count(*)::int from "websites" w where w.client_id = "clients"."id")`;
  const primaryContact = sql<string | null>`(select c.name from "client_contacts" c where c.client_id = "clients"."id" order by c.is_primary desc, c.created_at asc limit 1)`;
  const conds = [];
  if (filter.status) conds.push(eq(clients.status, filter.status));
  else if (!filter.includePast) conds.push(ne(clients.status, "past"));
  if (filter.tag) conds.push(sql`${filter.tag.toLowerCase()} = any(${clients.tags})`);
  return db
    .select({ client: clients, openTasks, activeProjects, websiteCount, primaryContact })
    .from(clients)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(clients.name));
}

/** Alle tags die in gebruik zijn, alfabetisch. */
export async function listClientTags(): Promise<string[]> {
  const rows = await db.execute<{ tag: string }>(sql`select distinct unnest(${clients.tags}) as tag from ${clients} order by tag`);
  return rows.map((r) => r.tag);
}

export async function getClient(id: string) {
  const [row] = await db.select().from(clients).where(eq(clients.id, id));
  return row ?? null;
}

/** Klant met contactpersonen (primair eerst), websites en documenten. */
export async function getClientDossier(id: string) {
  const client = await getClient(id);
  if (!client) return null;
  const [contacts, sites, documents] = await Promise.all([
    listContacts(id),
    listWebsites({ clientId: id }),
    db.select().from(clientDocuments).where(eq(clientDocuments.clientId, id)).orderBy(desc(clientDocuments.docDate), desc(clientDocuments.createdAt)),
  ]);
  return { client, contacts, websites: sites.map((w) => w.website), documents };
}

/** Dossier plus afspraken, termijnen en MRR van de klant. */
export async function getClientDossierFull(id: string) {
  const dossier = await getClientDossier(id);
  if (!dossier) return null;
  const [agreementRows, installmentRows] = await Promise.all([listAgreements({ clientId: id }), listInstallments({ clientId: id })]);
  const mrrCents = Math.round(agreementRows.filter((a) => a.running).reduce((s, a) => s + a.monthlyCents, 0));
  return { ...dossier, agreements: agreementRows, installments: installmentRows, mrrCents };
}

export async function findClientByName(name: string) {
  const [row] = await db.select().from(clients).where(ilike(clients.name, `%${name}%`)).limit(1);
  return row ?? null;
}

/**
 * Nieuwe klant. Optioneel direct een primaire contactpersoon (zo blijven
 * snelle invoer en oudere MCP-aanroepen met contactPerson/email/phone werken).
 */
export async function createClient(input: ClientInput, contact?: { name?: string | null; email?: string | null; phone?: string | null; role?: string | null }) {
  const data = clientInput.parse(input);
  if (data.tags) data.tags = cleanTags(data.tags);
  const [row] = await db.insert(clients).values(data).returning();
  if (contact && (contact.name || contact.email || contact.phone)) {
    await createContact({ clientId: row.id, name: contact.name || "Contactpersoon", email: contact.email, phone: contact.phone, role: contact.role, isPrimary: true });
  }
  return row;
}

export async function updateClient(id: string, patch: Partial<ClientInput>) {
  const data = clientInput.partial().parse(patch);
  if (data.tags) data.tags = cleanTags(data.tags);
  const [row] = await db.update(clients).set(data).where(eq(clients.id, id)).returning();
  return row;
}

export async function deleteClient(id: string) {
  // Contactpersonen, websites en documenten gaan mee (cascade); taken, projecten en notities blijven
  await db.delete(clients).where(eq(clients.id, id));
}

/* ------------------------------------------------------------------ */
/* Contactpersonen                                                     */
/* ------------------------------------------------------------------ */

export async function listContacts(clientId: string) {
  return db
    .select()
    .from(clientContacts)
    .where(eq(clientContacts.clientId, clientId))
    .orderBy(desc(clientContacts.isPrimary), asc(clientContacts.createdAt));
}

export async function getContact(id: string) {
  const [row] = await db.select().from(clientContacts).where(eq(clientContacts.id, id));
  return row ?? null;
}

/** Zorgt dat er per klant precies één primaire contactpersoon is (als er contacten zijn). */
async function settlePrimary(clientId: string, primaryId?: string) {
  if (primaryId) {
    await db
      .update(clientContacts)
      .set({ isPrimary: false })
      .where(and(eq(clientContacts.clientId, clientId), ne(clientContacts.id, primaryId), eq(clientContacts.isPrimary, true)));
    return;
  }
  const rows = await listContacts(clientId);
  if (rows.length > 0 && !rows.some((r) => r.isPrimary)) {
    await db.update(clientContacts).set({ isPrimary: true }).where(eq(clientContacts.id, rows[0].id));
  }
}

export async function createContact(input: ContactInput) {
  const data = contactInput.parse(input);
  const [row] = await db.insert(clientContacts).values(data).returning();
  await settlePrimary(row.clientId, row.isPrimary ? row.id : undefined);
  return (await getContact(row.id))!;
}

export async function updateContact(id: string, patch: Partial<Omit<ContactInput, "clientId">>) {
  const data = contactInput.omit({ clientId: true }).partial().parse(patch);
  const [row] = await db.update(clientContacts).set(data).where(eq(clientContacts.id, id)).returning();
  if (!row) return null;
  await settlePrimary(row.clientId, row.isPrimary ? row.id : undefined);
  return (await getContact(row.id))!;
}

export async function deleteContact(id: string) {
  const [row] = await db.delete(clientContacts).where(eq(clientContacts.id, id)).returning();
  if (row) await settlePrimary(row.clientId);
  return row ?? null;
}

/* ------------------------------------------------------------------ */
/* Websites                                                            */
/* ------------------------------------------------------------------ */

export async function listWebsites(filter: { clientId?: string; expiringWithinDays?: number } = {}) {
  const conds = [];
  if (filter.clientId) conds.push(eq(websites.clientId, filter.clientId));
  if (filter.expiringWithinDays !== undefined) {
    conds.push(isNotNull(websites.domainExpiresAt), lte(websites.domainExpiresAt, addDaysIso(today(), filter.expiringWithinDays)));
  }
  return db
    .select({ website: websites, clientName: clients.name, clientStatus: clients.status })
    .from(websites)
    .innerJoin(clients, eq(websites.clientId, clients.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(filter.expiringWithinDays !== undefined ? asc(websites.domainExpiresAt) : asc(websites.domain));
}

/** Websites waarvan het domein binnen `days` dagen verloopt (of al verlopen is). Standaard 30 dagen. */
export async function expiringDomains(days = 30) {
  return listWebsites({ expiringWithinDays: days });
}

export async function getWebsite(id: string) {
  const [row] = await db.select().from(websites).where(eq(websites.id, id));
  return row ?? null;
}

export async function createWebsite(input: WebsiteInput) {
  const data = websiteInput.parse(input);
  data.domain = cleanDomain(data.domain);
  const [row] = await db.insert(websites).values(data).returning();
  return row;
}

export async function updateWebsite(id: string, patch: Partial<WebsiteInput>) {
  const data = websiteInput.partial().parse(patch);
  if (data.domain) data.domain = cleanDomain(data.domain);
  const [row] = await db.update(websites).set(data).where(eq(websites.id, id)).returning();
  return row ?? null;
}

export async function deleteWebsite(id: string) {
  const [row] = await db.delete(websites).where(eq(websites.id, id)).returning();
  return row ?? null;
}

/* ------------------------------------------------------------------ */
/* Documenten (links naar offertes, overeenkomsten, VWO's)             */
/* ------------------------------------------------------------------ */

export async function createDocument(input: DocumentInput) {
  const data = documentInput.parse(input);
  const [row] = await db.insert(clientDocuments).values(data).returning();
  return row;
}

export async function updateDocument(id: string, patch: Partial<Omit<DocumentInput, "clientId">>) {
  const data = documentInput.omit({ clientId: true }).partial().parse(patch);
  const [row] = await db.update(clientDocuments).set(data).where(eq(clientDocuments.id, id)).returning();
  return row ?? null;
}

export async function deleteDocument(id: string) {
  const [row] = await db.delete(clientDocuments).where(eq(clientDocuments.id, id)).returning();
  return row ?? null;
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
