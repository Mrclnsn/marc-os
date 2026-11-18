import "server-only";
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { agentLog, agentProposals, chatMessages, chatThreads, goals, notes, projects, settings, sources, tasks, type AgentProposal } from "@/db/schema";

/*
 * Hermes: akkoordwachtrij, logboek, instellingen en chatgeschiedenis (gesprek 12).
 * De uitvoering van een voorstel staat in mcp.ts (executeTool), omdat daar de tools wonen.
 */

export type Actor = "hermes" | "claude" | "marc";
export type LogKind = "read" | "direct" | "proposed" | "approved" | "rejected" | "withdrawn" | "executed" | "failed" | "chat" | "routine" | "whatsapp";
export type ProposalStatus = "pending" | "running" | "executed" | "failed" | "rejected" | "withdrawn";
export type DecidedVia = "app" | "chat" | "cockpit" | "whatsapp";

/** Schrijfacties die Hermes standaard zonder akkoord mag doen: vastleggen en afvinken, niets wat de deur uitgaat of iets weghaalt. */
export const DEFAULT_AUTO_TOOLS = [
  "capture",
  "check_habit",
  "log_workout",
  "log_learning",
  "log_goal_value",
  "add_source",
  "save_review",
  "send_push",
] as const;

/** Tools die nooit zonder akkoord mogen, ook niet als ze per ongeluk in de lijst staan. */
export const NEVER_AUTO = new Set([
  "accept_quote",
  "set_quote_status",
  "invoice_hours",
  "delete_task",
  "delete_note",
  "delete_source",
  "delete_contact",
  "delete_website",
  "delete_agreement",
  "delete_installment",
  "delete_time_entry",
  "delete_lead",
  "delete_quote_line",
  "delete_filing_schedule",
  "delete_document",
  "delete_workout",
  "delete_goal",
  "delete_learning",
  "delete_learning_session",
  "update_client",
  "create_client",
]);

/* ---------------- Instellingen ---------------- */

export async function getAutoTools(): Promise<string[]> {
  const [row] = await db.select().from(settings).where(eq(settings.key, "agent_auto"));
  const list = Array.isArray(row?.value) ? (row!.value as string[]) : [...DEFAULT_AUTO_TOOLS];
  return list.filter((t) => !NEVER_AUTO.has(t));
}

