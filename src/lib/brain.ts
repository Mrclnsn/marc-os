/**
 * Second brain: [[links]], backlinks, bronnen en de grafiek.
 * Zonder "server-only", zodat ook de scripts (Obsidian-export, index bijwerken) het kunnen gebruiken.
 */
import { and, asc, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { clients, links, notes, projects, settings, sources } from "@/db/schema";
import {
  buildEntityIndex,
  entityHref,
  lineAround,
  linkKey,
  parseWikilinks,
  resolveLink,
  type EntityIndex,
  type LinkEntity,
  type LinkKind,
} from "./wikilinks";
import { queueIndex, queueRemove } from "./search";

export type LinkFrom = "note" | "source";

/* ---------------- Links bijhouden ---------------- */

/** Herschrijft de links van één notitie of bron (na opslaan). */
export async function syncLinks(fromKind: LinkFrom, fromId: string, text: string | null | undefined) {
  const parsed = parseWikilinks(text);
  await db.delete(links).where(and(eq(links.fromKind, fromKind), eq(links.fromId, fromId)));
  if (!parsed.length) return;
  await db.insert(links).values(
    parsed.map((l, i) => ({
      fromKind,
      fromId,
      targetKind: l.kind,
      targetKey: l.key,
      label: l.alias ?? l.target,
      context: lineAround(text!, l.index),
      position: i,
    })),
  );
}

export async function deleteLinksFrom(fromKind: LinkFrom, fromId: string) {
  await db.delete(links).where(and(eq(links.fromKind, fromKind), eq(links.fromId, fromId)));
}

const LINKS_VERSION = 1;
let backfilled: Promise<void> | null = null;

/** Eenmalig: links opbouwen voor notities van vóór de second brain (en na een nieuwe linkversie). */
export function ensureLinksIndexed(): Promise<void> {
  backfilled ??= (async () => {
    const [row] = await db.select().from(settings).where(eq(settings.key, "links_version"));
    if (row && Number(row.value) >= LINKS_VERSION) return;
    await reindexAllLinks();
    await db
      .insert(settings)
      .values({ key: "links_version", value: LINKS_VERSION })
      .onConflictDoUpdate({ target: settings.key, set: { value: LINKS_VERSION, updatedAt: new Date() } });
  })().catch((e) => {
    backfilled = null;
    throw e;
  });
  return backfilled;
}

export async function reindexAllLinks() {
  const [ns, ss] = await Promise.all([
    db.select({ id: notes.id, body: notes.body }).from(notes),
    db.select({ id: sources.id, body: sources.body }).from(sources),
  ]);
  for (const n of ns) await syncLinks("note", n.id, n.body);
  for (const s of ss) await syncLinks("source", s.id, s.body);
  return { notes: ns.length, sources: ss.length };
}

/* ---------------- Namen opzoeken ---------------- */

/** Alles waar een [[link]] naartoe kan wijzen. Inbox-items tellen niet mee. */
export async function loadEntities(): Promise<LinkEntity[]> {
  const [ns, cs, ps, ss] = await Promise.all([
    db.select({ id: notes.id, title: notes.title }).from(notes).where(ne(notes.type, "inbox")),
    db.select({ id: clients.id, title: clients.name }).from(clients),
    db.select({ id: projects.id, title: projects.name }).from(projects),
    db.select({ id: sources.id, title: sources.title }).from(sources),
  ]);
  return [
    ...ns.map((r) => ({ kind: "note" as const, ...r })),
    ...cs.map((r) => ({ kind: "client" as const, ...r })),
    ...ps.map((r) => ({ kind: "project" as const, ...r })),
    ...ss.map((r) => ({ kind: "source" as const, ...r })),
  ];
}

export async function loadEntityIndex(): Promise<EntityIndex> {
  return buildEntityIndex(await loadEntities());
}

/** Voor de weergave: elke link in een tekst met waar hij heen gaat (of null als hij nog niet bestaat). */
export type ResolvedLinks = Record<string, { kind: LinkKind; id: string; title: string; href: string } | null>;

export async function resolveLinksIn(...texts: (string | null | undefined)[]): Promise<ResolvedLinks> {
  const parsed = texts.flatMap((t) => parseWikilinks(t));
  if (!parsed.length) return {};
  const idx = await loadEntityIndex();
  const out: ResolvedLinks = {};
  for (const l of parsed) {
    const k = `${l.kind ?? ""}:${l.key}`;
    if (k in out) continue;
    const e = resolveLink(idx, l);
    out[k] = e ? { ...e, href: entityHref(e) } : null;
  }
  return out;
}

/** Sleutel waarmee de weergave een link opzoekt in ResolvedLinks. */
export function resolvedKey(l: { kind: LinkKind | null; key: string }) {
  return `${l.kind ?? ""}:${l.key}`;
}

/** Titels voor het aanvullen van [[ in de editor. */
export async function linkSuggestions() {
  const all = await loadEntities();
  return all
    .map((e) => ({ kind: e.kind, title: e.title }))
    .sort((a, b) => a.title.localeCompare(b.title, "nl"));
}

/* ---------------- Backlinks ---------------- */

export type Backlink = {
  fromKind: LinkFrom;
  fromId: string;
  title: string;
  href: string;
  date: string | null;
  contexts: string[];
};

async function entityTitle(kind: LinkKind, id: string): Promise<string | null> {
  switch (kind) {
    case "note":
      return (await db.select({ t: notes.title }).from(notes).where(eq(notes.id, id)))[0]?.t ?? null;
    case "client":
      return (await db.select({ t: clients.name }).from(clients).where(eq(clients.id, id)))[0]?.t ?? null;
    case "project":
      return (await db.select({ t: projects.name }).from(projects).where(eq(projects.id, id)))[0]?.t ?? null;
    case "source":
      return (await db.select({ t: sources.title }).from(sources).where(eq(sources.id, id)))[0]?.t ?? null;
  }
}

async function fromTitles(rows: { fromKind: string; fromId: string }[]) {
  const noteIds = [...new Set(rows.filter((r) => r.fromKind === "note").map((r) => r.fromId))];
  const sourceIds = [...new Set(rows.filter((r) => r.fromKind === "source").map((r) => r.fromId))];
  const [ns, ss] = await Promise.all([
    noteIds.length
      ? db.select({ id: notes.id, title: notes.title, date: notes.noteDate, created: notes.createdAt, type: notes.type }).from(notes).where(inArray(notes.id, noteIds))
      : [],
    sourceIds.length ? db.select({ id: sources.id, title: sources.title, created: sources.createdAt }).from(sources).where(inArray(sources.id, sourceIds)) : [],
  ]);
  const map = new Map<string, { title: string; href: string; date: string | null }>();
  for (const n of ns) if (n.type !== "inbox") map.set(`note:${n.id}`, { title: n.title, href: `/notities/${n.id}`, date: n.date ?? n.created.toISOString().slice(0, 10) });
  for (const s of ss) map.set(`source:${s.id}`, { title: s.title, href: `/notities/bronnen/${s.id}`, date: s.created.toISOString().slice(0, 10) });
  return map;
}

/** Notities en bronnen die met een [[link]] naar dit item verwijzen. */
export async function getBacklinks(kind: LinkKind, id: string): Promise<Backlink[]> {
  await ensureLinksIndexed();
  const title = await entityTitle(kind, id);
  if (!title) return [];
  const key = linkKey(title);
  const rows = await db.select().from(links).where(eq(links.targetKey, key)).orderBy(asc(links.position));
  if (!rows.length) return [];
  const idx = await loadEntityIndex();
  const hits = rows.filter((r) => {
    const e = resolveLink(idx, { key: r.targetKey, kind: (r.targetKind as LinkKind | null) ?? null });
    return e?.kind === kind && e.id === id && !(r.fromKind === kind && r.fromId === id);
  });
  const titles = await fromTitles(hits);
  const grouped = new Map<string, Backlink>();
  for (const r of hits) {
    const k = `${r.fromKind}:${r.fromId}`;
    const t = titles.get(k);
    if (!t) continue;
    const b = grouped.get(k) ?? { fromKind: r.fromKind as LinkFrom, fromId: r.fromId, ...t, contexts: [] };
    if (r.context && !b.contexts.includes(r.context)) b.contexts.push(r.context);
    grouped.set(k, b);
  }
  return [...grouped.values()].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

/** Notities en bronnen die de naam noemen zonder er een link van te maken (zoals in Obsidian). */
export async function getUnlinkedMentions(kind: LinkKind, id: string, limit = 15) {
  const title = await entityTitle(kind, id);
  if (!title || title.trim().length < 3) return [];
  const linked = new Set((await getBacklinks(kind, id)).map((b) => `${b.fromKind}:${b.fromId}`));
  const pattern = `%${title.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const [ns, ss] = await Promise.all([
    db
      .select({ id: notes.id, title: notes.title, body: notes.body })
      .from(notes)
      .where(and(ne(notes.type, "inbox"), or(ilike(notes.body, pattern), ilike(notes.title, pattern))))
      .orderBy(desc(notes.updatedAt))
      .limit(limit * 2),
    db
      .select({ id: sources.id, title: sources.title, body: sources.body, summary: sources.summary })
      .from(sources)
      .where(or(ilike(sources.body, pattern), ilike(sources.summary, pattern), ilike(sources.title, pattern)))
      .limit(limit),
  ]);
  const lower = title.toLowerCase();
  // Namen binnen een [[link]] (naar iets anders) tellen niet als vermelding
  const plain = (text: string | null) => (text ?? "").replace(/\[\[[^\]\n]*\]\]/g, (m) => " ".repeat(m.length));
  const mentioned = (text: string | null) => plain(text).toLowerCase().includes(lower);
  const context = (text: string | null) => {
    if (!text) return null;
    const i = plain(text).toLowerCase().indexOf(lower);
    return i >= 0 ? lineAround(text, i, 180) : null;
  };
  const out = [
    ...ns
      .filter((n) => !(kind === "note" && n.id === id) && (mentioned(n.title) || mentioned(n.body)))
      .map((n) => ({ key: `note:${n.id}`, title: n.title, href: `/notities/${n.id}`, context: context(n.body) })),
    ...ss
      .filter((s) => !(kind === "source" && s.id === id) && (mentioned(s.title) || mentioned(s.body) || mentioned(s.summary)))
      .map((s) => ({ key: `source:${s.id}`, title: s.title, href: `/notities/bronnen/${s.id}`, context: context(s.body) ?? context(s.summary) })),
  ];
  return out.filter((m) => !linked.has(m.key)).slice(0, limit);
}

/** Uitgaande links van een notitie of bron, met waar ze heen gaan. */
export async function getOutgoing(fromKind: LinkFrom, fromId: string) {
  const rows = await db
    .select()
    .from(links)
    .where(and(eq(links.fromKind, fromKind), eq(links.fromId, fromId)))
    .orderBy(asc(links.position));
  if (!rows.length) return [];
  const idx = await loadEntityIndex();
  const seen = new Set<string>();
  const out: { label: string; target: string; kind: LinkKind | null; resolved: { kind: LinkKind; id: string; title: string; href: string } | null }[] = [];
  for (const r of rows) {
    const k = `${r.targetKind ?? ""}:${r.targetKey}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const e = resolveLink(idx, { key: r.targetKey, kind: (r.targetKind as LinkKind | null) ?? null });
    out.push({ label: r.label, target: r.targetKey, kind: (r.targetKind as LinkKind | null) ?? null, resolved: e ? { ...e, href: entityHref(e) } : null });
  }
  return out;
}

/* ---------------- Grafiek ---------------- */

export type GraphNode = { id: string; kind: LinkKind | "missing"; title: string; href: string; sub?: string; degree: number };
export type GraphEdge = { source: string; target: string; kind: "link" | "structure" };

/**
 * Alle notities, bronnen, klanten en projecten met hun verbindingen.
 * - link: een [[link]] in de tekst
 * - structure: de koppeling in de app (notitie of bron bij een klant/project, project bij een klant)
 * Klanten en projecten zonder enige verbinding blijven weg; losse notities niet (zoals in Obsidian).
 */
export async function getGraph() {
  await ensureLinksIndexed();
  const [ns, ss, cs, ps, ls] = await Promise.all([
    db.select({ id: notes.id, title: notes.title, type: notes.type, clientId: notes.clientId, projectId: notes.projectId }).from(notes).where(ne(notes.type, "inbox")),
    db.select({ id: sources.id, title: sources.title, clientId: sources.clientId, projectId: sources.projectId }).from(sources),
    db.select({ id: clients.id, title: clients.name, status: clients.status }).from(clients),
    db.select({ id: projects.id, title: projects.name, clientId: projects.clientId, status: projects.status }).from(projects),
    db.select().from(links),
  ]);
  const entities: LinkEntity[] = [
    ...ns.map((n) => ({ kind: "note" as const, id: n.id, title: n.title })),
    ...cs.map((c) => ({ kind: "client" as const, id: c.id, title: c.title })),
    ...ps.map((p) => ({ kind: "project" as const, id: p.id, title: p.title })),
    ...ss.map((s) => ({ kind: "source" as const, id: s.id, title: s.title })),
  ];
  const idx = buildEntityIndex(entities);
  const nodes = new Map<string, GraphNode>();
  const add = (n: Omit<GraphNode, "degree">) => nodes.get(n.id) ?? nodes.set(n.id, { ...n, degree: 0 }).get(n.id)!;
  const nid = (kind: string, id: string) => `${kind}:${id}`;
  for (const e of entities) add({ id: nid(e.kind, e.id), kind: e.kind, title: e.title, href: entityHref(e) });

  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  const connect = (a: string, b: string, kind: GraphEdge["kind"]) => {
    if (a === b || !nodes.has(a) || !nodes.has(b)) return;
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(k)) return;
    seen.add(k);
    edges.push({ source: a, target: b, kind });
    nodes.get(a)!.degree++;
    nodes.get(b)!.degree++;
  };

  for (const l of ls) {
    const from = nid(l.fromKind, l.fromId);
    if (!nodes.has(from)) continue; // bijv. inbox-item
    const e = resolveLink(idx, { key: l.targetKey, kind: (l.targetKind as LinkKind | null) ?? null });
    if (e) connect(from, nid(e.kind, e.id), "link");
    else {
      const ghost = nid("missing", l.targetKey);
      add({ id: ghost, kind: "missing", title: l.label, href: `/notities/nieuw?titel=${encodeURIComponent(l.label)}` });
      connect(from, ghost, "link");
    }
  }
  for (const n of ns) {
    if (n.clientId) connect(nid("note", n.id), nid("client", n.clientId), "structure");
    if (n.projectId) connect(nid("note", n.id), nid("project", n.projectId), "structure");
  }
  for (const s of ss) {
    if (s.clientId) connect(nid("source", s.id), nid("client", s.clientId), "structure");
    if (s.projectId) connect(nid("source", s.id), nid("project", s.projectId), "structure");
  }
  for (const p of ps) if (p.clientId) connect(nid("project", p.id), nid("client", p.clientId), "structure");

  const list = [...nodes.values()].filter((n) => n.kind === "note" || n.kind === "source" || n.degree > 0);
  return { nodes: list, edges };
}

