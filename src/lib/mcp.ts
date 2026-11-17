import "server-only";
import { timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import * as data from "./data";
import { getEvents, calendarConfigured } from "./calendar";
import { addDaysIso, today, weekStart } from "./dates";

/* ---------------- Authenticatie ---------------- */

export function tokenOk(token: string | null | undefined): boolean {
  const expected = process.env.MCP_TOKEN;
  if (!expected || expected.length < 24 || !token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ---------------- Hulpfuncties ---------------- */

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Datum als YYYY-MM-DD");
const area = z.enum(["zakelijk", "prive"]);
const uuidRe = /^[0-9a-f-]{36}$/i;

/** Klant mag als id of als (deel van de) naam worden opgegeven. */
async function resolveClient(ref: string | null | undefined): Promise<string | null | undefined> {
  if (ref === undefined) return undefined;
  if (ref === null || ref === "") return null;
  if (uuidRe.test(ref)) return ref;
  const c = await data.findClientByName(ref);
  if (!c) throw new Error(`Klant "${ref}" niet gevonden. Gebruik list_clients.`);
  return c.id;
}

function slimTask(t: data.TaskWithRefs) {
  return {
    id: t.id,
    title: t.title,
    area: t.area,
    status: t.status,
    client: t.clientName,
    clientId: t.clientId,
    project: t.projectName,
    projectId: t.projectId,
    planDate: t.planDate,
    dueDate: t.dueDate,
    priority: t.priority,
    estimateMin: t.estimateMin,
    recurrence: t.recurrence,
    notes: t.notes,
    completedAt: t.completedAt,
  };
}

const taskFields = {
  area: area.optional().describe("zakelijk of prive"),
  client: z.string().nullable().optional().describe("Klant-id of klantnaam; null om te ontkoppelen"),
  projectId: z.string().uuid().nullable().optional(),
  status: z.enum(["todo", "doing", "waiting", "done"]).optional(),
  planDate: isoDate.nullable().optional().describe("Wanneer je het wilt doen"),
  dueDate: isoDate.nullable().optional().describe("Harde deadline"),
  priority: z.number().int().min(1).max(3).optional().describe("1 hoog, 2 normaal, 3 laag"),
  estimateMin: z.number().int().positive().nullable().optional(),
  recurrence: z.enum(["none", "daily", "weekdays", "weekly", "monthly", "quarterly", "yearly"]).optional(),
  notes: z.string().nullable().optional(),
};

/* ---------------- Server ---------------- */

const INSTRUCTIONS = `Dit is Marc OS: Marc's centrale systeem voor taken, projecten, klanten, notities en reviews.
- Taken hebben een gebied (zakelijk/prive), optioneel een klant en project. Zakelijk zonder klant = algemeen bedrijfswerk.
- planDate = wanneer Marc het wil doen; dueDate = deadline.
- Inbox-items zijn notities van het type "inbox" (braindump). Verwerk ze met inbox_to_task of update_note.
- Begin een briefing altijd met get_overview. Sla briefings en samenvattingen op met save_review zodat Marc ze in de app ziet.
- Tijdzone: Europe/Amsterdam. Schrijf in het Nederlands.`;

export function buildServer() {
  const server = new McpServer({ name: "marc-os", version: "0.1.0" }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "get_overview",
    {
      title: "Dagoverzicht",
      description: "Alles voor een briefing: agenda, taken van vandaag, achterstallig, komende 7 dagen, inbox, lopende projecten en wat gisteren is afgerond.",
      inputSchema: { date: isoDate.optional().describe("Standaard vandaag") },
      annotations: { readOnlyHint: true },
    },
    async ({ date }) => {
      const t = date ?? today();
      const [todayTasks, upcoming, inbox, projects, doneYesterday, cal, lastReviews] = await Promise.all([
        data.listTasks({ view: "today" }),
        data.listTasks({ view: "upcoming", days: 7 }),
        data.listNotes({ type: "inbox" }),
        data.listProjects(),
        data.completedBetween(addDaysIso(t, -1), addDaysIso(t, -1)),
        calendarConfigured() ? getEvents(t, addDaysIso(t, 1)) : Promise.resolve(null),
        data.listReviews(undefined, 3),
      ]);
      return json({
        date: t,
        calendar: cal ? { events: cal.events, errors: cal.errors } : "Geen agenda gekoppeld",
        overdue: todayTasks.filter((x) => (x.planDate ?? x.dueDate)! < t).map(slimTask),
        today: todayTasks.filter((x) => (x.planDate ?? x.dueDate)! >= t).map(slimTask),
        upcoming7d: upcoming.map(slimTask),
        inbox: inbox.map((r) => ({ id: r.note.id, title: r.note.title, body: r.note.body })),
        activeProjects: projects.map((p) => ({ id: p.project.id, name: p.project.name, client: p.clientName, area: p.project.area, status: p.project.status, dueDate: p.project.dueDate, openTasks: p.openTasks })),
        completedYesterday: doneYesterday.map((x) => ({ title: x.title, client: x.clientName })),
        recentReviews: lastReviews,
      });
    },
  );

  /* ---- Taken ---- */

  server.registerTool(
    "list_tasks",
    {
      title: "Taken zoeken",
      description: "Lijst met taken. view: today (incl. achterstallig), overdue, upcoming, open, someday (zonder datum), done, all.",
      inputSchema: {
        view: z.enum(["today", "overdue", "upcoming", "open", "someday", "done", "all"]).optional(),
        area: area.optional(),
        client: z.string().optional().describe("Klant-id of naam"),
        projectId: z.string().uuid().optional(),
        general: z.boolean().optional().describe("Alleen zakelijk zonder klant"),
        search: z.string().optional(),
        days: z.number().int().positive().optional().describe("Voor upcoming, standaard 7"),
        limit: z.number().int().positive().max(500).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      const clientId = (await resolveClient(a.client)) ?? undefined;
      const rows = await data.listTasks({ ...a, clientId });
      return json(rows.map(slimTask));
    },
  );

  server.registerTool(
    "create_task",
    {
      title: "Taak aanmaken",
      description: "Maak een taak aan. Bij een project worden klant en gebied overgenomen.",
      inputSchema: { title: z.string().min(1), ...taskFields },
    },
    async ({ client, ...rest }) => {
      const task = await data.createTask({ ...rest, clientId: await resolveClient(client) });
      return json(task);
    },
  );

  server.registerTool(
    "update_task",
    {
      title: "Taak wijzigen",
      description: "Wijzig velden van een taak (alleen meegegeven velden veranderen). status 'done' rondt af.",
      inputSchema: { id: z.string().uuid(), title: z.string().min(1).optional(), ...taskFields },
    },
    async ({ id, client, ...rest }) => {
      const patch: Partial<data.TaskInput> = { ...rest };
      if (client !== undefined) patch.clientId = await resolveClient(client);
      return json(await data.updateTask(id, patch));
    },
  );

  server.registerTool(
    "complete_task",
    {
      title: "Taak afronden",
      description: "Rond een taak af. Bij een terugkerende taak wordt automatisch de volgende aangemaakt.",
      inputSchema: { id: z.string().uuid() },
    },
    async ({ id }) => json(await data.completeTask(id)),
  );

  server.registerTool(
    "delete_task",
    {
      title: "Taak verwijderen",
      description: "Verwijder een taak definitief. Alleen gebruiken als Marc daar expliciet om vraagt.",
      inputSchema: { id: z.string().uuid() },
      annotations: { destructiveHint: true },
    },
    async ({ id }) => {
      await data.deleteTask(id);
      return json({ deleted: id });
    },
  );

  server.registerTool(
    "completed_tasks",
    {
      title: "Afgeronde taken",
      description: "Taken die in een periode zijn afgerond (voor dag- en weekreviews).",
      inputSchema: { from: isoDate, to: isoDate },
      annotations: { readOnlyHint: true },
    },
    async ({ from, to }) => json((await data.completedBetween(from, to)).map(slimTask)),
  );

  /* ---- Inbox ---- */

  server.registerTool(
    "capture",
    {
      title: "Braindump vastleggen",
      description: "Zet iets in de inbox. Eerste regel wordt de titel. Gebruik dit voor losse gedachten die nog verwerkt moeten worden.",
      inputSchema: { text: z.string().min(1) },
    },
    async ({ text }) => json(await data.capture(text)),
  );

  server.registerTool(
    "inbox_to_task",
    {
      title: "Inbox-item naar taak",
      description: "Zet een inbox-item om in een taak (het inbox-item verdwijnt).",
      inputSchema: { noteId: z.string().uuid(), title: z.string().optional(), ...taskFields },
    },
    async ({ noteId, client, ...rest }) => {
      const extra: Partial<data.TaskInput> = { ...rest };
      if (client !== undefined) extra.clientId = await resolveClient(client);
      return json(await data.inboxToTask(noteId, extra));
    },
  );

  /* ---- Notities ---- */

  const noteType = z.enum(["inbox", "note", "meeting", "call", "email", "decision", "info", "idea"]);

  server.registerTool(
    "list_notes",
    {
      title: "Notities zoeken",
      description: "Zoek notities (dossier). Zonder type worden inbox-items overgeslagen.",
      inputSchema: {
        type: noteType.optional(),
        client: z.string().optional(),
        projectId: z.string().uuid().optional(),
        area: area.optional(),
        search: z.string().optional(),
        limit: z.number().int().positive().max(200).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ client, type, ...rest }) => {
      const rows = await data.listNotes({ ...rest, type, excludeInbox: !type, clientId: (await resolveClient(client)) ?? undefined });
      return json(rows.map((r) => ({ id: r.note.id, title: r.note.title, type: r.note.type, date: r.note.noteDate, client: r.clientName, project: r.projectName, preview: r.note.body?.slice(0, 300) })));
    },
  );

  server.registerTool(
    "get_note",
    { title: "Notitie lezen", description: "Volledige inhoud van een notitie.", inputSchema: { id: z.string().uuid() }, annotations: { readOnlyHint: true } },
    async ({ id }) => json(await data.getNote(id)),
  );

  const noteFields = {
    body: z.string().nullable().optional().describe("Markdown"),
    type: noteType.optional(),
    area: area.nullable().optional(),
    client: z.string().nullable().optional(),
    projectId: z.string().uuid().nullable().optional(),
    noteDate: isoDate.nullable().optional(),
  };

  server.registerTool(
    "create_note",
    { title: "Notitie aanmaken", description: "Maak een notitie, bijv. gespreksverslag of info voor het klantdossier.", inputSchema: { title: z.string().min(1), ...noteFields } },
    async ({ client, ...rest }) => json(await data.createNote({ ...rest, clientId: await resolveClient(client) })),
  );

  server.registerTool(
    "update_note",
    { title: "Notitie wijzigen", description: "Wijzig een notitie. Body vervangt de hele inhoud.", inputSchema: { id: z.string().uuid(), title: z.string().optional(), ...noteFields } },
    async ({ id, client, ...rest }) => {
      const patch: Partial<data.NoteInput> = { ...rest };
      if (client !== undefined) patch.clientId = await resolveClient(client);
      return json(await data.updateNote(id, patch));
    },
  );

  /* ---- Klanten ---- */

  server.registerTool(
    "list_clients",
    { title: "Klanten", description: "Alle klanten met aantal open taken en lopende projecten.", inputSchema: { includePast: z.boolean().optional() }, annotations: { readOnlyHint: true } },
    async ({ includePast }) => json((await data.listClients({ includePast })).map((r) => ({ ...r.client, openTasks: r.openTasks, activeProjects: r.activeProjects }))),
  );

  server.registerTool(
    "get_client",
    { title: "Klantdossier", description: "Klant met info, projecten, open taken en recente notities.", inputSchema: { client: z.string().describe("Id of naam") }, annotations: { readOnlyHint: true } },
    async ({ client }) => {
      const id = (await resolveClient(client))!;
      const [c, projects, tasks, notes] = await Promise.all([
        data.getClient(id),
        data.listProjects({ clientId: id, includeClosed: true }),
        data.listTasks({ clientId: id, view: "open" }),
        data.listNotes({ clientId: id, excludeInbox: true, limit: 20 }),
      ]);
      return json({
        client: c,
        projects: projects.map((p) => ({ id: p.project.id, name: p.project.name, status: p.project.status, dueDate: p.project.dueDate, openTasks: p.openTasks })),
        openTasks: tasks.map(slimTask),
        recentNotes: notes.map((r) => ({ id: r.note.id, title: r.note.title, type: r.note.type, date: r.note.noteDate, preview: r.note.body?.slice(0, 300) })),
      });
    },
  );

  const clientFields = {
    contactPerson: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    status: z.enum(["lead", "active", "on_hold", "past"]).optional(),
    info: z.string().nullable().optional(),
  };

  server.registerTool(
    "create_client",
    { title: "Klant aanmaken", description: "Nieuwe klant. name = bedrijfsnaam.", inputSchema: { name: z.string().min(1), ...clientFields } },
    async (a) => json(await data.createClient(a)),
  );

  server.registerTool(
    "update_client",
    { title: "Klant wijzigen", description: "Wijzig klantgegevens.", inputSchema: { client: z.string(), name: z.string().optional(), ...clientFields } },
    async ({ client, ...rest }) => json(await data.updateClient((await resolveClient(client))!, rest)),
  );

  /* ---- Projecten ---- */

  const projectFields = {
    area: area.optional(),
    client: z.string().nullable().optional(),
    status: z.enum(["idea", "planned", "active", "waiting", "done", "archived"]).optional(),
    startDate: isoDate.nullable().optional(),
    dueDate: isoDate.nullable().optional(),
    description: z.string().nullable().optional(),
  };

  server.registerTool(
    "list_projects",
    {
      title: "Projecten",
      description: "Projecten met aantal open/afgeronde taken. Standaard alleen lopende.",
      inputSchema: { area: area.optional(), client: z.string().optional(), general: z.boolean().optional(), includeClosed: z.boolean().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ client, ...rest }) => {
      const rows = await data.listProjects({ ...rest, clientId: (await resolveClient(client)) ?? undefined });
      return json(rows.map((r) => ({ ...r.project, client: r.clientName, openTasks: r.openTasks, doneTasks: r.doneTasks })));
    },
  );

  server.registerTool(
    "get_project",
    { title: "Project", description: "Project met taken en notities.", inputSchema: { id: z.string().uuid() }, annotations: { readOnlyHint: true } },
    async ({ id }) => {
      const [p, tasks, notes] = await Promise.all([data.getProject(id), data.listTasks({ projectId: id, view: "all" }), data.listNotes({ projectId: id, excludeInbox: true })]);
      return json({ project: p, tasks: tasks.map(slimTask), notes: notes.map((r) => ({ id: r.note.id, title: r.note.title, type: r.note.type })) });
    },
  );

  server.registerTool(
    "create_project",
    { title: "Project aanmaken", description: "Nieuw project.", inputSchema: { name: z.string().min(1), ...projectFields } },
    async ({ client, ...rest }) => json(await data.createProject({ ...rest, clientId: await resolveClient(client) })),
  );

  server.registerTool(
    "update_project",
    { title: "Project wijzigen", description: "Wijzig een project.", inputSchema: { id: z.string().uuid(), name: z.string().optional(), ...projectFields } },
    async ({ id, client, ...rest }) => {
      const patch: Partial<data.ProjectInput> = { ...rest };
      if (client !== undefined) patch.clientId = await resolveClient(client);
      return json(await data.updateProject(id, patch));
    },
  );

  /* ---- Agenda en reviews ---- */

  server.registerTool(
    "get_calendar",
    { title: "Agenda", description: "Afspraken tussen twee datums (inclusief).", inputSchema: { from: isoDate, to: isoDate }, annotations: { readOnlyHint: true } },
    async ({ from, to }) => json(calendarConfigured() ? await getEvents(from, to) : { events: [], errors: ["Geen agenda gekoppeld"] }),
  );

  server.registerTool(
    "save_review",
    {
      title: "Briefing of review opslaan",
      description: "Sla een ochtendbriefing/dagafsluiting (kind=day), weekreview (week) of maandreview (month) op. Standaard overschrijft dit dezelfde periode; met append=true wordt de tekst eronder toegevoegd (bijv. dagafsluiting onder de ochtendbriefing). De dag-review van vandaag verschijnt bovenaan het Vandaag-scherm.",
      inputSchema: {
        kind: z.enum(["day", "week", "month"]),
        periodDate: isoDate.optional().describe("Dag, maandag van de week, of 1e van de maand. Standaard huidige periode."),
        body: z.string().min(1),
        append: z.boolean().optional().describe("Toevoegen in plaats van overschrijven"),
      },
    },
    async ({ kind, periodDate, body, append }) => {
      const t = today();
      const d = periodDate ?? (kind === "day" ? t : kind === "week" ? weekStart(t) : `${t.slice(0, 7)}-01`);
      return json(await data.saveReview(kind, d, body, append));
    },
  );

  server.registerTool(
    "list_reviews",
    { title: "Reviews", description: "Eerdere briefings en reviews.", inputSchema: { kind: z.enum(["day", "week", "month"]).optional(), limit: z.number().int().positive().max(100).optional() }, annotations: { readOnlyHint: true } },
    async ({ kind, limit }) => json(await data.listReviews(kind, limit)),
  );

  return server;
}

/** Stateless: per request een nieuwe server en transport. */
export async function handleMcp(req: Request): Promise<Response> {
  const server = buildServer();
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    // Response is al opgebouwd (enableJsonResponse), dus opruimen kan direct
    void transport.close();
    void server.close();
  }
}
