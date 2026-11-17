import "server-only";
import { timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import * as data from "./data";
import { getEvents, calendarConfigured } from "./calendar";
import { addDaysIso, today, weekStart } from "./dates";
import { formatDuration, parseDuration } from "./duration";
import { getModules, MODULES, type ModuleKey, type Modules } from "./settings";

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
const optText = z.string().nullable().optional();
const clientStatus = z.enum(["lead", "active", "on_hold", "past"]);

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

function slimEntry(e: data.TimeEntryRow) {
  return {
    id: e.id,
    date: e.entryDate,
    description: e.description,
    area: e.area,
    client: e.clientName,
    clientId: e.clientId,
    project: e.projectName,
    projectId: e.projectId,
    task: e.taskTitle,
    taskId: e.taskId,
    agreement: e.agreementLabel,
    agreementId: e.agreementId,
    category: e.category,
    minutes: e.minutes,
    duration: formatDuration(e.minutes),
    running: e.running,
    startedAt: e.startedAt,
    endedAt: e.endedAt,
    billable: e.billable,
    invoiced: e.invoiced,
    rateCents: e.rateCents,
  };
}

/** Duur als tekst ("1:30", "1,5", "90m", "2u") of als minuten. */
function minutesFrom(duration?: string | null, durationMin?: number | null): number | undefined {
  if (durationMin) return durationMin;
  if (!duration) return undefined;
  const m = parseDuration(duration);
  if (m == null) throw new Error(`Duur "${duration}" niet begrepen. Gebruik bijv. 1:30, 1,5, 90m of 2u.`);
  return m;
}

/* ---------------- Server ---------------- */

/** Welke MCP-tools bij welke module horen. Tools van een uitgeschakelde module worden niet aangeboden. */
const TOOL_MODULE: Record<string, ModuleKey> = {
  add_document: "dossier",
  delete_document: "dossier",
  list_websites: "websites",
  add_website: "websites",
  update_website: "websites",
  delete_website: "websites",
  list_agreements: "afspraken",
  create_agreement: "afspraken",
  update_agreement: "afspraken",
  deliver_agreement: "afspraken",
  delete_agreement: "afspraken",
  list_installments: "afspraken",
  add_installment: "afspraken",
  update_installment: "afspraken",
  delete_installment: "afspraken",
  get_revenue: "afspraken",
  get_timer: "uren",
  start_timer: "uren",
  stop_timer: "uren",
  log_time: "uren",
  list_time_entries: "uren",
  update_time_entry: "uren",
  delete_time_entry: "uren",
  get_hours: "uren",
  invoice_hours: "uren",
  get_pipeline: "pipeline",
  list_leads: "pipeline",
  get_lead: "pipeline",
  create_lead: "pipeline",
  update_lead: "pipeline",
  delete_lead: "pipeline",
  list_quotes: "pipeline",
  get_quote: "pipeline",
  create_quote: "pipeline",
  update_quote: "pipeline",
  add_quote_line: "pipeline",
  update_quote_line: "pipeline",
  delete_quote_line: "pipeline",
  set_quote_status: "pipeline",
  accept_quote: "pipeline",
  list_filings: "aangiftes",
  get_filing: "aangiftes",
  update_filing: "aangiftes",
  create_filing: "aangiftes",
  draft_docs_reminder: "aangiftes",
  list_filing_schedules: "aangiftes",
  set_filing_schedule: "aangiftes",
  delete_filing_schedule: "aangiftes",
};

/** Uitleg per onderdeel; regels van uitgeschakelde modules vallen weg. */
const INSTRUCTION_LINES: { text: string; module?: ModuleKey }[] = [
  { text: "- Taken hebben een gebied (zakelijk/prive), optioneel een klant en project. Zakelijk zonder klant = algemeen bedrijfswerk." },
  { text: "- planDate = wanneer Marc het wil doen; dueDate = deadline." },
  { text: "- Klanten hebben een dossier (get_client) met contactpersonen, vaste informatie, projecten, taken en notities. Sla nooit wachtwoorden op; vaultRef is alleen een verwijzing." },
  { text: "- Uitgebreid dossier: ook registratie (KvK, btw), adressen, facturatie, verwerkersovereenkomst, tags en documentlinks (add_document).", module: "dossier" },
  { text: "- Websites zijn eigen objecten per klant met domein, registrar, verloopdatum en of hosting en beheer door Marc gebeuren (list_websites).", module: "websites" },
  { text: "- Afspraken zijn diensten per klant (boekhouding, website, hosting, beheer, sparringpartner, maatwerk). Bedragen zijn in centen en exclusief btw. MRR = som van lopende vaste afspraken omgerekend naar per maand (get_revenue).", module: "afspraken" },
  { text: "- Termijnen zijn te factureren regels. Een eenmalige website-afspraak maakt zelf 2 termijnen van 50% (bij akkoord, bij oplevering). Facturen maakt Marc zelf in Moneybird; zet een termijn alleen op een andere status als Marc dat vraagt.", module: "afspraken" },
  { text: "- Uren: alles mag uren krijgen (klantwerk, bedrijf algemeen, privé, leren). Er loopt hooguit één timer; start_timer stopt een lopende timer. Voor achteraf schrijven gebruik log_time (\"2 uur aan Vobis, SEO-analyse\" → client \"Vobis\", duration \"2u\", description \"SEO-analyse\"). Declarabel gaat automatisch als de uren onder een afspraak met uurtarief vallen. get_hours geeft het weekoverzicht, te factureren uren, budgetten (waarschuwing vanaf 80%) en het effectief uurtarief per klant.", module: "uren" },
  { text: "- Pipeline: een lead is een kans (nieuw bedrijf of bestaande klant) met status new/contact/quoted/won/lost, kans in procenten en een volgende stap. Een offerte hoort altijd bij een lead en heeft regels per dienst (zelfde velden als een afspraak). accept_quote verwerkt een akkoord met één aanroep: klant aanmaken of activeren, websites per domein, elke regel een actieve afspraak, websiteproject en termijnen (eerste termijn klaar om te factureren), lead gewonnen. Doe accept_quote, set_quote_status en delete-acties alleen als Marc daarom vraagt.", module: "pipeline" },
  { text: "- Aangiftecyclus: per boekhoudklant staat ingesteld welke aangiftes Marc doet (btw per maand/kwartaal/jaar, IB, Vpb, ICP, loonheffingen, overig) met eventueel uitstel (individueel of becon). Daaruit ontstaat per periode automatisch een aangifte-item met wettelijke deadline, datum waarop de stukken binnen moeten zijn en (na afloop van de periode) een taak. Statussen: todo, waiting_docs (wacht op stukken), in_progress, review (klaar voor controle), filed (ingediend), done (afgerond: betaald of ontvangen). list_filings en get_overview tonen signalen (deadline binnen 14 dagen, te laat, stukken ontbreken). draft_docs_reminder geeft een conceptmail om stukken op te vragen; verstuur nooit zelf, Marc verstuurt na akkoord. Wijzig statussen of instellingen alleen als Marc daarom vraagt.", module: "aangiftes" },
  { text: "- Inbox-items zijn notities van het type \"inbox\" (braindump). Verwerk ze met inbox_to_task of update_note." },
  { text: "- Begin een briefing altijd met get_overview. Sla briefings en samenvattingen op met save_review zodat Marc ze in de app ziet." },
  { text: "- Tijdzone: Europe/Amsterdam. Schrijf in het Nederlands." },
];

function instructions(modules: Modules) {
  const off = (Object.keys(MODULES) as ModuleKey[]).filter((k) => !modules[k]);
  const lines = [
    "Dit is Marc OS: Marc's centrale systeem voor taken, projecten, klanten, notities en reviews.",
    ...INSTRUCTION_LINES.filter((l) => !l.module || modules[l.module]).map((l) => l.text),
  ];
  if (off.length) {
    lines.push(
      `- Tijdelijk uitgeschakeld (MVP): ${off.map((k) => MODULES[k].label).join(", ")}. Daar zijn geen tools voor. Vraagt Marc ernaar, zeg dan dat de module uit staat en dat hij hem aanzet via Instellingen → Modules.`,
    );
  }
  return lines.join("\n");
}

export function buildServer(modules: Modules) {
  const server = new McpServer({ name: "marc-os", version: "0.1.0" }, { instructions: instructions(modules) });

  // Tools van uitgeschakelde modules worden niet geregistreerd, zodat Claude (en straks Hermes) er niet mee werkt
  const register = server.registerTool.bind(server);
  server.registerTool = ((name: string, config: unknown, cb: unknown) => {
    const m = TOOL_MODULE[name];
    if (m && !modules[m]) return undefined;
    return (register as (n: string, c: unknown, f: unknown) => unknown)(name, config, cb);
  }) as typeof server.registerTool;

  server.registerTool(
    "get_overview",
    {
      title: "Dagoverzicht",
      description: "Alles voor een briefing: agenda, taken van vandaag, achterstallig, komende 7 dagen, inbox, lopende projecten en wat gisteren is afgerond. Plus, als die modules aan staan: pipeline, domeinen die binnen 30 dagen verlopen, MRR, termijnen klaar om te factureren, aflopende afspraken, uren deze week, budgetten en aangiftes. modulesOff noemt wat tijdelijk uit staat.",
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
      const none = Promise.resolve(null);
      const [domains, money, revenue, hours, timer, budgets, pipeline, filingSig] = await Promise.all([
        modules.websites ? data.expiringDomains() : none,
        modules.afspraken ? data.revenueSignals() : none,
        modules.afspraken ? data.revenueOverview(3) : none,
        modules.uren ? data.weekHours(t) : none,
        modules.uren ? data.getRunningTimer() : none,
        modules.uren && modules.afspraken ? data.hourlyBudgets({ onlyWarnings: true }) : none,
        modules.pipeline ? data.pipelineSignals() : none,
        modules.aangiftes ? data.filingSignals() : none,
      ]);
      // Onderdelen van uitgeschakelde modules blijven weg (undefined valt weg in JSON)
      return json({
        date: t,
        modulesOff: (Object.keys(MODULES) as ModuleKey[]).filter((k) => !modules[k]).map((k) => MODULES[k].label),
        calendar: cal ? { events: cal.events, errors: cal.errors } : "Geen agenda gekoppeld",
        overdue: todayTasks.filter((x) => (x.planDate ?? x.dueDate)! < t).map(slimTask),
        today: todayTasks.filter((x) => (x.planDate ?? x.dueDate)! >= t).map(slimTask),
        upcoming7d: upcoming.map(slimTask),
        inbox: inbox.map((r) => ({ id: r.note.id, title: r.note.title, body: r.note.body })),
        activeProjects: projects.map((p) => ({ id: p.project.id, name: p.project.name, client: p.clientName, area: p.project.area, status: p.project.status, dueDate: p.project.dueDate, openTasks: p.openTasks })),
        completedYesterday: doneYesterday.map((x) => ({ title: x.title, client: x.clientName })),
        expiringDomains: domains?.map((r) => ({ domain: r.website.domain, client: r.clientName, expiresAt: r.website.domainExpiresAt })),
        revenue: revenue ? { mrrCents: revenue.mrrCents, readyToInvoice: revenue.ready, invoicedUnpaid: revenue.invoicedOpen } : undefined,
        readyToInvoice: money?.ready.map((i) => ({ id: i.id, client: i.clientName, description: i.description, amountCents: i.amountCents })),
        agreementsEnding: money?.ending.map((a) => ({ id: a.id, client: a.clientName, agreement: a.label, endDate: a.endDate })),
        hoursThisWeek: hours ? { total: formatDuration(hours.totalMin), billable: formatDuration(hours.billableMin), totalMin: hours.totalMin, billableMin: hours.billableMin } : undefined,
        runningTimer: modules.uren ? (timer ? slimEntry(timer) : null) : undefined,
        budgetWarnings: budgets?.map((b) => ({ agreementId: b.agreementId, client: b.clientName, agreement: b.label, pct: b.pct, usedCents: b.usedCents, budgetCents: b.budgetCents })),
        pipeline: pipeline
          ? {
              openQuotes: pipeline.openQuotes,
              nextStepsDue: pipeline.nextSteps.map((l) => ({ leadId: l.id, company: l.clientName ?? l.companyName, title: l.title, nextStep: l.nextStep, nextStepDate: l.nextStepDate })),
              quotesExpiringSoon: pipeline.expiringQuotes.map((q) => ({ quoteId: q.id, number: q.number, company: q.companyName, validUntil: q.validUntil })),
            }
          : undefined,
        filings: filingSig
          ? {
              overdue: filingSig.overdue.map(data.slimFiling),
              deadlineWithin14d: filingSig.dueSoon.map(data.slimFiling),
              docsMissing: filingSig.docsMissing.map(data.slimFiling),
              filedAwaitingPayment: filingSig.awaitingPayment.length,
            }
          : undefined,
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
    {
      title: "Klanten",
      description: "Klanten met primaire contactpersoon, aantal open taken, lopende projecten en websites. Filter op status of tag.",
      inputSchema: {
        includePast: z.boolean().optional().describe("Ook oud-klanten"),
        status: clientStatus.optional(),
        tag: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (a) =>
      json(
        (await data.listClients(a)).map((r) => ({
          id: r.client.id,
          name: r.client.name,
          status: r.client.status,
          city: r.client.city,
          tags: r.client.tags,
          primaryContact: r.primaryContact,
          openTasks: r.openTasks,
          activeProjects: r.activeProjects,
          websites: r.websiteCount,
        })),
      ),
  );

  server.registerTool(
    "get_client",
    {
      title: "Klantdossier",
      description: "Klantdossier: gegevens, contactpersonen, vaste informatie, projecten, open taken en recente notities. Met de modules aan ook uitgebreide gegevens, websites, documenten, afspraken, termijnen en MRR van de klant.",
      inputSchema: { client: z.string().describe("Id of naam") },
      annotations: { readOnlyHint: true },
    },
    async ({ client }) => {
      const id = (await resolveClient(client))!;
      const [dossier, projects, tasks, notes] = await Promise.all([
        data.getClientDossierFull(id),
        data.listProjects({ clientId: id, includeClosed: true }),
        data.listTasks({ clientId: id, view: "open" }),
        data.listNotes({ clientId: id, excludeInbox: true, limit: 20 }),
      ]);
      if (!dossier) throw new Error("Klant niet gevonden");
      const { client: c, contacts, websites, documents, agreements, installments, mrrCents } = dossier;
      // Alleen de onderdelen van modules die aan staan
      const basic = { id: c.id, name: c.name, status: c.status, info: c.info, vaultRef: c.vaultRef, createdAt: c.createdAt, updatedAt: c.updatedAt };
      return json({
        client: modules.dossier ? c : basic,
        contacts,
        websites: modules.websites ? websites : undefined,
        documents: modules.dossier ? documents : undefined,
        agreements: modules.afspraken ? agreements : undefined,
        installments: modules.afspraken ? installments : undefined,
        mrrCents: modules.afspraken ? mrrCents : undefined,
        projects: projects.map((p) => ({ id: p.project.id, name: p.project.name, status: p.project.status, dueDate: p.project.dueDate, openTasks: p.openTasks })),
        openTasks: tasks.map(slimTask),
        recentNotes: notes.map((r) => ({ id: r.note.id, title: r.note.title, type: r.note.type, date: r.note.noteDate, preview: r.note.body?.slice(0, 300) })),
      });
    },
  );

  const clientFields = {
    legalForm: optText.describe("Rechtsvorm, bijv. Eenmanszaak, BV, Vereniging"),
    status: clientStatus.optional(),
    clientSince: isoDate.nullable().optional(),
    source: optText.describe("Hoe binnengekomen"),
    kvkNumber: optText,
    vatNumber: optText,
    address: optText.describe("Bezoekadres: straat en huisnummer"),
    postcode: optText,
    city: optText,
    country: z.string().length(2).optional().describe("Landcode, standaard NL"),
    invoiceAddress: optText.describe("Alleen als het factuuradres afwijkt"),
    invoicePostcode: optText,
    invoiceCity: optText,
    invoiceCountry: optText,
    invoiceEmail: optText,
    paymentTermDays: z.number().int().min(0).max(365).optional(),
    moneybirdContactId: optText,
    dpaStatus: z.enum(["not_applicable", "needed", "sent", "signed"]).optional().describe("Verwerkersovereenkomst"),
    dpaDate: isoDate.nullable().optional(),
    personalData: optText.describe("Welke persoonsgegevens verwerkt worden"),
    vaultRef: optText.describe("Verwijzing naar de wachtwoordmanager. Nooit wachtwoorden zelf opslaan."),
    tags: z.array(z.string()).optional().describe("Vervangt alle tags"),
    info: optText.describe("Vaste informatie, markdown"),
  };

  server.registerTool(
    "create_client",
    {
      title: "Klant aanmaken",
      description: "Nieuwe klant. name = bedrijfsnaam. contactPerson/email/phone maken direct een primaire contactpersoon aan.",
      inputSchema: {
        name: z.string().min(1),
        ...clientFields,
        contactPerson: optText,
        email: optText.describe("E-mail van de contactpersoon"),
        phone: optText.describe("Telefoon van de contactpersoon"),
      },
    },
    async ({ contactPerson, email, phone, ...rest }) => json(await data.createClient(rest, { name: contactPerson, email, phone })),
  );

  server.registerTool(
    "update_client",
    { title: "Klant wijzigen", description: "Wijzig klantgegevens. Contactpersonen en websites hebben eigen tools.", inputSchema: { client: z.string(), name: z.string().optional(), ...clientFields } },
    async ({ client, ...rest }) => json(await data.updateClient((await resolveClient(client))!, rest)),
  );

  /* ---- Contactpersonen ---- */

  const contactFields = {
    role: optText.describe("Rol, bijv. eigenaar, penningmeester"),
    email: optText,
    phone: optText,
    isPrimary: z.boolean().optional().describe("Primaire contactpersoon; de vorige primaire vervalt dan"),
    notes: optText,
  };

  server.registerTool(
    "add_contact",
    { title: "Contactpersoon toevoegen", description: "Contactpersoon bij een klant.", inputSchema: { client: z.string().describe("Klant-id of naam"), name: z.string().min(1), ...contactFields } },
    async ({ client, ...rest }) => json(await data.createContact({ ...rest, clientId: (await resolveClient(client))! })),
  );

  server.registerTool(
    "update_contact",
    { title: "Contactpersoon wijzigen", description: "Wijzig een contactpersoon (id uit get_client).", inputSchema: { id: z.string().uuid(), name: z.string().min(1).optional(), ...contactFields } },
    async ({ id, ...rest }) => json(await data.updateContact(id, rest)),
  );

  server.registerTool(
    "delete_contact",
    { title: "Contactpersoon verwijderen", description: "Verwijder een contactpersoon.", inputSchema: { id: z.string().uuid() }, annotations: { destructiveHint: true } },
    async ({ id }) => json(await data.deleteContact(id)),
  );

  /* ---- Websites ---- */

  const websiteFields = {
    registrar: optText,
    domainExpiresAt: isoDate.nullable().optional().describe("Verloopdatum domein"),
    hostingLocation: optText,
    cms: optText,
    liveDate: isoDate.nullable().optional(),
    hostingByUs: z.boolean().optional().describe("Hosting afgenomen bij MLC"),
    maintenanceByUs: z.boolean().optional().describe("Beheer afgenomen bij MLC"),
    notes: optText,
  };

  server.registerTool(
    "list_websites",
    {
      title: "Websites",
      description: "Websites van alle klanten, of van één klant. Met expiringWithinDays alleen domeinen die binnen zoveel dagen verlopen (of al verlopen zijn).",
      inputSchema: { client: z.string().optional(), expiringWithinDays: z.number().int().min(0).optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ client, expiringWithinDays }) => {
      const clientId = (await resolveClient(client)) ?? undefined;
      const rows = await data.listWebsites({ clientId, expiringWithinDays });
      return json(rows.map((r) => ({ ...r.website, client: r.clientName })));
    },
  );

  server.registerTool(
    "add_website",
    { title: "Website toevoegen", description: "Website bij een klant. Een klant kan meerdere websites hebben.", inputSchema: { client: z.string().describe("Klant-id of naam"), domain: z.string().min(1), ...websiteFields } },
    async ({ client, ...rest }) => json(await data.createWebsite({ ...rest, clientId: (await resolveClient(client))! })),
  );

  server.registerTool(
    "update_website",
    { title: "Website wijzigen", description: "Wijzig een website (id uit get_client of list_websites).", inputSchema: { id: z.string().uuid(), domain: z.string().min(1).optional(), ...websiteFields } },
    async ({ id, ...rest }) => json(await data.updateWebsite(id, rest)),
  );

  server.registerTool(
    "delete_website",
    { title: "Website verwijderen", description: "Verwijder een website.", inputSchema: { id: z.string().uuid() }, annotations: { destructiveHint: true } },
    async ({ id }) => json(await data.deleteWebsite(id)),
  );

  /* ---- Afspraken, termijnen en omzet ---- */

  const kind = z.enum(["bookkeeping", "website", "hosting", "maintenance", "sparring", "custom"]);
  const agreementStatus = z.enum(["draft", "active", "cancelled", "ended"]);
  const installmentStatus = z.enum(["planned", "ready", "draft", "sent", "paid"]);
  const agreementFields = {
    title: optText.describe("Optionele omschrijving"),
    websiteId: z.string().uuid().nullable().optional().describe("Website (bij hosting, beheer of website)"),
    projectId: z.string().uuid().nullable().optional(),
    amountCents: z.number().int().min(0).optional().describe("Bedrag in centen excl. btw: per periode, eenmalig of per uur. Leeg bij sparringpartner = 12500"),
    pricing: z.enum(["recurring", "one_off", "hourly"]).optional().describe("Leeg = standaard voor de soort (boekhouding/hosting/beheer/sparring: recurring, website: one_off, maatwerk: hourly)"),
    period: z.enum(["month", "quarter", "year"]).nullable().optional().describe("Alleen bij recurring"),
    budgetCents: z.number().int().min(0).nullable().optional().describe("Maatwerk: plafond"),
    sessionsPerMonth: z.number().int().min(0).nullable().optional(),
    startDate: isoDate.nullable().optional(),
    endDate: isoDate.nullable().optional(),
    noticeMonths: z.number().int().min(0).max(36).nullable().optional().describe("Opzegtermijn in maanden"),
    indexationPct: z.number().min(0).max(100).nullable().optional().describe("Jaarlijkse indexatie in procenten"),
    status: agreementStatus.optional().describe("draft=concept, active=actief, cancelled=opgezegd (loopt tot einddatum), ended=beëindigd"),
    notes: optText,
  };

  server.registerTool(
    "list_agreements",
    {
      title: "Afspraken",
      description: "Afspraken (diensten) van alle klanten of één klant, met maandbedrag (monthlyCents) en of ze nu meetellen in de MRR (running).",
      inputSchema: { client: z.string().optional(), status: z.array(agreementStatus).optional(), kind: kind.optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ client, status, kind }) => json(await data.listAgreements({ clientId: (await resolveClient(client)) ?? undefined, status, kind })),
  );

  server.registerTool(
    "create_agreement",
    {
      title: "Afspraak aanmaken",
      description: "Nieuwe afspraak (dienst) bij een klant. Eenmalige website maakt automatisch 2 termijnen van 50% en een websiteproject als projectId leeg is; overig eenmalig werk 1 termijn bij oplevering.",
      inputSchema: { client: z.string().describe("Klant-id of naam"), kind, ...agreementFields, createProject: z.boolean().optional().describe("Standaard true bij website") },
    },
    async ({ client, createProject, ...rest }) => json(await data.createAgreement({ ...rest, clientId: (await resolveClient(client))! }, { createProject })),
  );

  server.registerTool(
    "update_agreement",
    {
      title: "Afspraak wijzigen",
      description: "Wijzig een afspraak. Status naar active zet termijnen 'bij akkoord' klaar om te factureren. Opzeggen zonder einddatum: einde maand na de opzegtermijn.",
      inputSchema: { id: z.string().uuid(), kind: kind.optional(), ...agreementFields },
    },
    async ({ id, ...rest }) => json(await data.updateAgreement(id, rest)),
  );

  server.registerTool(
    "deliver_agreement",
    { title: "Opgeleverd", description: "Eenmalig werk opgeleverd: termijnen 'bij oplevering' worden klaar om te factureren en het gekoppelde project wordt afgerond.", inputSchema: { id: z.string().uuid() } },
    async ({ id }) => json(await data.deliverAgreement(id)),
  );

  server.registerTool(
    "delete_agreement",
    { title: "Afspraak verwijderen", description: "Verwijder een afspraak. Gefactureerde en betaalde termijnen blijven bewaard.", inputSchema: { id: z.string().uuid() }, annotations: { destructiveHint: true } },
    async ({ id }) => json(await data.deleteAgreement(id)),
  );

  server.registerTool(
    "list_installments",
    {
      title: "Termijnen",
      description: "Te factureren regels. Filter op klant, afspraak of status (planned, ready = klaar om te factureren, draft = concept in Moneybird, sent, paid).",
      inputSchema: { client: z.string().optional(), agreementId: z.string().uuid().optional(), status: z.array(installmentStatus).optional(), open: z.boolean().optional().describe("Alles behalve betaald") },
      annotations: { readOnlyHint: true },
    },
    async ({ client, ...rest }) => json(await data.listInstallments({ ...rest, clientId: (await resolveClient(client)) ?? undefined })),
  );

  const installmentFields = {
    agreementId: z.string().uuid().nullable().optional(),
    projectId: z.string().uuid().nullable().optional(),
    trigger: z.enum(["date", "acceptance", "delivery"]).optional().describe("Op datum, bij akkoord of bij oplevering"),
    dueDate: isoDate.nullable().optional(),
    status: installmentStatus.optional(),
    moneybirdInvoiceId: optText,
    notes: optText,
  };

  server.registerTool(
    "add_installment",
    { title: "Termijn toevoegen", description: "Losse te factureren regel bij een klant, eventueel bij een afspraak.", inputSchema: { client: z.string(), description: z.string().min(1), amountCents: z.number().int(), ...installmentFields } },
    async ({ client, ...rest }) => json(await data.createInstallment({ ...rest, clientId: (await resolveClient(client))! })),
  );

  server.registerTool(
    "update_installment",
    {
      title: "Termijn wijzigen",
      description: "Wijzig een termijn, bijvoorbeeld de status (datums voor gefactureerd en betaald worden automatisch ingevuld).",
      inputSchema: { id: z.string().uuid(), description: z.string().min(1).optional(), amountCents: z.number().int().optional(), invoicedAt: isoDate.nullable().optional(), paidAt: isoDate.nullable().optional(), ...installmentFields },
    },
    async ({ id, ...rest }) => json(await data.updateInstallment(id, rest)),
  );

  server.registerTool(
    "delete_installment",
    { title: "Termijn verwijderen", description: "Verwijder een termijn.", inputSchema: { id: z.string().uuid() }, annotations: { destructiveHint: true } },
    async ({ id }) => json(await data.deleteInstallment(id)),
  );

  server.registerTool(
    "get_revenue",
    {
      title: "Omzetoverzicht",
      description: "MRR, jaaromzet vast (MRR x 12), MRR per dienst en per klant, verwachte omzet per maand (wat er gefactureerd wordt), termijnen klaar om te factureren, gefactureerd maar onbetaald en afspraken die binnen 30 dagen eindigen. Bedragen in centen excl. btw.",
      inputSchema: { months: z.number().int().min(1).max(24).optional().describe("Aantal maanden vooruit, standaard 12") },
      annotations: { readOnlyHint: true },
    },
    async ({ months }) => json(await data.revenueOverview(months ?? 12)),
  );

  /* ---- Pipeline: leads en offertes ---- */

  const leadStatus = z.enum(["new", "contact", "quoted", "won", "lost"]);
  const quoteStatus = z.enum(["draft", "sent", "accepted", "rejected", "expired"]);
  const leadFields = {
    companyName: optText.describe("Bedrijfsnaam bij een nieuw bedrijf; leeg bij een bestaande klant"),
    client: z.string().nullable().optional().describe("Bestaande klant (id of naam)"),
    contactName: optText,
    contactEmail: optText,
    contactPhone: optText,
    source: optText.describe("Hoe binnengekomen, bijv. Netwerk, Doorverwijzing, Website, LinkedIn"),
    interests: z.array(kind).optional().describe("Soorten dienst waar interesse in is"),
    estimatedValueCents: z.number().int().min(0).nullable().optional().describe("Geschatte waarde eerste jaar in centen excl. btw (zolang er geen offerte is)"),
    probabilityPct: z.number().int().min(0).max(100).optional().describe("Kans; leeg = standaard bij de status (new 20, contact 40, quoted 60)"),
    nextStep: optText,
    nextStepDate: isoDate.nullable().optional(),
    status: leadStatus.optional(),
    lostReason: optText,
    notes: optText,
  };
  const quoteLine = z.object({
    kind,
    description: optText,
    amountCents: z.number().int().min(0).optional().describe("Centen excl. btw: eenmalig, per periode of per uur. Leeg bij sparringpartner = 12500"),
    pricing: z.enum(["recurring", "one_off", "hourly"]).optional().describe("Leeg = standaard voor de soort"),
    period: z.enum(["month", "quarter", "year"]).nullable().optional(),
    budgetCents: z.number().int().min(0).nullable().optional().describe("Bij uurtarief: budget/plafond"),
    sessionsPerMonth: z.number().int().min(0).nullable().optional(),
    domain: optText.describe("Domein bij website, hosting of beheer; wordt bij akkoord een website van de klant"),
    startDate: isoDate.nullable().optional().describe("Leeg = datum van akkoord"),
  });

  function slimLead(l: data.LeadRow) {
    return {
      id: l.id, company: l.clientName ?? l.companyName, clientId: l.clientId, title: l.title, status: l.status,
      probabilityPct: l.probabilityPct, valueCents: l.valueCents, weightedCents: l.weightedCents,
      nextStep: l.nextStep, nextStepDate: l.nextStepDate, nextStepDue: l.nextStepDue, source: l.source, interests: l.interests,
      contact: { name: l.contactName, email: l.contactEmail, phone: l.contactPhone }, lostReason: l.lostReason, closedAt: l.closedAt, notes: l.notes,
      quotes: l.quotes.map((q) => ({ id: q.id, number: q.number, title: q.title, status: q.status, validUntil: q.validUntil, totals: q.totals })),
    };
  }

  server.registerTool(
    "get_pipeline",
    {
      title: "Pipeline-overzicht",
      description: "Open leads, waarde en gewogen waarde (waarde x kans), openstaande offertes (aantal, waarde eerste jaar, MRR), gewonnen dit jaar en winstpercentage, plus de open leads.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const [overview, leads] = await Promise.all([data.pipelineOverview(), data.listLeads({ open: true })]);
      return json({ ...overview, leads: leads.map(slimLead) });
    },
  );

  server.registerTool(
    "list_leads",
    {
      title: "Leads",
      description: "Leads met hun offertes. Filter op status (new, contact, quoted, won, lost), alleen open, of klant.",
      inputSchema: { status: z.array(leadStatus).optional(), open: z.boolean().optional(), client: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ client, ...rest }) => json((await data.listLeads({ ...rest, clientId: (await resolveClient(client)) ?? undefined })).map(slimLead)),
  );

  server.registerTool(
    "get_lead",
    { title: "Lead", description: "Eén lead met offertes en regels.", inputSchema: { id: z.string().uuid() }, annotations: { readOnlyHint: true } },
    async ({ id }) => json(await data.getLead(id)),
  );

  server.registerTool(
    "create_lead",
    {
      title: "Lead aanmaken",
      description: "Nieuwe lead: een nieuw bedrijf (companyName) of een kans bij een bestaande klant (client). Geef een onderwerp (title) en bij voorkeur een volgende stap met datum.",
      inputSchema: { title: z.string().describe("Waar gaat het over, bijv. 'Nieuwe website met webshop'"), ...leadFields },
    },
    async ({ client, ...rest }) => json(await data.createLead({ ...rest, clientId: await resolveClient(client) })),
  );

  server.registerTool(
    "update_lead",
    {
      title: "Lead wijzigen",
      description: "Wijzig een lead, bijv. volgende stap, kans of status. Status lost met lostReason om hem als verloren te markeren. Gewonnen gaat normaal via accept_quote.",
      inputSchema: { id: z.string().uuid(), title: z.string().optional(), ...leadFields },
    },
    async ({ id, client, ...rest }) => json(await data.updateLead(id, { ...rest, ...(client !== undefined ? { clientId: await resolveClient(client) } : {}) })),
  );

  server.registerTool(
    "delete_lead",
    { title: "Lead verwijderen", description: "Verwijder een lead met zijn offertes (niet als er een offerte met akkoord is).", inputSchema: { id: z.string().uuid() }, annotations: { destructiveHint: true } },
    async ({ id }) => json(await data.deleteLead(id)),
  );

  server.registerTool(
    "list_quotes",
    {
      title: "Offertes",
      description: "Offertes met totalen (eenmalig, per maand, waarde eerste jaar). Filter op status (draft, sent, accepted, rejected, expired) of lead.",
      inputSchema: { status: z.array(quoteStatus).optional(), leadId: z.string().uuid().optional() },
      annotations: { readOnlyHint: true },
    },
    async (args) => json(await data.listQuotes(args)),
  );

  server.registerTool(
    "get_quote",
    { title: "Offerte", description: "Eén offerte met regels, totalen en lead.", inputSchema: { id: z.string().uuid() }, annotations: { readOnlyHint: true } },
    async ({ id }) => json(await data.getQuote(id)),
  );

  server.registerTool(
    "create_quote",
    {
      title: "Offerte aanmaken",
      description: "Nieuwe offerte (concept, nummer OFF-jaar-volgnummer, standaard 30 dagen geldig) bij een lead, met regels. Zonder leadId wordt eerst een lead aangemaakt voor client of companyName met leadTitle.",
      inputSchema: {
        leadId: z.string().uuid().optional(),
        client: z.string().optional().describe("Zonder leadId: bestaande klant (id of naam)"),
        companyName: z.string().optional().describe("Zonder leadId: nieuw bedrijf"),
        leadTitle: z.string().optional().describe("Zonder leadId: onderwerp van de nieuwe lead (standaard de offertetitel)"),
        title: optText,
        quoteDate: isoDate.optional(),
        validUntil: isoDate.optional(),
        url: optText.describe("Link naar het offertedocument"),
        notes: optText,
        lines: z.array(quoteLine).optional(),
      },
    },
    async ({ leadId, client, companyName, leadTitle, ...rest }) => {
      let id = leadId;
      if (!id) {
        const clientId = await resolveClient(client);
        if (!clientId && !companyName) throw new Error("Geef leadId, client of companyName.");
        const lead = await data.createLead({ title: leadTitle ?? rest.title ?? "Offerte", clientId, companyName });
        id = lead.id;
      }
      return json(await data.createQuote({ ...rest, leadId: id }));
    },
  );

  server.registerTool(
    "update_quote",
    {
      title: "Offerte wijzigen",
      description: "Wijzig titel, datum, geldigheid, documentlink of notitie van een offerte.",
      inputSchema: { id: z.string().uuid(), title: optText, quoteDate: isoDate.optional(), validUntil: isoDate.nullable().optional(), url: optText, notes: optText },
    },
    async ({ id, ...rest }) => json(await data.updateQuote(id, rest)),
  );

  server.registerTool(
    "add_quote_line",
    { title: "Offerteregel toevoegen", description: "Voeg een dienst toe aan een offerte (niet na akkoord).", inputSchema: { quoteId: z.string().uuid(), line: quoteLine } },
    async ({ quoteId, line }) => json(await data.addQuoteLine(quoteId, line)),
  );

  server.registerTool(
    "update_quote_line",
    { title: "Offerteregel wijzigen", description: "Wijzig een offerteregel (niet na akkoord).", inputSchema: { id: z.string().uuid(), line: quoteLine.partial() } },
    async ({ id, line }) => json(await data.updateQuoteLine(id, line)),
  );

  server.registerTool(
    "delete_quote_line",
    { title: "Offerteregel verwijderen", description: "Verwijder een offerteregel (niet na akkoord).", inputSchema: { id: z.string().uuid() }, annotations: { destructiveHint: true } },
    async ({ id }) => json(await data.deleteQuoteLine(id)),
  );

  server.registerTool(
    "set_quote_status",
    {
      title: "Offertestatus",
      description: "Zet een offerte op sent (verstuurd; lead gaat naar quoted), rejected (afgewezen), expired of terug naar draft. Voor akkoord: accept_quote.",
      inputSchema: { id: z.string().uuid(), status: z.enum(["draft", "sent", "rejected", "expired"]) },
    },
    async ({ id, status }) => json(await data.setQuoteStatus(id, status)),
  );

  server.registerTool(
    "accept_quote",
    {
      title: "Offerte akkoord",
      description: "Verwerk het akkoord van de klant: klant aanmaken of activeren, websites per domein, elke regel een actieve afspraak, websiteproject en termijnen (eerste termijn klaar om te factureren), lead gewonnen, andere open offertes van de lead afgewezen. Alleen op verzoek van Marc.",
      inputSchema: { id: z.string().uuid(), startDate: isoDate.optional().describe("Startdatum van de afspraken; standaard vandaag") },
    },
    async ({ id, startDate }) => json(await data.acceptQuote(id, { startDate })),
  );

  /* ---- Uren ---- */

  const timeFields = {
    client: z.string().nullable().optional().describe("Klant-id of klantnaam"),
    projectId: z.string().uuid().nullable().optional(),
    taskId: z.string().uuid().nullable().optional().describe("Taak; neemt project, klant en omschrijving over"),
    agreementId: z.string().uuid().nullable().optional().describe("Afspraak; standaard automatisch (uurtarief-afspraak van project of klant)"),
    area: area.optional(),
    category: optText.describe("Soort werk, bijv. Klantwerk, Administratie, Acquisitie, Leren"),
    description: optText,
    billable: z.boolean().nullable().optional().describe("Leeg = automatisch: declarabel bij een uurtarief-afspraak"),
  };

  server.registerTool(
    "get_timer",
    { title: "Lopende timer", description: "De timer die nu loopt, of null.", inputSchema: {}, annotations: { readOnlyHint: true } },
    async () => {
      const t = await data.getRunningTimer();
      return json(t ? slimEntry(t) : null);
    },
  );

  server.registerTool(
    "start_timer",
    { title: "Timer starten", description: "Start een timer. Een lopende timer wordt eerst gestopt.", inputSchema: timeFields },
    async ({ client, ...rest }) => {
      const r = await data.startTimer({ ...rest, clientId: await resolveClient(client) });
      return json({ started: r.started, stoppedPrevious: r.stopped });
    },
  );

  server.registerTool(
    "stop_timer",
    { title: "Timer stoppen", description: "Stop de lopende timer. Optioneel de omschrijving aanvullen.", inputSchema: { description: optText } },
    async ({ description }) => {
      const r = await data.stopTimer(description ? { description } : {});
      return json(r ? { stopped: r, duration: formatDuration(r.durationMin) } : { stopped: null, message: "Er liep geen timer." });
    },
  );

  server.registerTool(
    "log_time",
    {
      title: "Uren schrijven",
      description: "Schrijf uren achteraf: een duur, of een begin- en eindtijd. Datum standaard vandaag.",
      inputSchema: {
        ...timeFields,
        date: isoDate.optional(),
        duration: z.string().optional().describe("Bijv. 1:30, 1,5, 90m, 2u"),
        durationMin: z.number().int().positive().max(1440).optional(),
        startTime: z.string().regex(/^\d{1,2}:\d{2}$/).optional().describe("UU:MM"),
        endTime: z.string().regex(/^\d{1,2}:\d{2}$/).optional().describe("UU:MM"),
      },
    },
    async ({ client, date, duration, durationMin, ...rest }) =>
      json(await data.logTime({ ...rest, clientId: await resolveClient(client), entryDate: date, durationMin: minutesFrom(duration, durationMin) })),
  );

  server.registerTool(
    "list_time_entries",
    {
      title: "Urenregistraties",
      description: "Registraties tussen twee datums (standaard deze week), optioneel per klant of project.",
      inputSchema: {
        from: isoDate.optional(),
        to: isoDate.optional(),
        client: z.string().optional(),
        projectId: z.string().uuid().optional(),
        billable: z.boolean().optional(),
        uninvoiced: z.boolean().optional().describe("Alleen nog niet gefactureerd"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ from, to, client, ...rest }) => {
      const ws = weekStart(today());
      const rows = await data.listTimeEntries({ from: from ?? ws, to: to ?? addDaysIso(ws, 6), clientId: (await resolveClient(client)) ?? undefined, ...rest });
      return json({ totalMin: rows.reduce((s, e) => s + e.minutes, 0), entries: rows.map(slimEntry) });
    },
  );

  server.registerTool(
    "update_time_entry",
    {
      title: "Registratie wijzigen",
      description: "Wijzig een urenregistratie.",
      inputSchema: {
        id: z.string().uuid(),
        ...timeFields,
        date: isoDate.optional(),
        duration: z.string().optional(),
        durationMin: z.number().int().positive().max(1440).optional(),
        startTime: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
        endTime: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
        invoiced: z.boolean().optional(),
      },
    },
    async ({ id, client, date, duration, durationMin, ...rest }) => {
      const patch: data.TimeEntryInput = { ...rest, entryDate: date, durationMin: minutesFrom(duration, durationMin) };
      if (client !== undefined) patch.clientId = await resolveClient(client);
      return json(await data.updateTimeEntry(id, patch));
    },
  );

  server.registerTool(
    "delete_time_entry",
    { title: "Registratie verwijderen", description: "Verwijder een urenregistratie.", inputSchema: { id: z.string().uuid() }, annotations: { destructiveHint: true } },
    async ({ id }) => json(await data.deleteTimeEntry(id)),
  );

  server.registerTool(
    "get_hours",
    {
      title: "Urenoverzicht",
      description: "Weekoverzicht per klant en gebied (minuten per dag), uren per soort werk, declarabele uren die nog gefactureerd moeten worden, budget per uurtarief-afspraak (waarschuwing vanaf 80%) en effectief uurtarief per klant (omzet / alle uren). Bedragen in centen excl. btw.",
      inputSchema: {
        week: isoDate.optional().describe("Een dag in de week; standaard deze week"),
        client: z.string().optional(),
        period: z.enum(["month", "quarter", "year", "12m"]).optional().describe("Periode voor het effectief uurtarief, standaard year"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ week, client, period }) => {
      const clientId = (await resolveClient(client)) ?? undefined;
      const [summary, queue, budgets, rates] = await Promise.all([
        data.weekSummary(week ?? today(), { clientId }),
        data.billableQueue({ clientId }),
        data.hourlyBudgets({ clientId }),
        data.effectiveRates(period ?? "year"),
      ]);
      const { entries, ...rest } = summary;
      return json({
        week: { ...rest, entries: entries.map(slimEntry) },
        toInvoice: queue.map(({ entryIds, ...g }) => ({ ...g, entries: entryIds.length })),
        budgets,
        effectiveRates: clientId ? { ...rates, clients: rates.clients.filter((c) => c.clientId === clientId) } : rates,
      });
    },
  );

  server.registerTool(
    "invoice_hours",
    {
      title: "Uren klaarzetten voor factuur",
      description: "Maakt van alle open declarabele uren van een uurtarief-afspraak één termijn 'klaar om te factureren' en markeert de uren als gefactureerd. Alleen doen als Marc daarom vraagt.",
      inputSchema: { agreementId: z.string().uuid(), upTo: isoDate.optional().describe("Alleen uren tot en met deze datum") },
    },
    async ({ agreementId, upTo }) => json(await data.invoiceHours(agreementId, upTo)),
  );

  /* ---- Documenten ---- */

  server.registerTool(
    "add_document",
    {
      title: "Document koppelen",
      description: "Link naar een document bij een klant (offerte, overeenkomst, verwerkersovereenkomst, overig). Het bestand zelf staat elders.",
      inputSchema: {
        client: z.string().describe("Klant-id of naam"),
        title: z.string().min(1),
        kind: z.enum(["quote", "agreement", "dpa", "other"]).optional(),
        url: optText,
        docDate: isoDate.nullable().optional(),
        notes: optText,
      },
    },
    async ({ client, ...rest }) => json(await data.createDocument({ ...rest, clientId: (await resolveClient(client))! })),
  );

  server.registerTool(
    "delete_document",
    { title: "Documentlink verwijderen", description: "Verwijder een documentlink.", inputSchema: { id: z.string().uuid() }, annotations: { destructiveHint: true } },
    async ({ id }) => json(await data.deleteDocument(id)),
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

  /* ---- Aangiftecyclus ---- */

  const filingKind = z
    .enum(["vat", "income_tax", "corporate_tax", "icp", "payroll", "other"])
    .describe("vat = btw, income_tax = IB, corporate_tax = Vpb, icp = ICP-opgaaf, payroll = loonheffingen, other = overig");
  const filingStatus = z.enum(["todo", "waiting_docs", "in_progress", "review", "filed", "done"]);

  server.registerTool(
    "list_filings",
    {
      title: "Aangiftes",
      description:
        "Aangifte-items van boekhoudklanten met deadline, status en signaal (state: overdue, due_soon, docs_missing, running = periode loopt nog, ok, closed). Standaard alle open items, gesorteerd op deadline.",
      inputSchema: {
        client: z.string().optional().describe("Klant-id of klantnaam"),
        status: z.array(filingStatus).optional(),
        open: z.boolean().optional().describe("Alleen nog niet ingediend (standaard true als status leeg is)"),
        kind: filingKind.optional(),
        year: z.number().int().optional().describe("Jaar waarin de periode begint"),
        deadlineBefore: isoDate.optional(),
        includeRunning: z.boolean().optional().describe("Ook perioden die nog lopen (standaard true)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ client, status, open, ...rest }) => {
      const rows = await data.listFilings({ ...rest, clientId: (await resolveClient(client)) ?? undefined, status, open: open ?? !status?.length });
      return json(rows.map(data.slimFiling));
    },
  );

  server.registerTool(
    "get_filing",
    { title: "Aangifte", description: "Eén aangifte-item met alle datums, uitkomst en gekoppelde taak.", inputSchema: { id: z.string().uuid() }, annotations: { readOnlyHint: true } },
    async ({ id }) => {
      const f = await data.getFiling(id);
      if (!f) throw new Error("Aangifte niet gevonden");
      return json({ ...data.slimFiling(f), deadlineManual: f.deadlineManual, scheduleId: f.scheduleId });
    },
  );

  server.registerTool(
    "update_filing",
    {
      title: "Aangifte bijwerken",
      description:
        "Status, datums, uitkomst of notitie van een aangifte. Ingediend/afgerond vult de datum met vandaag en rondt de taak af. docsRequestedAt zet 'te doen' op 'wacht op stukken'; docsReceivedAt zet 'wacht op stukken' terug op 'te doen'. Een gewijzigde deadline blijft staan. Alleen op verzoek van Marc.",
      inputSchema: {
        id: z.string().uuid(),
        status: filingStatus.optional(),
        deadline: isoDate.optional(),
        docsDueDate: isoDate.nullable().optional(),
        docsRequestedAt: isoDate.nullable().optional(),
        docsReceivedAt: isoDate.nullable().optional(),
        filedAt: isoDate.nullable().optional(),
        doneAt: isoDate.nullable().optional(),
        amountCents: z.number().int().nullable().optional().describe("Uitkomst in centen: positief = te betalen, negatief = terug"),
        reference: optText,
        notes: optText,
      },
    },
    async ({ id, ...patch }) => json(data.slimFiling(await data.updateFiling(id, patch))),
  );

  server.registerTool(
    "create_filing",
    {
      title: "Losse aangifte",
      description: "Aangifte buiten de vaste cyclus (bijv. suppletie of een ouder jaar), met taak. Deadline leeg = wettelijke deadline.",
      inputSchema: {
        client: z.string().describe("Klant-id of klantnaam"),
        kind: filingKind,
        label: optText.describe("Eigen naam, bijv. Suppletie btw"),
        periodStart: isoDate.describe("Een datum in de periode"),
        frequency: z.enum(["month", "quarter", "year"]).optional(),
        deadline: isoDate.optional(),
        notes: optText,
      },
    },
    async ({ client, ...rest }) => {
      const clientId = await resolveClient(client);
      if (!clientId) throw new Error("Klant ontbreekt");
      return json(data.slimFiling(await data.createFiling({ ...rest, clientId })));
    },
  );

  server.registerTool(
    "draft_docs_reminder",
    {
      title: "Conceptmail stukken opvragen",
      description:
        "Conceptmail (onderwerp, tekst, ontvanger) om de stukken voor een aangifte op te vragen, in de toon van MLC. Verstuurt niets. Leg na versturen door Marc vast met update_filing (docsRequestedAt).",
      inputSchema: { id: z.string().uuid() },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      const r = await data.filingReminder(id);
      return json({ to: r.to, contactName: r.contactName, client: r.client, subject: r.subject, body: r.body });
    },
  );

  server.registerTool(
    "list_filing_schedules",
    {
      title: "Aangifte-instellingen",
      description: "Welke aangiftes per klant zijn ingesteld (soort, frequentie, uitstel, vanaf/tot, actief).",
      inputSchema: { client: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ client }) => json(await data.listSchedules({ clientId: (await resolveClient(client)) ?? undefined })),
  );

  const scheduleFields = {
    kind: filingKind.optional(),
    label: optText,
    frequency: z.enum(["month", "quarter", "year"]).optional().describe("IB en Vpb altijd per jaar"),
    extension: z.enum(["none", "individual", "becon"]).optional().describe("Alleen IB/Vpb: individual = uitstel aangevraagd, becon = becon-uitstel"),
    startDate: isoDate.optional().describe("Eerste periode = de periode waarin deze datum valt; standaard de huidige"),
    endDate: isoDate.nullable().optional(),
    docsDueDays: z.number().int().min(0).nullable().optional().describe("Stukken binnen X dagen na einde periode; leeg = standaard (10, bij jaar 59)"),
    agreementId: z.string().uuid().nullable().optional(),
    createTasks: z.boolean().optional(),
    active: z.boolean().optional(),
    notes: optText,
  };

  server.registerTool(
    "set_filing_schedule",
    {
      title: "Aangifte instellen of wijzigen",
      description:
        "Zonder id: nieuwe instelling voor een klant (client en kind verplicht). Met id: wijzigen. Andere soort/frequentie bouwt niet-aangeraakte items opnieuw op; ander uitstel herberekent deadlines. Alleen op verzoek van Marc.",
      inputSchema: { id: z.string().uuid().optional(), client: z.string().optional().describe("Verplicht bij een nieuwe instelling"), ...scheduleFields },
    },
    async ({ id, client, ...rest }) => {
      if (id) return json(await data.updateSchedule(id, rest));
      const clientId = await resolveClient(client);
      if (!clientId || !rest.kind) throw new Error("Geef client en kind op voor een nieuwe instelling.");
      return json(await data.createSchedule({ ...rest, kind: rest.kind, clientId }));
    },
  );

  server.registerTool(
    "delete_filing_schedule",
    {
      title: "Aangifte-instelling verwijderen",
      description: "Verwijdert een instelling. Items waar nog niets aan gedaan is gaan mee; de rest blijft bewaard. Alleen op verzoek van Marc.",
      inputSchema: { id: z.string().uuid() },
    },
    async ({ id }) => json(await data.deleteSchedule(id)),
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
  const server = buildServer(await getModules());
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