/* ---------------- Bronnen ---------------- */

const optText = z.string().nullable().optional();
const optId = z.string().uuid().nullable().optional();

export const sourceKindSchema = z.enum(["article", "video", "podcast", "book", "course", "idea", "link"]);
export const sourceStatusSchema = z.enum(["new", "read", "processed"]);

export const sourceInput = z.object({
  title: z.string().min(1),
  url: optText,
  kind: sourceKindSchema.optional(),
  status: sourceStatusSchema.optional(),
  author: optText,
  summary: optText,
  body: optText,
  area: z.enum(["zakelijk", "prive"]).nullable().optional(),
  clientId: optId,
  projectId: optId,
  capturedVia: optText,
});
export type SourceInput = z.infer<typeof sourceInput>;
/** Invoer uit formulieren en MCP: titel mag leeg zijn (dan haalt de app hem op of blijft hij staan). */
export type SourcePatch = Partial<Omit<SourceInput, "title">> & { title?: string | null };

/** Raadt de soort uit de link (YouTube = video, Spotify = podcast). */
export function guessSourceKind(url: string | null | undefined): z.infer<typeof sourceKindSchema> {
  if (!url) return "idea";
  const u = url.toLowerCase();
  if (/youtube\.com|youtu\.be|vimeo\.com|loom\.com/.test(u)) return "video";
  if (/spotify\.com\/(episode|show)|podcasts\.apple\.com|overcast\.fm/.test(u)) return "podcast";
  if (/udemy\.com|coursera\.org|linkedin\.com\/learning/.test(u)) return "course";
  return "article";
}