export async function setAutoTool(tool: string, on: boolean) {
  if (on && NEVER_AUTO.has(tool)) throw new Error("Deze actie gaat altijd via akkoord.");
  const now = new Set(await getAutoTools());
  if (on) now.add(tool);
  else now.delete(tool);
  const value = [...now].sort();
  await db.insert(settings).values({ key: "agent_auto", value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
  await log({ actor: "marc", kind: "direct", tool, summary: `${on ? "Zonder akkoord toegestaan" : "Weer via akkoord"}: ${tool}` });
}

/* ---------------- Logboek ---------------- */

export async function log(entry: { actor: Actor; kind: LogKind; tool?: string | null; summary: string; proposalId?: string | null; detail?: unknown }) {
  try {
    await db.insert(agentLog).values({
      actor: entry.actor,
      kind: entry.kind,
      tool: entry.tool ?? null,
      summary: entry.summary.slice(0, 500),
      proposalId: entry.proposalId ?? null,
      detail: entry.detail === undefined ? null : (JSON.parse(JSON.stringify(entry.detail)) as object),
    });
  } catch (e) {
    // Het logboek mag een actie nooit laten mislukken
    console.error("agent_log", e);
  }
}

export async function listLog(opts: { limit?: number; actor?: Actor; kinds?: LogKind[] } = {}) {
  const where = and(opts.actor ? eq(agentLog.actor, opts.actor) : undefined, opts.kinds?.length ? inArray(agentLog.kind, opts.kinds) : undefined);
  return db.select().from(agentLog).where(where).orderBy(desc(agentLog.at)).limit(opts.limit ?? 100);
}

export async function lastActivity(actor: Actor = "hermes") {
  const [row] = await db.select({ at: agentLog.at, summary: agentLog.summary }).from(agentLog).where(eq(agentLog.actor, actor)).orderBy(desc(agentLog.at)).limit(1);
  return row ?? null;
}

/* ---------------- Voorstellen ---------------- */

const short = (v: unknown, n = 60) => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

/** Naam van het ding waar een aanroep over gaat (taak, notitie, project, bron of doel), voor een leesbare titel. */
async function subjectOf(args: Record<string, unknown>): Promise<string | null> {
  const id = [args.id, args.taskId, args.noteId, args.projectId].find((v) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v)) as string | undefined;
  if (!id) return null;
  const lookups = [
    db.select({ t: tasks.title }).from(tasks).where(eq(tasks.id, id)),
    db.select({ t: notes.title }).from(notes).where(eq(notes.id, id)),
    db.select({ t: projects.name }).from(projects).where(eq(projects.id, id)),
    db.select({ t: sources.title }).from(sources).where(eq(sources.id, id)),
    db.select({ t: goals.title }).from(goals).where(eq(goals.id, id)),
  ];
  for (const q of lookups) {
    const [row] = await q.catch(() => []);
    if (row?.t) return row.t;
  }
  return null;
}

/** Leesbare titel: "Taak aanmaken: Offerte Vobis" of "Taak afronden: „Belastingdienst bellen”". */
export async function describeCall(tool: string, toolTitle: string | undefined, args: Record<string, unknown>): Promise<string> {
  const label = toolTitle ?? tool;
  const direct = args.title ?? args.name ?? args.topic ?? args.habit ?? args.text ?? args.subject ?? args.companyName ?? args.query;
  if (direct) return `${label}: ${short(direct)}`;
  const subject = await subjectOf(args);
  if (subject) return `${label}: „${short(subject)}”`;
  return label;
}

export async function createProposal(p: { tool: string; args: Record<string, unknown>; title: string; reason?: string | null; actor?: Actor }) {
  const [row] = await db
    .insert(agentProposals)
    .values({ tool: p.tool, args: p.args, title: p.title, reason: p.reason ?? null, actor: p.actor ?? "hermes" })
    .returning();
  await log({ actor: row.actor as Actor, kind: "proposed", tool: p.tool, summary: p.title, proposalId: row.id, detail: { args: p.args, reason: p.reason } });
  return row;
}

export async function getProposal(id: string) {
  const [row] = await db.select().from(agentProposals).where(eq(agentProposals.id, id));
  return row ?? null;
}

export async function getProposalByNr(nr: number) {
  const [row] = await db.select().from(agentProposals).where(eq(agentProposals.nr, nr));
  return row ?? null;
}

export async function listProposals(opts: { status?: ProposalStatus | "decided" | "all"; limit?: number; since?: Date; ids?: string[] } = {}) {
  const status = opts.status ?? "pending";
  const where = and(
    status === "all" ? undefined : status === "decided" ? sql`${agentProposals.status} <> 'pending'` : eq(agentProposals.status, status),
    opts.since ? gte(agentProposals.createdAt, opts.since) : undefined,
    opts.ids ? (opts.ids.length ? inArray(agentProposals.id, opts.ids) : sql`false`) : undefined,
  );
  const order = status === "pending" ? asc(agentProposals.createdAt) : desc(sql`coalesce(${agentProposals.decidedAt}, ${agentProposals.createdAt})`);
  return db.select().from(agentProposals).where(where).orderBy(order).limit(opts.limit ?? 50);
}

/** De klok van de database, zodat "voorstellen sinds het begin van dit antwoord" precies klopt. */
export async function dbNow(): Promise<Date> {
  const rows = (await db.execute(sql`select now() as now`)) as unknown as { now: string | Date }[];
  return rows[0]?.now ? new Date(rows[0].now) : new Date();
}

export async function pendingCount() {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(agentProposals).where(eq(agentProposals.status, "pending"));
  return row?.n ?? 0;
}

/** Zet een voorstel op "running" als het nog openstaat. Zo kan hetzelfde voorstel nooit twee keer worden uitgevoerd. */
export async function claimProposal(id: string): Promise<AgentProposal | null> {
  const [row] = await db
    .update(agentProposals)
    .set({ status: "running" })
    .where(and(eq(agentProposals.id, id), eq(agentProposals.status, "pending")))
    .returning();
  return row ?? null;
}

export async function finishProposal(id: string, outcome: { ok: true; result: unknown } | { ok: false; error: string }, via: DecidedVia, note?: string | null) {
  const [row] = await db
    .update(agentProposals)
    .set({
      status: outcome.ok ? "executed" : "failed",
      decidedAt: new Date(),
      decidedVia: via,
      decisionNote: note ?? null,
      result: outcome.ok ? (JSON.parse(JSON.stringify(outcome.result ?? null)) as object) : null,
      error: outcome.ok ? null : outcome.error,
    })
    .where(eq(agentProposals.id, id))
    .returning();
  return row;
}

export async function rejectProposal(id: string, via: DecidedVia, note?: string | null) {
  const [row] = await db
    .update(agentProposals)
    .set({ status: "rejected", decidedAt: new Date(), decidedVia: via, decisionNote: note?.trim() || null })
    .where(and(eq(agentProposals.id, id), eq(agentProposals.status, "pending")))
    .returning();
  if (row) await log({ actor: "marc", kind: "rejected", tool: row.tool, summary: `Afgewezen: ${row.title}${row.decisionNote ? ` (${row.decisionNote})` : ""}`, proposalId: id, detail: { via } });
  return row ?? null;
}

/** Hermes trekt een eigen voorstel in (bijv. omdat Marc "pas aan" zei en er een nieuw voorstel komt). */
export async function withdrawProposal(id: string, note?: string | null) {
  const [row] = await db
    .update(agentProposals)
    .set({ status: "withdrawn", decidedAt: new Date(), decisionNote: note ?? null })
    .where(and(eq(agentProposals.id, id), eq(agentProposals.status, "pending")))
    .returning();
  if (row) await log({ actor: "hermes", kind: "withdrawn", tool: row.tool, summary: `Ingetrokken: ${row.title}`, proposalId: id });
  return row ?? null;
}

export async function updateProposalArgs(id: string, args: Record<string, unknown>) {
  const [row] = await db
    .update(agentProposals)
    .set({ args, edited: true })
    .where(and(eq(agentProposals.id, id), eq(agentProposals.status, "pending")))
    .returning();
  if (row) await log({ actor: "marc", kind: "direct", tool: row.tool, summary: `Voorstel aangepast: ${row.title}`, proposalId: id, detail: { args } });
  return row ?? null;
}

/** Voorstellen die al een week openstaan blijven staan, maar oude afgehandelde regels in het logboek gaan na een jaar weg. */
export async function pruneLog() {
  await db.delete(agentLog).where(sql`${agentLog.at} < now() - interval '400 days'`);
}

/* ---------------- Chat ---------------- */

export async function listThreads(limit = 30) {
  return db.select().from(chatThreads).orderBy(desc(chatThreads.updatedAt)).limit(limit);
}

export async function getThread(id: string) {
  const [thread] = await db.select().from(chatThreads).where(eq(chatThreads.id, id));
  if (!thread) return null;
  const messages = await db.select().from(chatMessages).where(eq(chatMessages.threadId, id)).orderBy(asc(chatMessages.createdAt));
  return { thread, messages };
}

export async function createThread(firstMessage: string) {
  const title = short(firstMessage, 50) || "Nieuw gesprek";
  const [row] = await db.insert(chatThreads).values({ title }).returning();
  return row;
}

export async function addMessage(m: { threadId: string; role: "user" | "assistant"; content: string; tools?: string[]; proposalIds?: string[]; error?: string | null }) {
  const [row] = await db
    .insert(chatMessages)
    .values({ threadId: m.threadId, role: m.role, content: m.content, tools: m.tools ?? null, proposalIds: m.proposalIds ?? null, error: m.error ?? null })
    .returning();
  await db.update(chatThreads).set({ updatedAt: new Date() }).where(eq(chatThreads.id, m.threadId));
  return row;
}

export async function deleteThread(id: string) {
  await db.delete(chatThreads).where(eq(chatThreads.id, id));
}

/* ---------------- Meldingen bij nieuwe voorstellen ---------------- */

let lastChatActivity = 0;
let lastProposalPush = 0;
let quietUntil = 0;

/** Tijdens een vaste routine geen losse melding per voorstel: de routine stuurt één bericht met alle voorstellen. */
export function quietProposalPush(ms: number) {
  quietUntil = ms > 0 ? Math.max(quietUntil, Date.now() + ms) : 0;
}

/** De app-chat is actief: dan geen pushmelding voor voorstellen, Marc ziet ze in de chat. */
export function markChatActive() {
  lastChatActivity = Date.now();
}

/** Pushmelding als er een voorstel binnenkomt terwijl Marc niet in de chat zit. Hooguit één per 10 minuten. */
export async function notifyNewProposal(title: string) {
  const now = Date.now();
  if (now < quietUntil || now - lastChatActivity < 3 * 60_000 || now - lastProposalPush < 10 * 60_000) return;
  lastProposalPush = now;
  const n = await pendingCount();
  const { sendPush } = await import("./push");
  await sendPush(
    { title: n > 1 ? `Hermes: ${n} voorstellen wachten op akkoord` : "Hermes: voorstel wacht op akkoord", body: title, url: "/hermes?tab=akkoord", tag: "hermes-akkoord" },
    "assistant",
  ).catch(() => null);
}
