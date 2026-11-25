import "server-only";
import { sendPush } from "./push";
import { timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import * as data from "./data";
import { getEvents, calendarConfigured } from "./calendar";
import { addDaysIso, today, weekStart } from "./dates";
import { formatDuration, parseDuration } from "./duration";
import { getModules, MODULES, type ModuleKey, type Modules } from "./settings";
import * as agent from "./agent";

/* ---------------- Authenticatie ---------------- */

function same(token: string | null | undefined, expected: string | undefined): boolean {
  if (!expected || expected.length < 24 || !token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** De MCP-token van Marc (Claude, cron, Mac): alles mag direct. */
export function tokenOk(token: string | null | undefined): boolean {
  return same(token, process.env.MCP_TOKEN);
}

/**
 * Wie belt er aan? owner = MCP_TOKEN (Claude en de vaste taken; alles direct),
 * agent = HERMES_MCP_TOKEN (Hermes; lezen direct, schrijven als voorstel in de akkoordwachtrij).
 */
export type McpRole = "owner" | "agent";
export function tokenRole(token: string | null | undefined): McpRole | null {
  if (same(token, process.env.MCP_TOKEN)) return "owner";
  if (same(token, process.env.HERMES_MCP_TOKEN)) return "agent";
  return null;
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

/** Leeronderwerp mag als id of (deel van de) titel. */
async function resolveLearning(ref: string | null | undefined): Promise<string | null | undefined> {
  if (ref === undefined) return undefined;
  if (ref === null || ref === "") return null;
  const l = await data.findLearning(ref);
  if (!l) throw new Error(`Leeronderwerp "${ref}" niet gevonden. Gebruik list_learning.`);
  return l.id;
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
    planBlockId: t.planBlockId,
    planTime: t.planTime,
    recurrence: t.recurrence,
    notes: t.notes,
    learningId: t.learningId ?? undefined,
    completedAt: t.completedAt,
  };
}

const streakText = (n: number, unit: string) => `${n} ${n === 1 ? (unit === "weken" ? "week" : "dag") : unit} op rij`;

function slimHabit(h: data.HabitStats) {
  return {
    id: h.id,
    title: h.title,
    area: h.area,
    frequency: h.frequencyLabel,
    when: h.whenLabel,
    time: h.time ?? undefined,
    moment: h.momentKey ?? undefined,
    remind: h.remind || undefined,
    block: h.blockTitle,
    dueToday: h.dueToday,
    doneToday: h.doneToday,
    streak: streakText(h.streak, h.streakUnit),
    week: h.week,
    month: h.month,
    archived: !!h.archivedAt,
    autoFromHealth: h.healthRule ?? undefined,
  };
}

function slimDay(d: data.DayPlan) {
  return {
    date: d.date,
    rhythm: d.rhythm?.name ?? null,
    rhythmIsOverride: d.override,
    workday: d.work,
    workMinutesFree: d.workMin,
    plannedMinutes: d.plannedMin,
    events: d.events.map((e) => ({ title: e.title, calendar: e.calendar, allDay: e.allDay, time: e.time, endTime: e.endTime, location: e.location })),
    blocks: d.blocksPlanned.map((b) => ({
      id: b.id,
      title: b.title,
      kind: b.kind,
      start: b.startTime,
      end: b.endTime,
      minutes: b.minutes,
      plannedMinutes: b.plannedMin,
      remind: b.remind,
      current: b.current,
      past: b.past,
      tasks: b.tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, estimateMin: t.estimateMin, planTime: t.planTime, client: t.clientName })),
    })),
    withoutBlock: d.loose.map(slimTask),
    completed: d.done,
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
  learning: z.string().nullable().optional().describe("Leeronderwerp (id of titel): de taak is een stap in dat leerplan; null om te ontkoppelen"),
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
  { text: "- Dagritme en planning: elke dag heeft een dagritme (werkdag, vrijdag, weekend ...) met vaste blokken (dagstart, diep werk, administratie, sport, pauze, dagafsluiting). Taken plan je met plan_task op een dag en in een blok (timeblocking), eventueel op een tijd. get_day_plan geeft per blok de taken, de beschikbare werktijd en wat ingeschat is; get_week_plan de hele week plus taken zonder plek. Een voorstel voor de dagindeling (ochtendbriefing) zet zware taken in diep werk, klein werk in klantwerk of administratie, en past binnen de tijd van het blok (estimateMin). Verplaats taken alleen als Marc daarom vraagt of het voorstel goedkeurt." },
  { text: "- Gewoontes: list_habits geeft per gewoonte of hij vandaag moet, of hij gedaan is, de reeks en het percentage van week en maand. Vink af met check_habit (op naam mag: \"sport\"). Noem in de briefing en dagafsluiting welke gewoontes nog open staan; in de weekreview de reeksen en percentages." },
  { text: "- Gezondheid: Apple Health komt dagelijks binnen (stappen, beweegminuten, actieve energie, slaap, gewicht, voeding met eiwit/koolhydraten/vet, en trainingen). get_health geeft per dag de waarden en per week de sportsessies tegenover het doel (training van minstens 10 minuten, geen wandeling), gemiddelden en gewicht; met weeks ook de trend. Noem in de briefing kort de slaap van vannacht en de sportsessies van deze week; in de weekreview sport, stappen, slaap en gewicht tegenover de doelen (\"drie trainingen deze week, doel is vier\"). Een training die niet via Apple Health binnenkomt, leg je vast met log_workout als Marc dat vraagt. Gewoontes kunnen een healthRule hebben: die worden automatisch afgevinkt (bron health). Geef geen medisch advies; benoem alleen wat de cijfers laten zien." },
  { text: "- Doelen: list_goals geeft per doel de meetwijze, de stand, het doel en de on-track-status (ahead = voor op schema, on_track, behind = achter, at_risk = risico, achieved, missed, upcoming, inactive = wacht op een module die uit staat, no_data). summary legt uit hoe het ervoor staat; needed zegt wat er nog nodig is. Verwacht = waar Marc nu zou moeten staan (het deel van de periode dat voorbij is); bij een doel per week of maand telt het gemiddelde. Noem in de ochtendbriefing kort het hoofddoel (featured) en doelen met risico; in de weekreview alle lopende doelen met status en wat er nodig is. Handmatige doelen (bijv. LinkedIn-volgers) werk je bij met log_goal_value als Marc een stand noemt; mijlpalen vink je af met set_milestone. Maak of wijzig doelen alleen op verzoek van Marc." },
  { text: "- Leren: leeronderwerpen (cursus, boek, vaardigheid, certificering) met doel, status, voortgang en bestede tijd (list_learning, get_learning). Tijd leg je vast met log_learning (\"1 uur aan de Google Ads-cursus\" → topic \"Google Ads\", duration \"1u\"), los van de module Uren. Een leerplan bestaat uit taken met learning (create_task met learning); die plan je met plan_task in een blok van soort leren. Bewaar bronnen bij een onderwerp met add_source en learning. Link in notities naar een onderwerp met [[leren:Titel]]. Een leerplan voorstellen mag; taken aanmaken alleen na akkoord van Marc." },
  { text: "- Klanten hebben een dossier (get_client) met contactpersonen, vaste informatie, projecten, taken en notities. Sla nooit wachtwoorden op; vaultRef is alleen een verwijzing." },
  { text: "- Uitgebreid dossier: ook registratie (KvK, btw), adressen, facturatie, verwerkersovereenkomst, tags en documentlinks (add_document).", module: "dossier" },
  { text: "- Websites zijn eigen objecten per klant met domein, registrar, verloopdatum en of hosting en beheer door Marc gebeuren (list_websites).", module: "websites" },
  { text: "- Afspraken zijn diensten per klant (boekhouding, website, hosting, beheer, sparringpartner, maatwerk). Bedragen zijn in centen en exclusief btw. MRR = som van lopende vaste afspraken omgerekend naar per maand (get_revenue).", module: "afspraken" },
  { text: "- Termijnen zijn te factureren regels. Een eenmalige website-afspraak maakt zelf 2 termijnen van 50% (bij akkoord, bij oplevering). Facturen maakt Marc zelf in Moneybird; zet een termijn alleen op een andere status als Marc dat vraagt.", module: "afspraken" },
  { text: "- Uren: alles mag uren krijgen (klantwerk, bedrijf algemeen, privé, leren). Er loopt hooguit één timer; start_timer stopt een lopende timer. Voor achteraf schrijven gebruik log_time (\"2 uur aan Vobis, SEO-analyse\" → client \"Vobis\", duration \"2u\", description \"SEO-analyse\"). Declarabel gaat automatisch als de uren onder een afspraak met uurtarief vallen. get_hours geeft het weekoverzicht, te factureren uren, budgetten (waarschuwing vanaf 80%) en het effectief uurtarief per klant.", module: "uren" },
  { text: "- Pipeline: een lead is een kans (nieuw bedrijf of bestaande klant) met status new/contact/quoted/won/lost, kans in procenten en een volgende stap. Een offerte hoort altijd bij een lead en heeft regels per dienst (zelfde velden als een afspraak). accept_quote verwerkt een akkoord met één aanroep: klant aanmaken of activeren, websites per domein, elke regel een actieve afspraak, websiteproject en termijnen (eerste termijn klaar om te factureren), lead gewonnen. Doe accept_quote, set_quote_status en delete-acties alleen als Marc daarom vraagt.", module: "pipeline" },
  { text: "- Aangiftecyclus: per boekhoudklant staat ingesteld welke aangiftes Marc doet (btw per maand/kwartaal/jaar, IB, Vpb, ICP, loonheffingen, overig) met eventueel uitstel (individueel of becon). Daaruit ontstaat per periode automatisch een aangifte-item met wettelijke deadline, datum waarop de stukken binnen moeten zijn en (na afloop van de periode) een taak. Statussen: todo, waiting_docs (wacht op stukken), in_progress, review (klaar voor controle), filed (ingediend), done (afgerond: betaald of ontvangen). list_filings en get_overview tonen signalen (deadline binnen 14 dagen, te laat, stukken ontbreken). draft_docs_reminder geeft een conceptmail om stukken op te vragen; verstuur nooit zelf, Marc verstuurt na akkoord. Wijzig statussen of instellingen alleen als Marc daarom vraagt.", module: "aangiftes" },
  { text: "- Inbox-items zijn notities van het type \"inbox\" (braindump). Verwerk ze met inbox_to_task of update_note; een link of idee om te bewaren wordt een bron (add_source)." },
  { text: "- Second brain: notities zijn markdown en mogen [[links]] bevatten naar andere notities, klanten, projecten en bronnen, op naam: [[Vobis]], [[Gesprek SEO-strategie]]. Is een naam dubbel, gebruik dan een voorvoegsel: [[klant:Vobis]], [[project:...]], [[bron:...]], [[notitie:...]]. Link in gespreksverslagen naar de klant en eerdere notities zodat de backlinks kloppen. get_note geeft ook de links vanuit en naar de notitie; get_backlinks geeft wat naar een klant, project, bron of notitie verwijst." },
  { text: "- Vragen over wat er eerder is besproken of afgesproken (\"wat hebben we met Vobis afgesproken over SEO?\") beantwoord je met search_knowledge: zoekt op betekenis (als semantisch zoeken aan staat) en op trefwoord in notities en bronnen, en geeft per treffer een stuk tekst. Lees zo nodig de hele notitie met get_note en noem de notities waarop je antwoord steunt." },
  { text: "- Bronnen zijn links, artikelen, video's en ideeën om te bewaren (add_source; met alleen een url haalt Marc OS titel en beschrijving zelf op). Vat een bron kort samen in summary als Marc daarom vraagt of als hij hem doorstuurt om te bewaren." },
  { text: "- Met send_push stuur je Marc een pushmelding op zijn telefoon. Gebruik het spaarzaam: als hij erom vraagt, of als iets nu zijn aandacht nodig heeft." },
  { text: "- Begin een briefing altijd met get_overview. Sla briefings en samenvattingen op met save_review zodat Marc ze in de app ziet." },
  { text: "- Tijdzone: Europe/Amsterdam. Schrijf in het Nederlands." },
];

function instructions(modules: Modules) {
  const off = (Object.keys(MODULES) as ModuleKey[]).filter((k) => !modules[k]);
  const lines = [
    "Dit is Marc OS: Marc's centrale systeem voor taken, projecten, klanten, notities (second brain met [[links]] en bronnen) en reviews.",
    ...INSTRUCTION_LINES.filter((l) => !l.module || modules[l.module]).map((l) => l.text),
  ];
  if (off.length) {
    lines.push(
      `- Tijdelijk uitgeschakeld (MVP): ${off.map((k) => MODULES[k].label).join(", ")}. Daar zijn geen tools voor. Vraagt Marc ernaar, zeg dan dat de module uit staat en dat hij hem aanzet via Instellingen → Modules.`,
    );
  }
  return lines.join("\n");
}

/* ---------------- Rollen, akkoordwachtrij en logboek (gesprek 12) ---------------- */

type ToolConfig = {
  title?: string;
  description?: string;
  inputSchema?: z.ZodRawShape;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
};
type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
type ToolCb = (args: Record<string, unknown>, extra: unknown) => Promise<ToolResult>;
export type ToolEntry = { name: string; config: ToolConfig; cb: ToolCb; readOnly: boolean };

export type BuildOptions = {
  /** owner: alles direct (met logboek van schrijfacties). agent: Hermes, schrijven wordt een voorstel. */
  role?: McpRole;
  /** Tools die Hermes zonder akkoord mag uitvoeren */
  autoTools?: string[];
  /** Vul deze map met alle aangeboden tools (voor uitvoeren na akkoord en de instellingen) */
  collect?: Map<string, ToolEntry>;
};

const AGENT_INSTRUCTIONS = [
  "",
  "Akkoordwachtrij (je bent Hermes, verbonden met je eigen sleutel):",
  "- Lezen gaat direct. Elke actie die iets wijzigt, wordt een VOORSTEL in Marc's akkoordwachtrij en is dan nog NIET uitgevoerd. Het antwoord van de tool zegt status pending met een voorstel-id.",
  "- Zeg dan tegen Marc kort wat je voorstelt en dat het op zijn akkoord wacht (in de app met één tik). Doe niet alsof het al gebeurd is.",
  "- Geef bij een voorstel in reden een korte uitleg (één zin) waarom.",
  "- Doe één voorstel per ding. Hangt een tweede actie af van de eerste (bijv. taak in een nieuw project), stel dan eerst de eerste voor en wacht op akkoord (list_proposals) voordat je de tweede voorstelt.",
  "- Zegt Marc \"pas aan: ...\" (of \"pas aan 12: ...\"), trek je eigen voorstel in met withdraw_proposal en doe een nieuw voorstel.",
  "- Elk voorstel heeft een nummer (#12). In WhatsApp noem je dat nummer; Marc antwoordt met \"ja\", \"ja 12\", \"ja alles\" of \"nee 12: reden\". Die antwoorden handelt Marc OS zelf af, jij kunt niets goedkeuren. Vraag dus niet \"zal ik het voorstellen?\": doe gewoon het voorstel.",
  "- Sommige acties mag je zonder akkoord doen (Marc stelt dat in): dan voert de tool ze direct uit en staat er executed. Daarbij horen meestal vastleggen en afvinken.",
  "- Alles wat je doet wordt gelogd. Verstuur nooit iets namens Marc naar anderen.",
].join("\n");

const argSummary = (args: Record<string, unknown>) =>
  Object.entries(args)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .slice(0, 4)
    .map(([k, v]) => `${k}=${String(typeof v === "object" ? JSON.stringify(v) : v).slice(0, 40)}`)
    .join(", ");

export function buildServer(modules: Modules, opts: BuildOptions = {}) {
  const role = opts.role ?? "owner";
  const auto = new Set(opts.autoTools ?? []);
  const server = new McpServer(
    { name: "marc-os", version: "0.2.0" },
    { instructions: instructions(modules) + (role === "agent" ? AGENT_INSTRUCTIONS : "") },
  );

  // Tools van uitgeschakelde modules worden niet geregistreerd, zodat Claude en Hermes er niet mee werken.
  // Voor Hermes (agent) worden schrijfacties omgezet in voorstellen; alles wordt gelogd.
  const register = server.registerTool.bind(server) as unknown as (n: string, c: ToolConfig, f: ToolCb) => unknown;
  server.registerTool = ((name: string, config: ToolConfig, cb: ToolCb) => {
    const m = TOOL_MODULE[name];
    if (m && !modules[m]) return undefined;
    const readOnly = !!config.annotations?.readOnlyHint;
    opts.collect?.set(name, { name, config, cb, readOnly });

    if (role === "owner") {
      if (readOnly || opts.collect) return register(name, config, cb);
      // Claude (of de vaste taken): direct uitvoeren, schrijfacties in het logboek
      return register(name, config, async (args, extra) => {
        const res = await cb(args, extra);
        if (!res.isError) void agent.log({ actor: "claude", kind: "direct", tool: name, summary: `${config.title ?? name}${args && Object.keys(args).length ? ` (${argSummary(args)})` : ""}` });
        return res;
      });
    }

    if (readOnly) {
      return register(name, config, async (args, extra) => {
        void agent.log({ actor: "hermes", kind: "read", tool: name, summary: `${config.title ?? name}${args && Object.keys(args).length ? ` (${argSummary(args)})` : ""}` });
        return cb(args, extra);
      });
    }

    if (auto.has(name) && !agent.NEVER_AUTO.has(name)) {
      return register(
        name,
        { ...config, description: `${config.description ?? ""} (Mag zonder akkoord: wordt direct uitgevoerd.)` },
        async (args, extra) => {
          const res = await cb(args, extra);
          const title = await agent.describeCall(name, config.title, args);
          void agent.log({ actor: "hermes", kind: res.isError ? "failed" : "direct", tool: name, summary: title, detail: { args } });
          return res;
        },
      );
    }

    // Schrijfactie zonder toestemming vooraf: een voorstel in de wachtrij
    return register(
      name,
      {
        ...config,
        description: `${config.description ?? ""} (Wordt een voorstel in Marc's akkoordwachtrij; pas na zijn akkoord uitgevoerd.)`,
        inputSchema: { ...(config.inputSchema ?? {}), reden: z.string().max(300).optional().describe("Korte uitleg voor Marc waarom je dit voorstelt") },
        annotations: { ...config.annotations, readOnlyHint: false },
      },
      async (input) => {
        const { reden, ...args } = input as Record<string, unknown> & { reden?: string };
        const title = await agent.describeCall(name, config.title, args);
        const p = await agent.createProposal({ tool: name, args, title, reason: reden ?? null });
        void agent.notifyNewProposal(title);
        return json({
          status: "pending",
          proposal: { id: p.id, nr: p.nr, title },
          message: `Voorstel #${p.nr} staat in Marc's akkoordwachtrij en is nog NIET uitgevoerd. Na zijn akkoord voert Marc OS het uit; met list_proposals zie je de uitkomst. In WhatsApp keurt Marc goed met "ja" (of "ja ${p.nr}") en wijst af met "nee ${p.nr}".`,
        });
      },
    );
  }) as unknown as typeof server.registerTool;

  if (role === "agent") {
    server.registerTool(
      "list_proposals",
      {
        title: "Mijn voorstellen",
        description: "Voorstellen in de akkoordwachtrij: open (pending) of afgehandeld (executed = uitgevoerd na akkoord, rejected = afgewezen met eventueel een reden van Marc, failed = mislukt bij uitvoeren, withdrawn = ingetrokken). Met ids één of meer specifieke voorstellen.",
        inputSchema: {
          status: z.enum(["pending", "decided", "all"]).optional().describe("Standaard all"),
          ids: z.array(z.string().uuid()).optional(),
          limit: z.number().int().positive().max(50).optional(),
        },
        annotations: { readOnlyHint: true },
      },
      async ({ status, ids, limit }) =>
        json(
          (await agent.listProposals({ status: status ?? "all", ids, limit: limit ?? 20 })).map((p) => ({
            id: p.id,
            nr: p.nr,
            title: p.title,
            tool: p.tool,
            status: p.status,
            reason: p.reason,
            createdAt: p.createdAt,
            decidedAt: p.decidedAt,
            note: p.decisionNote,
            editedByMarc: p.edited || undefined,
            result: p.status === "executed" ? p.result : undefined,
            error: p.error ?? undefined,
          })),
        ),
    );

    server.registerTool(
      "withdraw_proposal",
      {
        title: "Voorstel intrekken",
        description: "Trek een eigen voorstel in dat nog op akkoord wacht (bijv. als Marc iets anders wil of \"pas aan 12: ...\" zegt; doe daarna een nieuw voorstel). id = het voorstel-id of het nummer (12 of #12).",
        inputSchema: { id: z.string().min(1), note: z.string().optional() },
        annotations: { readOnlyHint: true },
      },
      async ({ id, note }) => {
        const ref = String(id).trim().replace(/^#/, "");
        const real = /^\d+$/.test(ref) ? (await agent.getProposalByNr(Number(ref)))?.id : ref;
        if (!real || !uuidRe.test(real)) return { ...json({ withdrawn: false, error: `Voorstel ${id} niet gevonden` }), isError: true };
        return json({ withdrawn: !!(await agent.withdrawProposal(real, note)) });
      },
    );
  }

  server.registerTool(
    "get_overview",
    {
      title: "Dagoverzicht",
      description: "Alles voor een briefing: agenda, dagritme van vandaag (blokken met taken, beschikbare werktijd), gewoontes van vandaag, lopende doelen met on-track-status, leren (tijd deze week, onderwerpen waar Marc mee bezig is), taken van vandaag, achterstallig, komende 7 dagen, inbox, lopende projecten en wat gisteren is afgerond. Plus, als die modules aan staan: pipeline, domeinen die binnen 30 dagen verlopen, MRR, termijnen klaar om te factureren, aflopende afspraken, uren deze week, budgetten en aangiftes. modulesOff noemt wat tijdelijk uit staat.",
      inputSchema: { date: isoDate.optional().describe("Standaard vandaag") },
      annotations: { readOnlyHint: true },
    },
    async ({ date }) => {
      const t = date ?? today();
      const [dayPlan, habitList, health, goalList, learning] = await Promise.all([
        data.getDayPlan(t),
        data.listHabits({ date: t }),
        data.healthSnapshot(t),
        data.runningGoals().catch(() => []),
        data.learningSummary(),
      ]);
      const [todayTasks, upcoming, inbox, projects, doneYesterday, cal, lastReviews] = await Promise.all([
        data.listTasks({ view: "today" }),
        data.listTasks({ view: "upcoming", days: 7 }),
        data.listNotes({ type: "inbox" }),
        data.listProjects(),
        data.completedBetween(addDaysIso(t, -1), addDaysIso(t, -1)),
        calendarConfigured().then((on) => (on ? getEvents(t, addDaysIso(t, 1)) : null)),
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
        dayRhythm: {
          rhythm: dayPlan.rhythm?.name ?? null,
          workday: dayPlan.work,
          workMinutesFree: dayPlan.workMin,
          plannedMinutes: dayPlan.plannedMin,
          blocks: dayPlan.blocksPlanned.map((b) => ({ id: b.id, title: b.title, kind: b.kind, start: b.startTime, end: b.endTime, current: b.current, past: b.past, tasks: b.tasks.filter((x) => x.status !== "done").map((x) => x.title) })),
        },
        habitsToday: habitList.filter((h) => h.dueToday || h.doneToday).map((h) => ({ id: h.id, title: h.title, done: h.doneToday, streak: streakText(h.streak, h.streakUnit), weekPct: h.week.pct })),
        health:
          health.configured || health.week.workouts
            ? {
                lastReceived: health.lastReceived,
                noRecentData: health.stale,
                sleepLastNight: health.today.sleep ? { totalMin: health.today.sleep.totalMin } : null,
                today: data.slimHealthDay(health.today),
                yesterday: data.slimHealthDay(health.yesterday),
                thisWeek: { sessions: health.week.sessions, sessionGoal: health.week.goal, workouts: health.week.workouts, avgSteps: health.week.avgSteps == null ? null : Math.round(health.week.avgSteps), avgSleepMin: health.week.avgSleepMin == null ? null : Math.round(health.week.avgSleepMin) },
              }
            : "Nog geen gezondheidsdata (Health Auto Export niet ingesteld)",
        goals: goalList.length
          ? {
              featured: goalList.find((g) => g.featured)?.title ?? null,
              running: goalList.map((g) => ({ id: g.id, title: g.title, area: g.area, current: g.eval.valueLabel, target: g.eval.targetLabel, status: g.eval.status, summary: g.eval.summary, needed: g.eval.needed ?? undefined, featured: g.featured || undefined })),
            }
          : "Nog geen doelen ingesteld (Doelen in de app)",
        learning: {
          minutesThisWeek: learning.minutesThisWeek,
          minutesLastWeek: learning.minutesLastWeek,
          active: learning.active.map((x) => ({ id: x.id, title: x.title, progress: x.progressLabel, minutesThisWeek: x.minutesWeek, openSteps: x.openSteps, targetDate: x.targetDate })),
        },
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
    async ({ client, learning, ...rest }) => {
      const task = await data.createTask({ ...rest, clientId: await resolveClient(client), learningId: await resolveLearning(learning) });
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
    async ({ id, client, learning, ...rest }) => {
      const patch: Partial<data.TaskInput> = { ...rest };
      if (client !== undefined) patch.clientId = await resolveClient(client);
      if (learning !== undefined) patch.learningId = await resolveLearning(learning);
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
    { title: "Notitie lezen", description: "Volledige inhoud van een notitie, met de [[links]] vanuit de notitie en de notities en bronnen die ernaar linken.", inputSchema: { id: z.string().uuid() }, annotations: { readOnlyHint: true } },
    async ({ id }) => {
      const row = await data.getNote(id);
      if (!row) throw new Error("Notitie niet gevonden");
      const [outgoing, backlinks] = await Promise.all([data.getOutgoing("note", id), data.getBacklinks("note", id)]);
      return json({
        ...row,
        links: outgoing.map((o) => (o.resolved ? { label: o.label, kind: o.resolved.kind, id: o.resolved.id, title: o.resolved.title } : { label: o.label, missing: true })),
        backlinks: backlinks.map((b) => ({ kind: b.fromKind, id: b.fromId, title: b.title, context: b.contexts })),
      });
    },
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
    { title: "Notitie aanmaken", description: "Maak een notitie, bijv. gespreksverslag of info voor het klantdossier. Body is markdown en mag [[links]] bevatten.", inputSchema: { title: z.string().min(1), ...noteFields } },
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

  /* ---- Second brain ---- */

  server.registerTool(
    "search_knowledge",
    {
      title: "Second brain doorzoeken",
      description:
        "Zoek in notities en bronnen op betekenis en trefwoord, voor vragen als \"wat hebben we met Vobis afgesproken over SEO?\". Geeft per treffer titel, soort, klant, datum en een stuk tekst (excerpt). mode zegt of er op betekenis is gezocht; reason waarom niet.",
      inputSchema: {
        query: z.string().min(1).describe("De vraag of zoekwoorden, gewoon in het Nederlands"),
        client: z.string().optional().describe("Alleen voor deze klant (id of naam)"),
        kinds: z.array(z.enum(["note", "source"])).optional(),
        limit: z.number().int().positive().max(30).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, client, kinds, limit }) => {
      const r = await data.searchKnowledge(query, { clientId: (await resolveClient(client)) ?? null, kinds, limit: limit ?? 8 });
      return json({
        mode: r.mode,
        reason: r.reason,
        hits: r.hits.map((h) => ({ kind: h.kind, id: h.id, title: h.title, type: h.label, date: h.date, client: h.clientName, project: h.projectName, match: h.match, excerpt: h.excerpt })),
      });
    },
  );

  const linkKindSchema = z.enum(["note", "client", "project", "source"]);

  server.registerTool(
    "get_backlinks",
    {
      title: "Backlinks",
      description: "Notities en bronnen die met een [[link]] naar een notitie, klant, project of bron verwijzen, met de regel waarin de link staat. Plus vermeldingen van de naam zonder link.",
      inputSchema: { kind: linkKindSchema, id: z.string().optional(), name: z.string().optional().describe("Naam als je het id niet hebt (bij klanten ook een deel van de naam)") },
      annotations: { readOnlyHint: true },
    },
    async ({ kind, id, name }) => {
      let ref = id;
      if (!ref && name) {
        if (kind === "client") ref = (await resolveClient(name)) ?? undefined;
        else {
          const { linkKey } = await import("./wikilinks");
          const e = (await data.loadEntities()).find((x) => x.kind === kind && linkKey(x.title) === linkKey(name));
          ref = e?.id;
        }
      }
      if (!ref) throw new Error("Niet gevonden; geef een id of de exacte naam.");
      const [backlinks, mentions] = await Promise.all([data.getBacklinks(kind, ref), data.getUnlinkedMentions(kind, ref)]);
      return json({
        backlinks: backlinks.map((b) => ({ kind: b.fromKind, id: b.fromId, title: b.title, date: b.date, context: b.contexts })),
        unlinkedMentions: mentions.map((m) => ({ ref: m.key, title: m.title, context: m.context })),
      });
    },
  );

  const sourceKind = z.enum(["article", "video", "podcast", "book", "course", "idea", "link"]);
  const sourceStatus = z.enum(["new", "read", "processed"]).describe("new = nog bekijken, read = gelezen, processed = verwerkt");
  const slimSource = (r: { source: import("@/db/schema").Source; clientName: string | null; projectName: string | null }) => ({
    id: r.source.id,
    title: r.source.title,
    url: r.source.url,
    kind: r.source.kind,
    status: r.source.status,
    author: r.source.author,
    summary: r.source.summary,
    client: r.clientName,
    project: r.projectName,
    savedAt: r.source.createdAt,
  });

  server.registerTool(
    "list_sources",
    {
      title: "Bronnen",
      description: "Bewaarde links, artikelen, video's en ideeën. Nog niet bekeken staan bovenaan.",
      inputSchema: { status: sourceStatus.optional(), kind: sourceKind.optional(), client: z.string().optional(), search: z.string().optional(), limit: z.number().int().positive().max(200).optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ client, ...rest }) => json((await data.listSources({ ...rest, clientId: (await resolveClient(client)) ?? undefined })).map(slimSource)),
  );

  server.registerTool(
    "get_source",
    { title: "Bron lezen", description: "Een bron met samenvatting, eigen aantekeningen (body) en backlinks.", inputSchema: { id: z.string().uuid() }, annotations: { readOnlyHint: true } },
    async ({ id }) => {
      const r = await data.getSource(id);
      if (!r) throw new Error("Bron niet gevonden");
      const backlinks = await data.getBacklinks("source", id);
      return json({ ...slimSource(r), body: r.source.body, backlinks: backlinks.map((b) => ({ kind: b.fromKind, id: b.fromId, title: b.title })) });
    },
  );

  const sourceFields = {
    url: z.string().nullable().optional(),
    kind: sourceKind.optional().describe("Standaard geraden uit de link"),
    status: sourceStatus.optional(),
    author: optText.describe("Maker, kanaal of site"),
    summary: optText.describe("Korte samenvatting, 2 tot 4 zinnen"),
    body: optText.describe("Eigen aantekeningen in markdown, mag [[links]] bevatten"),
    area: area.nullable().optional(),
    client: z.string().nullable().optional(),
    projectId: z.string().uuid().nullable().optional(),
    learning: z.string().nullable().optional().describe("Leeronderwerp (id of titel) waar deze bron bij hoort"),
  };

  server.registerTool(
    "add_source",
    {
      title: "Bron bewaren",
      description: "Bewaar een link, artikel, video of idee. Met alleen een url haalt Marc OS titel, beschrijving en site zelf op.",
      inputSchema: { title: z.string().optional(), ...sourceFields, capturedVia: z.string().optional().describe("Bijv. whatsapp; standaard mcp") },
    },
    async ({ client, learning, capturedVia, ...rest }) => json(await data.createSource({ ...rest, clientId: await resolveClient(client), learningId: await resolveLearning(learning), capturedVia: capturedVia ?? "mcp" })),
  );

  server.registerTool(
    "update_source",
    { title: "Bron wijzigen", description: "Wijzig een bron, bijv. de samenvatting of de status. Body vervangt de hele aantekeningen.", inputSchema: { id: z.string().uuid(), title: z.string().optional(), ...sourceFields } },
    async ({ id, client, learning, ...rest }) => {
      const patch: import("./brain").SourcePatch = { ...rest };
      if (client !== undefined) patch.clientId = await resolveClient(client);
      if (learning !== undefined) patch.learningId = await resolveLearning(learning);
      return json(await data.updateSource(id, patch));
    },
  );

  server.registerTool(
    "delete_source",
    { title: "Bron verwijderen", description: "Verwijder een bron. Alleen als Marc daarom vraagt.", inputSchema: { id: z.string().uuid() }, annotations: { destructiveHint: true } },
    async ({ id }) => {
      await data.deleteSource(id);
      return json({ ok: true });
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

  /* ---- Dagritme en planning ---- */

  server.registerTool(
    "get_day_plan",
    {
      title: "Dagplanning",
      description: "Dagritme van een dag met de blokken (begin, einde, soort) en de taken die erin staan, agenda, taken op die dag zonder blok, beschikbare werktijd (werkdag min agenda) en ingeschatte tijd. Plus achterstallig (alleen vandaag), deadlines komende 7 dagen zonder plandatum en taken zonder plek. Gebruik voor een voorstel voor de dagindeling.",
      inputSchema: { date: isoDate.optional().describe("Standaard vandaag") },
      annotations: { readOnlyHint: true },
    },
    async ({ date }) => {
      const d = await data.getDayPlan(date ?? today());
      return json({
        ...slimDay(d),
        overdue: d.overdue.map(slimTask),
        deadlinesNext7dWithoutPlanDate: d.deadlinesSoon.map(slimTask),
        unplaced: d.unplaced.map(slimTask),
        calendarErrors: d.calendarErrors,
      });
    },
  );

  server.registerTool(
    "get_week_plan",
    {
      title: "Weekplanning",
      description: "Zeven dagen (vanaf maandag) met ritme, agenda, blokken met taken, beschikbare werktijd en ingeschatte tijd per dag, plus taken zonder plek en achterstallig. Basis voor de weekplanning in de weekreview.",
      inputSchema: { date: isoDate.optional().describe("Een dag in de week; standaard deze week") },
      annotations: { readOnlyHint: true },
    },
    async ({ date }) => {
      const w = await data.getWeekPlan(weekStart(date ?? today()));
      return json({ weekStart: w.start, days: w.days.map(slimDay), unplaced: w.unplaced.map(slimTask), overdue: w.overdue.map(slimTask), calendarErrors: w.calendarErrors });
    },
  );

  server.registerTool(
    "plan_task",
    {
      title: "Taak inplannen",
      description: "Zet een taak op een dag en optioneel in een dagritmeblok en/of op een tijd (timeblocking). block mag het id of de naam van een blok van die dag zijn (\"diep werk\"; bij twee blokken met dezelfde naam het eerstvolgende). date null haalt de taak uit de planning (zonder plek). Alleen op verzoek of na akkoord van Marc.",
      inputSchema: {
        taskId: z.string().uuid(),
        date: isoDate.nullable().describe("Dag; null = uit de planning"),
        block: z.string().nullable().optional().describe("Blok-id of naam; null = zonder blok; weglaten = blok niet wijzigen"),
        time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional().describe("Tijd HH:mm; null = geen tijd"),
      },
    },
    async ({ taskId, date, block, time }) => {
      let blockId: string | null | undefined = block === undefined ? undefined : null;
      if (date && block) {
        const b = await data.findBlockOnDate(date, block);
        if (!b) {
          const r = await data.dayRhythm(date);
          throw new Error(`Blok "${block}" niet gevonden op ${date} (${r.rhythm?.name ?? "geen ritme"}). Blokken: ${r.blocks.map((x) => `${x.startTime} ${x.title}`).join(", ") || "geen"}.`);
        }
        blockId = b.id;
      }
      const row = await data.planTask(taskId, { date, blockId, time });
      return json({ id: row.id, title: row.title, planDate: row.planDate, planBlockId: row.planBlockId, planTime: row.planTime });
    },
  );

  server.registerTool(
    "list_rhythms",
    {
      title: "Dagritmes",
      description: "De dagritme-sjablonen met weekdagen (1 = maandag ... 7 = zondag), werkdag en blokken (met herinnering ja/nee), plus afwijkende dagen vanaf vandaag.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const [rs, overrides] = await Promise.all([data.listRhythms(), data.listOverrides(today())]);
      return json({
        rhythms: rs.map((r) => ({ id: r.id, name: r.name, weekdays: r.weekdays, workday: r.workStart && r.workEnd ? { start: r.workStart, end: r.workEnd } : null, blocks: r.blocks.map((b) => ({ id: b.id, title: b.title, kind: b.kind, area: b.area, start: b.startTime, end: b.endTime, remind: b.remind, remindBefore: b.remindBefore })) })),
        overrides: overrides.map((o) => ({ date: o.date, rhythm: o.name ?? "vrije dag", note: o.note })),
      });
    },
  );

  server.registerTool(
    "set_day_rhythm",
    {
      title: "Ander dagritme voor één dag",
      description: "Kies voor één datum een ander ritme (naam of id), een vrije dag (\"vrij\") of terug naar het standaardritme (\"standaard\"). Bijv. een vrije vrijdag of werken op zaterdag. Alleen op verzoek van Marc.",
      inputSchema: { date: isoDate, rhythm: z.string().describe("Naam of id van een ritme, \"vrij\" of \"standaard\""), note: z.string().nullable().optional() },
    },
    async ({ date, rhythm, note }) => {
      const q = rhythm.trim().toLowerCase();
      if (q === "standaard" || q === "default") {
        await data.setDayRhythm(date, "default");
      } else if (q === "vrij" || q === "vrije dag" || q === "free") {
        await data.setDayRhythm(date, null, note);
      } else {
        const r = (await data.listRhythms()).find((x) => x.id === rhythm || x.name.toLowerCase() === q);
        if (!r) throw new Error(`Ritme "${rhythm}" niet gevonden. Gebruik list_rhythms.`);
        await data.setDayRhythm(date, r.id, note);
      }
      const d = await data.dayRhythm(date);
      return json({ date, rhythm: d.rhythm?.name ?? "vrije dag", override: d.override });
    },
  );

  /* ---- Gewoontes ---- */

  server.registerTool(
    "list_habits",
    {
      title: "Gewoontes",
      description: "Gewoontes met frequentie, of ze vandaag moeten en gedaan zijn, de reeks (dagen of weken op rij) en het percentage van deze week en maand.",
      inputSchema: { includeArchived: z.boolean().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ includeArchived }) => json((await data.listHabits({ includeArchived })).map(slimHabit)),
  );

  server.registerTool(
    "check_habit",
    {
      title: "Gewoonte afvinken",
      description: "Vink een gewoonte af voor een dag (standaard vandaag), of haal het vinkje weg met done=false. habit mag het id of (een deel van) de naam zijn. Mag zonder akkoord als Marc zegt dat hij het gedaan heeft.",
      inputSchema: {
        habit: z.string().min(1).describe("Id of naam, bijv. \"sport\""),
        date: isoDate.optional(),
        done: z.boolean().optional().describe("Standaard true"),
        source: z.enum(["mcp", "whatsapp", "health"]).optional().describe("Waar het vandaan komt; standaard mcp"),
      },
    },
    async ({ habit, date, done, source }) => {
      const h = await data.findHabit(habit);
      if (!h) throw new Error(`Gewoonte "${habit}" niet gevonden. Gebruik list_habits.`);
      await data.checkHabit(h.id, date ?? today(), done ?? true, source ?? "mcp");
      const stats = (await data.listHabits({ includeArchived: true })).find((x) => x.id === h.id)!;
      return json(slimHabit(stats));
    },
  );

  server.registerTool(
    "create_habit",
    {
      title: "Gewoonte toevoegen",
      description: "Nieuwe gewoonte. frequency: daily (elke dag), weekly (timesPerWeek keer per week) of days (vaste weekdays, 1 = maandag ... 7 = zondag). Optioneel een vast tijdstip (time, met remind voor een pushmelding) of alleen een dagdeel (moment: ochtend, middag, avond), of een dagritmeblok (blockId uit list_rhythms). Alleen op verzoek van Marc.",
      inputSchema: {
        title: z.string().min(1),
        area: area.optional(),
        frequency: z.enum(["daily", "weekly", "days"]).optional(),
        timesPerWeek: z.number().int().min(1).max(7).optional(),
        weekdays: z.array(z.number().int().min(1).max(7)).optional(),
        blockId: z.string().uuid().nullable().optional(),
        time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional().describe("Vast tijdstip HH:mm (optioneel); bepaalt ook het dagdeel"),
        moment: z.enum(["ochtend", "middag", "avond"]).nullable().optional().describe("Dagdeel als er geen vast tijdstip is; leeg = op elk moment"),
        remind: z.boolean().optional().describe("Pushmelding op het tijdstip (alleen met time)"),
        healthRule: z
          .object({
            metric: z.enum(["workout", "steps", "exercise", "active_energy", "sleep"]),
            min: z.number().min(0).describe("Aantal trainingen, stappen, minuten, kcal of uren slaap"),
            kind: z.enum(["kracht", "cardio", "hardlopen", "fietsen", "wandelen", "zwemmen", "yoga", "sport", "overig"]).nullable().optional(),
            minMinutes: z.number().int().min(0).nullable().optional(),
          })
          .nullable()
          .optional()
          .describe("Automatisch afvinken uit Apple Health, bijv. {metric:\"workout\",min:1} of {metric:\"steps\",min:8000}; null = alleen met de hand"),
      },
    },
    async (input) => json(await data.createHabit(input)),
  );

  server.registerTool(
    "update_habit",
    {
      title: "Gewoonte wijzigen of stoppen",
      description: "Wijzig een gewoonte (zelfde velden als create_habit). archived=true stopt de gewoonte (historie blijft), false maakt hem weer actief. Alleen op verzoek van Marc.",
      inputSchema: {
        id: z.string().uuid(),
        title: z.string().min(1).optional(),
        area: area.optional(),
        frequency: z.enum(["daily", "weekly", "days"]).optional(),
        timesPerWeek: z.number().int().min(1).max(7).nullable().optional(),
        weekdays: z.array(z.number().int().min(1).max(7)).optional(),
        blockId: z.string().uuid().nullable().optional(),
        time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional().describe("Vast tijdstip HH:mm (optioneel); bepaalt ook het dagdeel"),
        moment: z.enum(["ochtend", "middag", "avond"]).nullable().optional().describe("Dagdeel als er geen vast tijdstip is; leeg = op elk moment"),
        remind: z.boolean().optional().describe("Pushmelding op het tijdstip (alleen met time)"),
        healthRule: z
          .object({
            metric: z.enum(["workout", "steps", "exercise", "active_energy", "sleep"]),
            min: z.number().min(0).describe("Aantal trainingen, stappen, minuten, kcal of uren slaap"),
            kind: z.enum(["kracht", "cardio", "hardlopen", "fietsen", "wandelen", "zwemmen", "yoga", "sport", "overig"]).nullable().optional(),
            minMinutes: z.number().int().min(0).nullable().optional(),
          })
          .nullable()
          .optional()
          .describe("Automatisch afvinken uit Apple Health, bijv. {metric:\"workout\",min:1} of {metric:\"steps\",min:8000}; null = alleen met de hand"),
        archived: z.boolean().optional(),
      },
    },
    async ({ id, archived, ...patch }) => {
      if (Object.keys(patch).length) await data.updateHabit(id, patch);
      if (archived !== undefined) await data.archiveHabit(id, archived);
      return json(slimHabit((await data.listHabits({ includeArchived: true })).find((x) => x.id === id)!));
    },
  );

  /* ---- Gezondheid (gesprek 9) ---- */

  server.registerTool(
    "get_health",
    {
      title: "Gezondheid",
      description:
        "Gezondheidsdata uit Apple Health (en met de hand vastgelegde trainingen). Standaard deze week: per dag stappen, beweegminuten, actieve kcal, afstand, rusthartslag, gewicht, voeding (kcal, eiwit, koolhydraten, vet, vezels, water), slaap en trainingen; plus de weektotalen tegenover de doelen. date = een dag in de gewenste week. weeks (2-26) voegt de trend van de laatste weken toe (sportsessies, gem. stappen, gem. slaap, gewicht, gem. kcal).",
      inputSchema: { date: isoDate.optional(), weeks: z.number().int().min(2).max(26).optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ date, weeks }) => {
      const t = date ?? today();
      const [week, last, trend] = await Promise.all([data.healthWeek(t), data.lastHealthImport(), weeks ? data.healthTrend(weeks, t) : Promise.resolve(null)]);
      const r = (x: number | null, d = 0) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);
      return json({
        lastReceived: last?.receivedAt ?? null,
        week: { start: week.start, end: week.end },
        goals: week.goals,
        totals: {
          sessions: week.sessions,
          sessionGoal: week.goals.sessionsPerWeek,
          workouts: week.workouts,
          workoutMinutes: week.workoutMin,
          avgSteps: r(week.avgSteps),
          daysStepGoalMet: week.daysStepGoal,
          avgExerciseMin: r(week.avgExercise),
          avgSleepMin: r(week.avgSleepMin),
          nightsSleepGoalMet: week.daysSleepGoal,
          avgIntakeKcal: r(week.avgIntake),
          avgProteinG: r(week.avgProtein),
          activeKcal: r(week.activeKcal),
          distanceKm: r(week.distanceKm, 1),
          weightKg: r(week.weight, 1),
          weightChangeKg: r(week.weightChange, 1),
          note: "Gemiddelden van stappen, beweging en voeding tellen alleen afgelopen dagen (vandaag nog niet).",
        },
        days: week.days.filter((d) => d.date <= today()).map(data.slimHealthDay),
        trend: trend?.map((w) => ({ weekStart: w.start, sessions: w.sessions, avgSteps: r(w.avgSteps), avgSleepMin: r(w.avgSleepMin), avgIntakeKcal: r(w.avgIntake), weightKg: r(w.weight, 1) })),
      });
    },
  );

  server.registerTool(
    "log_workout",
    {
      title: "Training vastleggen",
      description: "Training vastleggen die niet via Apple Health binnenkomt (bijv. \"45 minuten kracht gedaan\"). kind wordt anders uit de naam geraden. Werkt gewoontes met een gezondheidsregel direct bij. Alleen als Marc zegt dat hij getraind heeft; controleer eerst met get_health of de training er al staat.",
      inputSchema: {
        name: z.string().min(1).describe("Bijv. Krachttraining, Hardlopen"),
        kind: z.enum(["kracht", "cardio", "hardlopen", "fietsen", "wandelen", "zwemmen", "yoga", "sport", "overig"]).optional(),
        date: isoDate.optional().describe("Standaard vandaag"),
        time: z.string().regex(/^\d{2}:\d{2}$/).optional().describe("Begintijd HH:mm"),
        durationMin: z.number().int().min(1).max(1440),
        activeKcal: z.number().int().min(0).optional(),
        distanceKm: z.number().min(0).optional(),
        notes: z.string().optional(),
        source: z.enum(["mcp", "whatsapp"]).optional(),
      },
    },
    async ({ date, source, ...rest }) => json(await data.addWorkout({ ...rest, date: date ?? today(), source: source ?? "mcp" })),
  );

  server.registerTool(
    "delete_workout",
    {
      title: "Training verwijderen",
      description: "Verwijder een training (id uit get_health). Een training uit Apple Health komt terug bij de volgende zending als hij daar nog staat. Alleen op verzoek van Marc.",
      inputSchema: { id: z.string().uuid() },
      annotations: { destructiveHint: true },
    },
    async ({ id }) => json({ deleted: !!(await data.deleteWorkout(id)) }),
  );

  server.registerTool(
    "set_health_goals",
    {
      title: "Gezondheidsdoelen instellen",
      description: "Doelen voor de weekweergave en de cockpit: sportsessies per week, stappen per dag, beweegminuten per dag, uren slaap, en optioneel kcal en eiwit per dag en een streefgewicht (null = geen doel). Alleen op verzoek van Marc.",
      inputSchema: {
        sessionsPerWeek: z.number().int().min(0).max(21).optional(),
        stepsPerDay: z.number().int().min(0).optional(),
        exercisePerDay: z.number().int().min(0).optional(),
        sleepHours: z.number().min(0).max(14).optional(),
        kcalPerDay: z.number().int().min(0).nullable().optional(),
        proteinPerDay: z.number().int().min(0).nullable().optional(),
        weightKg: z.number().min(20).max(400).nullable().optional(),
      },
    },
    async (patch) => json(await data.setHealthGoals(patch)),
  );

  /* ---- Doelen en leren (gesprek 10) ---- */

  const goalSource = z.enum(["mrr", "revenue", "billable_hours", "effective_rate", "quotes_won", "active_clients", "tasks_done", "learning_hours", "health_sessions", "health_steps", "health_exercise", "health_sleep", "weight"]);
  const resolveGoal = async (ref: string) => {
    const g = await data.findGoal(ref);
    if (!g) throw new Error(`Doel "${ref}" niet gevonden. Gebruik list_goals.`);
    return g;
  };
  const resolveHabit = async (ref: string | null | undefined) => {
    if (ref === undefined) return undefined;
    if (!ref) return null;
    const h = await data.findHabit(ref);
    if (!h) throw new Error(`Gewoonte "${ref}" niet gevonden. Gebruik list_habits.`);
    return h.id;
  };
  const goalFields = {
    area: z.enum(["zakelijk", "prive", "gezondheid", "leren"]).optional(),
    periodKind: z.enum(["year", "quarter", "month", "custom"]).optional().describe("year/quarter/month rond startDate (standaard vandaag), of custom met startDate en endDate"),
    startDate: isoDate.optional(),
    endDate: isoDate.optional().describe("Alleen bij custom"),
    parent: z.string().nullable().optional().describe("Bovenliggend doel (id of titel)"),
    measure: z.enum(["auto", "health", "habit", "manual", "milestones", "subgoals"]).optional().describe("auto = uit de app, health = uit Apple Health, habit = gewoonte (doel in %), manual = handmatig getal, milestones, subgoals"),
    source: goalSource.nullable().optional().describe("Bij auto: mrr, revenue (omzet), billable_hours, effective_rate (€/u), quotes_won, active_clients, tasks_done, learning_hours. Bij health: health_sessions, health_steps, health_exercise, health_sleep (uren), weight"),
    habit: z.string().nullable().optional().describe("Bij measure habit: gewoonte (id of naam)"),
    learning: z.string().nullable().optional().describe("Bij source learning_hours: één leeronderwerp (id of titel); leeg = alle"),
    targetValue: z.number().nullable().optional().describe("In gewone eenheden: euro's (niet centen), uren, kg, aantal, procent"),
    startValue: z.number().nullable().optional().describe("Bij een stand (MRR, gewicht, handmatig): beginwaarde; leeg = huidige stand bij aanmaken"),
    unit: z.string().nullable().optional().describe("Bij manual: eenheid, bijv. volgers, reviews, eur, kg"),
    targetPer: z.enum(["day", "week", "month"]).nullable().optional().describe("Bij optellende bronnen (omzet, uren, sessies, uren leren): doel per dag/week/maand; null = totaal over de periode"),
    direction: z.enum(["up", "down"]).nullable().optional().describe("down = lager is beter (hooguit)"),
    curve: z.enum(["linear", "late", "early"]).optional().describe("Verwacht verloop: gelijkmatig, rustige start, snelle start"),
    featured: z.boolean().optional().describe("Hoofddoel in de doelbalk van de cockpit (hooguit één)"),
    notes: z.string().nullable().optional(),
  };
  const goalPatch = async (x: { parent?: string | null; habit?: string | null; learning?: string | null } & Record<string, unknown>) => {
    const { parent, habit, learning, ...rest } = x;
    const out: Partial<data.GoalInput> = rest as Partial<data.GoalInput>;
    if (parent !== undefined) out.parentId = parent ? (await resolveGoal(parent)).id : null;
    if (habit !== undefined) out.habitId = await resolveHabit(habit);
    if (learning !== undefined) out.learningId = await resolveLearning(learning);
    return out;
  };

  server.registerTool(
    "list_goals",
    {
      title: "Doelen",
      description: "Doelen met meetwijze, huidige stand, doel en on-track-status (summary en needed in gewone taal). Standaard alleen niet-gearchiveerde; running=true alleen lopende doelen.",
      inputSchema: { running: z.boolean().optional(), includeArchived: z.boolean().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ running, includeArchived }) => {
      const t = today();
      const list = await data.listGoals({ includeArchived });
      return json(list.filter((g) => !running || (g.startDate <= t && g.endDate >= t)).map(data.slimGoal));
    },
  );

  server.registerTool(
    "get_goal",
    {
      title: "Doel bekijken",
      description: "Eén doel met status, metingen (handmatig), mijlpalen en subdoelen.",
      inputSchema: { goal: z.string().describe("Id of (deel van de) titel") },
      annotations: { readOnlyHint: true },
    },
    async ({ goal }) => {
      const g = await data.getGoal((await resolveGoal(goal)).id);
      if (!g) throw new Error("Doel niet gevonden");
      return json({
        ...data.slimGoal(g),
        notes: g.notes,
        entries: g.entries.slice(0, 20).map((e) => ({ id: e.id, date: e.date, value: e.value, note: e.note })),
        milestones: g.milestoneList.map((m) => ({ id: m.id, title: m.title, dueDate: m.dueDate, done: m.isDone, project: m.projectName })),
        subgoals: g.children.map(data.slimGoal),
      });
    },
  );

  server.registerTool(
    "create_goal",
    {
      title: "Doel aanmaken",
      description:
        "Nieuw doel. Voorbeelden: € 5.500 omzet per maand (measure auto, source revenue, targetValue 5500, targetPer month), effectief € 82 per uur (auto, effective_rate, 82), 1.100 declarabele uren per jaar (auto, billable_hours, 1100), 4x per week sporten (health, health_sessions, 4, week), 80 kg (health, weight, 80), dagafsluiting 90% (habit, habit \"dagafsluiting\", 90), 1.000 LinkedIn-volgers (manual, unit volgers, 1000), website live (milestones). Alleen op verzoek van Marc.",
      inputSchema: { title: z.string().min(1), ...goalFields },
    },
    async (input) => {
      const row = await data.createGoal((await goalPatch(input)) as data.GoalInput);
      return json(data.slimGoal((await data.getGoal(row.id))!));
    },
  );

  server.registerTool(
    "update_goal",
    {
      title: "Doel wijzigen",
      description: "Wijzig een doel (alleen meegegeven velden). archived=true archiveert (verdwijnt uit cockpit en lijsten, blijft bewaard). Alleen op verzoek van Marc.",
      inputSchema: { goal: z.string().describe("Id of titel"), title: z.string().min(1).optional(), ...goalFields, archived: z.boolean().optional() },
    },
    async ({ goal, archived, ...rest }) => {
      const g = await resolveGoal(goal);
      const patch = await goalPatch(rest);
      if (Object.keys(patch).length) await data.updateGoal(g.id, patch);
      if (archived !== undefined) await data.archiveGoal(g.id, archived);
      return json(data.slimGoal((await data.getGoal(g.id))!));
    },
  );

  server.registerTool(
    "delete_goal",
    { title: "Doel verwijderen", description: "Verwijder een doel met metingen en mijlpalen (subdoelen blijven). Liever archiveren (update_goal archived). Alleen op verzoek van Marc.", inputSchema: { goal: z.string() }, annotations: { destructiveHint: true } },
    async ({ goal }) => json({ deleted: !!(await data.deleteGoal((await resolveGoal(goal)).id)) }),
  );

  server.registerTool(
    "log_goal_value",
    {
      title: "Stand van een handmatig doel",
      description: "Leg de stand vast van een doel met measure manual (bijv. \"ik heb nu 640 volgers op LinkedIn\"). Eén meting per dag; opnieuw op dezelfde dag overschrijft.",
      inputSchema: { goal: z.string(), value: z.number(), date: isoDate.optional(), note: z.string().optional(), source: z.enum(["mcp", "whatsapp"]).optional() },
    },
    async ({ goal, value, date, note, source }) => {
      const g = await resolveGoal(goal);
      await data.logGoalValue(g.id, value, date ?? today(), note ?? null, source ?? "mcp");
      return json(data.slimGoal((await data.getGoal(g.id))!));
    },
  );

  server.registerTool(
    "set_milestone",
    {
      title: "Mijlpaal toevoegen, afvinken of verwijderen",
      description: "Zonder id: nieuwe mijlpaal bij het doel (title verplicht). Met id: wijzigen (title, dueDate, done) of delete=true. Een mijlpaal met projectId is klaar zodra dat project is afgerond.",
      inputSchema: {
        goal: z.string(),
        id: z.string().uuid().optional(),
        title: z.string().optional(),
        dueDate: isoDate.nullable().optional(),
        done: z.boolean().optional(),
        projectId: z.string().uuid().nullable().optional(),
        delete: z.boolean().optional(),
      },
    },
    async ({ goal, id, delete: del, ...rest }) => {
      const g = await resolveGoal(goal);
      if (id && del) await data.deleteMilestone(id);
      else if (id) await data.updateMilestone(id, rest);
      else {
        if (!rest.title) throw new Error("Geef de mijlpaal een titel.");
        await data.addMilestone(g.id, { ...rest, title: rest.title });
      }
      const d = (await data.getGoal(g.id))!;
      return json({ ...data.slimGoal(d), milestones: d.milestoneList.map((m) => ({ id: m.id, title: m.title, dueDate: m.dueDate, done: m.isDone, project: m.projectName })) });
    },
  );

  const slimLearning = (x: data.LearningRow) => ({
    id: x.id,
    title: x.title,
    kind: x.kind,
    area: x.area,
    status: x.status,
    goal: x.goal,
    progress: x.progressLabel,
    progressPct: x.pct,
    hoursSpent: Math.round((x.minutesTotal / 60) * 10) / 10,
    hoursTarget: x.hoursTarget,
    minutesThisWeek: x.minutesWeek,
    lastSession: x.lastDate,
    openSteps: x.openSteps,
    startDate: x.startDate,
    targetDate: x.targetDate,
    finishedAt: x.finishedAt,
    url: x.url,
  });
  const learningFields = {
    kind: z.enum(["cursus", "boek", "vaardigheid", "certificering", "overig"]).optional(),
    area: area.optional(),
    status: z.enum(["idee", "bezig", "gepauzeerd", "afgerond"]).optional(),
    goal: z.string().nullable().optional().describe("Waarom, wat Marc ermee wil kunnen"),
    url: z.string().nullable().optional(),
    progressDone: z.number().min(0).optional().describe("Aantal klaar (bij progressUnit) of percentage"),
    progressTotal: z.number().min(0).nullable().optional(),
    progressUnit: z.string().nullable().optional().describe("Bijv. hoofdstukken, lessen; leeg = voortgang in procenten"),
    hoursTarget: z.number().min(0).nullable().optional(),
    startDate: isoDate.nullable().optional(),
    targetDate: isoDate.nullable().optional(),
    notes: z.string().nullable().optional().describe("Aantekeningen in markdown, mag [[links]] bevatten; vervangt de hele tekst"),
  };

  server.registerTool(
    "list_learning",
    { title: "Leeronderwerpen", description: "Leeronderwerpen met status, voortgang, bestede tijd (totaal en deze week) en open stappen. Plus minuten leren deze en vorige week.", inputSchema: { status: z.array(z.enum(["idee", "bezig", "gepauzeerd", "afgerond"])).optional() }, annotations: { readOnlyHint: true } },
    async ({ status }) => {
      const sum = await data.learningSummary();
      return json({ minutesThisWeek: sum.minutesThisWeek, minutesLastWeek: sum.minutesLastWeek, topics: (await data.listLearning({ status })).map(slimLearning) });
    },
  );

  server.registerTool(
    "get_learning",
    { title: "Leeronderwerp bekijken", description: "Eén leeronderwerp met aantekeningen, vastgelegde tijd, leerplan (taken), bronnen en notities die ernaar linken.", inputSchema: { topic: z.string().describe("Id of (deel van de) titel") }, annotations: { readOnlyHint: true } },
    async ({ topic }) => {
      const id = (await resolveLearning(topic))!;
      const [x, backlinks] = await Promise.all([data.getLearning(id), data.getBacklinks("learning", id)]);
      if (!x) throw new Error("Leeronderwerp niet gevonden");
      return json({
        ...slimLearning(x),
        notes: x.notes,
        sessions: x.sessions.slice(0, 30).map((s) => ({ id: s.id, date: s.date, minutes: s.minutes, note: s.note })),
        steps: x.steps.map((t) => ({ id: t.id, title: t.title, status: t.status, planDate: t.planDate, estimateMin: t.estimateMin })),
        sources: x.sources.map((s) => ({ id: s.id, title: s.title, url: s.url, status: s.status })),
        linkedFrom: backlinks.map((b) => ({ kind: b.fromKind, id: b.fromId, title: b.title })),
      });
    },
  );

  server.registerTool(
    "create_learning",
    { title: "Leeronderwerp aanmaken", description: "Nieuw leeronderwerp (cursus, boek, vaardigheid, certificering). Alleen op verzoek van Marc.", inputSchema: { title: z.string().min(1), ...learningFields } },
    async (input) => {
      const row = await data.createLearning(input);
      return json(slimLearning((await data.getLearning(row.id))!));
    },
  );

  server.registerTool(
    "update_learning",
    { title: "Leeronderwerp wijzigen", description: "Wijzig een leeronderwerp: status (afgerond vult de einddatum), voortgang (progressDone), doel, aantekeningen. Alleen meegegeven velden veranderen.", inputSchema: { topic: z.string(), title: z.string().min(1).optional(), ...learningFields } },
    async ({ topic, ...patch }) => {
      const id = (await resolveLearning(topic))!;
      await data.updateLearning(id, patch);
      return json(slimLearning((await data.getLearning(id))!));
    },
  );

  server.registerTool(
    "log_learning",
    {
      title: "Tijd leren vastleggen",
      description: "Leg tijd vast bij een leeronderwerp (\"1 uur aan de Google Ads-cursus\"): duration als tekst (\"1u\", \"45m\", \"1:30\") of minutes. Telt mee voor doelen met uren leren.",
      inputSchema: { topic: z.string(), duration: z.string().optional(), minutes: z.number().int().positive().optional(), date: isoDate.optional(), note: z.string().optional(), source: z.enum(["mcp", "whatsapp"]).optional() },
    },
    async ({ topic, duration, minutes, date, note, source }) => {
      const id = (await resolveLearning(topic))!;
      const min = minutes ?? (duration ? (/^\d+$/.test(duration.trim()) ? Number(duration) : parseDuration(duration)) : null);
      if (!min) throw new Error("Geef duration (bijv. \"1u\") of minutes.");
      const row = await data.logLearning({ topicId: id, minutes: min, date, note, source: source ?? "mcp" });
      return json({ logged: { id: row.id, date: row.date, minutes: row.minutes }, topic: slimLearning((await data.getLearning(id))!) });
    },
  );

  server.registerTool(
    "delete_learning_session",
    { title: "Vastgelegde leertijd verwijderen", description: "Verwijder een vastgelegde sessie (id uit get_learning). Alleen op verzoek van Marc.", inputSchema: { id: z.string().uuid() }, annotations: { destructiveHint: true } },
    async ({ id }) => json({ deleted: !!(await data.deleteLearningSession(id)) }),
  );

  server.registerTool(
    "delete_learning",
    { title: "Leeronderwerp verwijderen", description: "Verwijder een leeronderwerp met de vastgelegde tijd (taken en bronnen blijven bestaan, zonder koppeling). Alleen op verzoek van Marc.", inputSchema: { topic: z.string() }, annotations: { destructiveHint: true } },
    async ({ topic }) => {
      const id = (await resolveLearning(topic))!;
      await data.deleteLearning(id);
      return json({ deleted: true });
    },
  );

  /* ---- Agenda en reviews ---- */

  server.registerTool(
    "get_calendar",
    { title: "Agenda", description: "Afspraken tussen twee datums (inclusief).", inputSchema: { from: isoDate, to: isoDate }, annotations: { readOnlyHint: true } },
    async ({ from, to }) => json((await calendarConfigured()) ? await getEvents(from, to) : { events: [], errors: ["Geen agenda gekoppeld"] }),
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

  server.registerTool(
    "send_push",
    {
      title: "Pushmelding sturen",
      description:
        "Stuur Marc een pushmelding op zijn telefoon (en andere aangemelde apparaten). Alleen voor iets wat nu zijn aandacht nodig heeft of waar hij om vroeg, bijv. een herinnering of 'briefing staat klaar'. Kort houden: titel max. 60 tekens, tekst 1 of 2 zinnen. url opent een pagina in Marc OS bij aantikken (bijv. /reviews of /taken/<id>).",
      inputSchema: {
        title: z.string().min(1).max(120),
        body: z.string().max(400),
        url: z.string().regex(/^\//).optional().describe("Pad in Marc OS, bijv. /reviews"),
      },
    },
    async ({ title, body, url }) => json(await sendPush({ title, body, url, tag: `assistant-${Date.now()}` }, "assistant")),
  );

  return server;
}

/** Alle tools die nu aangeboden worden (met de modules van dit moment). */
export async function toolRegistry(): Promise<Map<string, ToolEntry>> {
  const collect = new Map<string, ToolEntry>();
  buildServer(await getModules(), { collect });
  return collect;
}

/** Schrijfacties die Hermes kan voorstellen, voor de instellingen (welke mogen zonder akkoord). */
export async function writeTools() {
  return [...(await toolRegistry()).values()]
    .filter((t) => !t.readOnly)
    .map((t) => ({ name: t.name, title: t.config.title ?? t.name, destructive: !!t.config.annotations?.destructiveHint, neverAuto: agent.NEVER_AUTO.has(t.name) }));
}

/** Voer een tool uit met opgeslagen argumenten (na akkoord). Gooit een fout met een leesbare melding. */
export async function executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const entry = (await toolRegistry()).get(name);
  if (!entry) throw new Error(`De actie ${name} is nu niet beschikbaar (staat de module uit?).`);
  const parsed = z.object(entry.config.inputSchema ?? {}).strict().safeParse(args);
  if (!parsed.success) throw new Error(`Ongeldige gegevens: ${parsed.error.issues.map((i) => `${i.path.join(".") || "invoer"}: ${i.message}`).join("; ")}`);
  const res = await entry.cb(parsed.data, {});
  const text = res.content?.map((c) => c.text).join("\n") ?? "";
  if (res.isError) throw new Error(text || "Mislukt");
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Een voorstel uitvoeren na akkoord van Marc. Kan maar één keer (claimProposal). */
export async function approveProposal(id: string, via: agent.DecidedVia, note?: string | null) {
  const p = await agent.claimProposal(id);
  if (!p) {
    const now = await agent.getProposal(id);
    return { ok: false as const, error: now ? `Dit voorstel is al ${now.status === "running" ? "bezig" : "afgehandeld"}.` : "Voorstel niet gevonden.", proposal: now };
  }
  await agent.log({ actor: "marc", kind: "approved", tool: p.tool, summary: `Akkoord: ${p.title}`, proposalId: id, detail: { via, edited: p.edited } });
  try {
    const result = await executeTool(p.tool, p.args as Record<string, unknown>);
    const done = await agent.finishProposal(id, { ok: true, result }, via, note);
    await agent.log({ actor: "hermes", kind: "executed", tool: p.tool, summary: `Uitgevoerd: ${p.title}`, proposalId: id });
    return { ok: true as const, proposal: done };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    const done = await agent.finishProposal(id, { ok: false, error }, via, note);
    await agent.log({ actor: "hermes", kind: "failed", tool: p.tool, summary: `Mislukt: ${p.title}: ${error}`, proposalId: id });
    return { ok: false as const, error, proposal: done };
  }
}

/** Argumenten van een open voorstel aanpassen (Marc, voor akkoord). Wordt eerst gecontroleerd. */
export async function editProposal(id: string, args: Record<string, unknown>) {
  const p = await agent.getProposal(id);
  if (!p || p.status !== "pending") throw new Error("Dit voorstel staat niet meer open.");
  const entry = (await toolRegistry()).get(p.tool);
  if (!entry) throw new Error("Deze actie is nu niet beschikbaar.");
  const parsed = z.object(entry.config.inputSchema ?? {}).strict().safeParse(args);
  if (!parsed.success) throw new Error(`Ongeldige gegevens: ${parsed.error.issues.map((i) => `${i.path.join(".") || "invoer"}: ${i.message}`).join("; ")}`);
  return agent.updateProposalArgs(id, args);
}

/** Stateless: per request een nieuwe server en transport. */
export async function handleMcp(req: Request, role: McpRole = "owner"): Promise<Response> {
  const modules = await getModules();
  const server = buildServer(modules, { role, autoTools: role === "agent" ? await agent.getAutoTools() : undefined });
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