export function cleanUrl(input: string | null | undefined): string | null {
  const t = input?.trim();
  if (!t) return null;
  return /^[a-z]+:\/\//i.test(t) ? t : `https://${t}`;
}

/** Eerste link in een tekst (voor inbox-items en WhatsApp-berichten). */
export function firstUrl(text: string | null | undefined): string | null {
  return text?.match(/https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/)?.[0] ?? null;
}

/** Haalt titel, beschrijving en site op van een webpagina. Faalt stil: dan blijft het bij de link. */
export async function fetchPageMeta(url: string): Promise<{ title?: string; description?: string; site?: string }> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { "user-agent": "Mozilla/5.0 (Marc OS; bron opslaan)", accept: "text/html" },
      redirect: "follow",
    });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return {};
    const html = (await res.text()).slice(0, 300_000);
    const meta = (name: string) =>
      html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']*)["']`, "i"))?.[1] ??
      html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${name}["']`, "i"))?.[1];
    const title = meta("og:title") ?? html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1];
    return {
      title: title ? decodeEntities(title).trim().slice(0, 300) : undefined,
      description: meta("og:description") ?? meta("description") ? decodeEntities((meta("og:description") ?? meta("description"))!).trim().slice(0, 1000) : undefined,
      site: meta("og:site_name") ? decodeEntities(meta("og:site_name")!).trim() : undefined,
    };
  } catch {
    return {};
  }
}

function decodeEntities(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

export async function listSources(filter: { status?: z.infer<typeof sourceStatusSchema>; kind?: z.infer<typeof sourceKindSchema>; clientId?: string; search?: string; limit?: number } = {}) {
  const conds = [];
  if (filter.status) conds.push(eq(sources.status, filter.status));
  if (filter.kind) conds.push(eq(sources.kind, filter.kind));
  if (filter.clientId) conds.push(eq(sources.clientId, filter.clientId));
  if (filter.search) {
    const p = `%${filter.search}%`;
    conds.push(or(ilike(sources.title, p), ilike(sources.summary, p), ilike(sources.body, p), ilike(sources.url, p), ilike(sources.author, p)));
  }
  return db
    .select({ source: sources, clientName: clients.name, projectName: projects.name })
    .from(sources)
    .leftJoin(clients, eq(sources.clientId, clients.id))
    .leftJoin(projects, eq(sources.projectId, projects.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(sql`case ${sources.status} when 'new' then 0 when 'read' then 1 else 2 end`, desc(sources.createdAt))
    .limit(filter.limit ?? 200);
}

export async function getSource(id: string) {
  const [row] = await db
    .select({ source: sources, clientName: clients.name, projectName: projects.name })
    .from(sources)
    .leftJoin(clients, eq(sources.clientId, clients.id))
    .leftJoin(projects, eq(sources.projectId, projects.id))
    .where(eq(sources.id, id));
  return row ?? null;
}

/** Nieuwe bron. Met alleen een link haalt hij zelf titel en beschrijving op. */
export async function createSource(input: SourcePatch) {
  const url = cleanUrl(input.url);
  let title = input.title?.trim() || null;
  let summary = input.summary ?? null;
  let author = input.author ?? null;
  if (url && (!title || !summary)) {
    const meta = await fetchPageMeta(url);
    title ??= meta.title ?? null;
    summary ??= meta.description ?? null;
    author ??= meta.site ?? null;
  }
  title ??= url ? new URL(url).hostname.replace(/^www\./, "") : "Idee";
  const data = sourceInput.parse({ ...input, url, title, summary, author, kind: input.kind ?? guessSourceKind(url) });
  const [row] = await db.insert(sources).values(data).returning();
  await syncLinks("source", row.id, row.body);
  queueIndex("source", row.id);
  return row;
}

export async function updateSource(id: string, patch: SourcePatch) {
  const { title, ...rest } = patch;
  const data = sourceInput.partial().parse({ ...rest, ...(title ? { title } : {}), ...(rest.url !== undefined ? { url: cleanUrl(rest.url) } : {}) });
  const [row] = await db.update(sources).set(data).where(eq(sources.id, id)).returning();
  if (row && data.body !== undefined) await syncLinks("source", id, row.body);
  if (row) queueIndex("source", id);
  return row;
}

export async function deleteSource(id: string) {
  await db.delete(sources).where(eq(sources.id, id));
  await deleteLinksFrom("source", id);
  queueRemove("source", id);
}

export async function sourceCounts() {
  const rows = await db.select({ status: sources.status, n: sql<number>`count(*)::int` }).from(sources).groupBy(sources.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.n])) as Partial<Record<z.infer<typeof sourceStatusSchema>, number>>;
}
