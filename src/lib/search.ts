/**
 * Zoeken in de second brain: notities en bronnen.
 *
 * - Trefwoord (altijd): Postgres full-text search in het Nederlands, woorden met OF, plus de naam van klant en project.
 * - Semantisch (als het kan): pgvector met embeddings. Werkt lokaal met PGlite (npm run local laadt pgvector)
 *   en op de VPS met de pgvector-image. Ontbreekt pgvector of een embedding-sleutel, dan valt het netjes terug
 *   op trefwoorden en zegt de app waarom.
 * Beide lijsten worden samengevoegd met reciprocal rank fusion.
 *
 * Zonder "server-only": de nachtelijke index-update draait als script.
 */
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { embed, embeddingConfig, embeddingProblem, vectorLiteral, PROVIDER_LABEL, type EmbeddingConfig } from "./embeddings";

export type SearchKind = "note" | "source";

/* ---------------- Vectoropslag ---------------- */

type VectorState = { ok: boolean; error?: string; at: number };
let vectorState: VectorState | null = null;
let vectorPending: Promise<VectorState> | null = null;

/**
 * Zet pgvector en de tabel embeddings klaar (buiten de migraties om, omdat de extensie niet overal bestaat).
 * Lukt het niet, dan probeert hij het na 10 minuten opnieuw.
 */
export async function vectorStore(): Promise<VectorState> {
  if (vectorState && (vectorState.ok || Date.now() - vectorState.at < 10 * 60_000)) return vectorState;
  vectorPending ??= (async () => {
    try {
      await db.execute(sql`create extension if not exists vector`);
      await db.execute(sql`
        create table if not exists embeddings (
          kind text not null,
          ref_id uuid not null,
          chunk integer not null,
          model text not null,
          content_hash text not null,
          content text not null,
          embedding vector not null,
          updated_at timestamptz not null default now(),
          primary key (kind, ref_id, model, chunk)
        )`);
      vectorState = { ok: true, at: Date.now() };
    } catch (e) {
      const cause = e instanceof Error && e.cause instanceof Error ? e.cause.message : e instanceof Error ? e.message : String(e);
      vectorState = { ok: false, error: cause, at: Date.now() };
    }
    vectorPending = null;
    return vectorState;
  })();
  return vectorPending;
}

/** Klaar voor semantisch zoeken? Zo niet: de reden in gewone taal. */
export async function semanticReady(): Promise<{ cfg: EmbeddingConfig | null; reason: string | null }> {
  const cfg = embeddingConfig();
  if (!cfg) return { cfg: null, reason: embeddingProblem() };
  const v = await vectorStore();
  if (!v.ok) return { cfg: null, reason: `pgvector is niet beschikbaar in de database (${v.error?.slice(0, 120)}). Lokaal: start met npm run local; op de VPS: de pgvector-image uit docker-compose.yml.` };
  return { cfg, reason: null };
}

/* ---------------- Tekst per item ---------------- */

const NOTE_TYPE: Record<string, string> = { inbox: "Inbox", note: "Notitie", meeting: "Meeting", call: "Telefoon", email: "E-mail", decision: "Besluit", info: "Info", idea: "Idee" };
const SOURCE_KIND: Record<string, string> = { article: "Artikel", video: "Video", podcast: "Podcast", book: "Boek", course: "Cursus", idea: "Idee", link: "Link" };

type ItemText = { header: string; body: string };

async function loadItemText(kind: SearchKind, id: string): Promise<ItemText | null> {
  if (kind === "note") {
    const rows = await db.execute<{ title: string; body: string | null; type: string; note_date: string | null; client: string | null; project: string | null }>(sql`
      select n.title, n.body, n.type::text as type, n.note_date::text as note_date, c.name as client, p.name as project
      from notes n left join clients c on c.id = n.client_id left join projects p on p.id = n.project_id
      where n.id = ${id}`);
    const n = rows[0];
    if (!n) return null;
    const meta = [NOTE_TYPE[n.type] ?? n.type, n.client && `Klant: ${n.client}`, n.project && `Project: ${n.project}`, n.note_date && `Datum: ${n.note_date}`].filter(Boolean).join(" · ");
    return { header: `${n.title}\n${meta}`, body: n.body ?? "" };
  }
  const rows = await db.execute<{ title: string; body: string | null; summary: string | null; kind: string; author: string | null; url: string | null; client: string | null; project: string | null }>(sql`
    select s.title, s.body, s.summary, s.kind::text as kind, s.author, s.url, c.name as client, p.name as project
    from sources s left join clients c on c.id = s.client_id left join projects p on p.id = s.project_id
    where s.id = ${id}`);
  const s = rows[0];
  if (!s) return null;
  const meta = [`Bron (${SOURCE_KIND[s.kind] ?? s.kind})`, s.author, s.url, s.client && `Klant: ${s.client}`, s.project && `Project: ${s.project}`].filter(Boolean).join(" · ");
  return { header: `${s.title}\n${meta}`, body: [s.summary && `Samenvatting: ${s.summary}`, s.body].filter(Boolean).join("\n\n") };
}

/** Knipt lange teksten op alinea's in stukken van ongeveer 1.800 tekens; elk stuk krijgt titel en gegevens mee. */
export function chunkText(item: ItemText, size = 1800): string[] {
  const paras = item.body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let cur = "";
  const push = () => {
    if (cur.trim()) chunks.push(cur.trim());
    cur = "";
  };
  for (const p of paras) {
    if (p.length > size) {
      push();
      for (let i = 0; i < p.length; i += size) chunks.push(p.slice(i, i + size));
      continue;
    }
    if (cur.length + p.length + 2 > size) push();
    cur += (cur ? "\n\n" : "") + p;
  }
  push();
  if (!chunks.length) chunks.push("");
  return chunks.map((c) => `${item.header}\n\n${c}`.trim());
}

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);

/* ---------------- Indexeren ---------------- */

let lastIndexError: { at: string; message: string } | null = null;

/** Werkt de embeddings van één notitie of bron bij. Ongewijzigde tekst kost geen API-aanroep. */
export async function indexItem(cfg: EmbeddingConfig, kind: SearchKind, id: string) {
  const item = await loadItemText(kind, id);
  if (!item) {
    await db.execute(sql`delete from embeddings where kind = ${kind} and ref_id = ${id}`);
    return "removed" as const;
  }
  const chunks = chunkText(item);
  const hashes = chunks.map(hash);
  const existing = await db.execute<{ chunk: number; content_hash: string }>(
    sql`select chunk, content_hash from embeddings where kind = ${kind} and ref_id = ${id} and model = ${cfg.model} order by chunk`,
  );
  if (existing.length === chunks.length && existing.every((e, i) => e.content_hash === hashes[i])) {
    await db.execute(sql`update embeddings set updated_at = now() where kind = ${kind} and ref_id = ${id} and model = ${cfg.model}`);
    return "unchanged" as const;
  }
  const vectors = await embed(cfg, chunks, "document");
  await db.execute(sql`delete from embeddings where kind = ${kind} and ref_id = ${id} and model = ${cfg.model}`);
  for (let i = 0; i < chunks.length; i++) {
    await db.execute(sql`
      insert into embeddings (kind, ref_id, chunk, model, content_hash, content, embedding)
      values (${kind}, ${id}, ${i}, ${cfg.model}, ${hashes[i]}, ${chunks[i]}, ${vectorLiteral(vectors[i])}::vector)`);
  }
  return "indexed" as const;
}

/** Na opslaan: op de achtergrond bijwerken. Lukt het niet, dan pakt de volgende sweep het op. */
export function queueIndex(kind: SearchKind, id: string) {
  const cfg = embeddingConfig();
  if (!cfg) return;
  void (async () => {
    if (!(await vectorStore()).ok) return;
    await indexItem(cfg, kind, id);
  })().catch((e) => {
    lastIndexError = { at: new Date().toISOString(), message: e instanceof Error ? e.message : String(e) };
    console.error("Index bijwerken mislukt:", lastIndexError.message);
  });
}

/** Na verwijderen: embeddings weg (ook als semantisch zoeken uit staat, als de tabel bestaat). */
export function queueRemove(kind: SearchKind, id: string) {
  void (async () => {
    if (!vectorState?.ok) return;
    await db.execute(sql`delete from embeddings where kind = ${kind} and ref_id = ${id}`);
  })().catch(() => {});
}

/** Alles wat nieuw of gewijzigd is opnieuw indexeren, en weesregels opruimen. */
export async function syncEmbeddings(limit = 500) {
  const { cfg, reason } = await semanticReady();
  if (!cfg) return { ok: false as const, reason, indexed: 0, unchanged: 0, removed: 0, remaining: 0 };
  const removed = await db.execute(sql`
    delete from embeddings e
    where (e.kind = 'note' and not exists (select 1 from notes n where n.id = e.ref_id))
       or (e.kind = 'source' and not exists (select 1 from sources s where s.id = e.ref_id))
    returning 1`);
  const stale = await staleItems(cfg.model, limit);
  let indexed = 0;
  let unchanged = 0;
  for (const s of stale) {
    try {
      const r = await indexItem(cfg, s.kind, s.id);
      if (r === "indexed") indexed++;
      else if (r === "unchanged") unchanged++;
    } catch (e) {
      lastIndexError = { at: new Date().toISOString(), message: e instanceof Error ? e.message : String(e) };
      return { ok: false as const, reason: lastIndexError.message, indexed, unchanged, removed: removed.length, remaining: (await staleItems(cfg.model, 10_000)).length };
    }
  }
  const remaining = (await staleItems(cfg.model, 10_000)).length;
  return { ok: true as const, reason: null, indexed, unchanged, removed: removed.length, remaining };
}

async function staleItems(model: string, limit: number) {
  return db.execute<{ kind: SearchKind; id: string }>(sql`
    select * from (
      select 'note' as kind, n.id, n.updated_at from notes n
      where not exists (select 1 from embeddings e where e.kind = 'note' and e.ref_id = n.id and e.model = ${model} and e.updated_at >= n.updated_at)
      union all
      select 'source' as kind, s.id, s.updated_at from sources s
      where not exists (select 1 from embeddings e where e.kind = 'source' and e.ref_id = s.id and e.model = ${model} and e.updated_at >= s.updated_at)
    ) x order by updated_at desc limit ${limit}`);
}

/** Stand van zaken voor Instellingen. */
export async function searchStatus() {
  const cfg = embeddingConfig();
  const v = await vectorStore();
  const [{ items }] = await db.execute<{ items: number }>(sql`select (select count(*) from notes)::int + (select count(*) from sources)::int as items`);
  let indexed = 0;
  let stale = 0;
  if (cfg && v.ok) {
    const [r] = await db.execute<{ n: number }>(sql`select count(distinct (kind, ref_id))::int as n from embeddings where model = ${cfg.model}`);
    indexed = r?.n ?? 0;
    stale = (await staleItems(cfg.model, 10_000)).length;
  }
  return {
    vector: v.ok,
    vectorError: v.ok ? null : v.error ?? null,
    provider: cfg ? PROVIDER_LABEL[cfg.provider] : null,
    model: cfg?.model ?? null,
    problem: embeddingProblem(),
    items,
    indexed,
    stale,
    semantic: !!cfg && v.ok,
    lastError: lastIndexError,
  };
}

/* ---------------- Zoeken ---------------- */

export type SearchHit = {
  kind: SearchKind;
  id: string;
  title: string;
  href: string;
  label: string; // soort notitie of bron
  date: string | null;
  clientName: string | null;
  projectName: string | null;
  snippet: string;
  excerpt: string; // langer stuk tekst voor Hermes/Claude
  match: "semantisch" | "trefwoord" | "beide";
};

export type SearchResult = { mode: "semantisch" | "trefwoord"; reason: string | null; hits: SearchHit[] };

const STOP = new Set("de het een en of van in op te met voor over aan bij is was zijn wat wie hoe waar wanneer we wij ik je jij hij zij ze die dat dit er om als dan ook nog naar uit door tot heb hebben heeft".split(" "));

export function queryWords(q: string): string[] {
  return [...new Set(q.toLowerCase().normalize("NFC").split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1 && !STOP.has(w)))];
}

export async function searchKnowledge(query: string, opts: { limit?: number; clientId?: string | null; kinds?: SearchKind[] } = {}): Promise<SearchResult> {
  const q = query.trim();
  const limit = opts.limit ?? 12;
  const kinds = opts.kinds?.length ? opts.kinds : (["note", "source"] as SearchKind[]);
  if (!q) return { mode: "trefwoord", reason: null, hits: [] };

  const keyword = await keywordSearch(q, kinds, opts.clientId ?? null);

  let semantic: { kind: SearchKind; id: string; content: string }[] = [];
  let mode: SearchResult["mode"] = "trefwoord";
  let { cfg, reason } = await semanticReady();
  if (cfg) {
    try {
      await syncEmbeddings(25); // wat sinds de laatste keer is gewijzigd, kort bijwerken
      semantic = await semanticSearch(cfg, q, kinds, opts.clientId ?? null);
      mode = "semantisch";
    } catch (e) {
      reason = `Semantisch zoeken mislukte: ${e instanceof Error ? e.message : String(e)}. Resultaten op trefwoord.`;
      cfg = null;
    }
  }

  // Reciprocal rank fusion
  const score = new Map<string, { kind: SearchKind; id: string; s: number; sem?: string; kw: boolean }>();
  const bump = (kind: SearchKind, id: string, rank: number, from: "sem" | "kw", content?: string) => {
    const k = `${kind}:${id}`;
    const cur = score.get(k) ?? { kind, id, s: 0, kw: false };
    cur.s += 1 / (60 + rank);
    if (from === "sem") cur.sem ??= content;
    else cur.kw = true;
    score.set(k, cur);
  };
  semantic.forEach((h, i) => bump(h.kind, h.id, i, "sem", h.content));
  keyword.forEach((h, i) => bump(h.kind, h.id, i, "kw"));
  const ranked = [...score.values()].sort((a, b) => b.s - a.s).slice(0, limit);
  if (!ranked.length) return { mode, reason, hits: [] };

  const meta = await itemMeta(ranked);
  const words = queryWords(q);
  const hits: SearchHit[] = [];
  for (const r of ranked) {
    const m = meta.get(`${r.kind}:${r.id}`);
    if (!m) continue;
    const text = r.sem ? r.sem.split("\n\n").slice(1).join("\n\n") || m.text : m.text;
    hits.push({
      kind: r.kind,
      id: r.id,
      title: m.title,
      href: r.kind === "note" ? `/notities/${r.id}` : `/notities/bronnen/${r.id}`,
      label: m.label,
      date: m.date,
      clientName: m.clientName,
      projectName: m.projectName,
      snippet: snippetFor(text, words, 240),
      excerpt: (r.sem ? text : snippetFor(m.text, words, 1500)).slice(0, 1500),
      match: r.sem && r.kw ? "beide" : r.sem ? "semantisch" : "trefwoord",
    });
  }
  return { mode, reason, hits };
}

async function keywordSearch(q: string, kinds: SearchKind[], clientId: string | null) {
  const words = queryWords(q);
  if (!words.length) return [];
  // Alle woorden met OF; ts_rank beloont meer treffers. Plus een gewone deelwoordzoektocht als vangnet.
  const tsq = sql`(select to_tsquery('dutch', coalesce(nullif(replace(plainto_tsquery('dutch', ${words.join(" ")})::text, '&', '|'), ''), 'xxxgeenresultaatxxx')))`;
  const like = words.map((w) => `%${w.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  const out: { kind: SearchKind; id: string; rank: number }[] = [];
  if (kinds.includes("note")) {
    const docN = sql`setweight(to_tsvector('dutch', n.title), 'A') || setweight(to_tsvector('dutch', coalesce(c.name, '') || ' ' || coalesce(p.name, '')), 'B') || setweight(to_tsvector('dutch', coalesce(n.body, '')), 'C')`;
    const likeN = sql.join(like.map((l) => sql`(n.title ilike ${l} or n.body ilike ${l} or c.name ilike ${l})`), sql` or `);
    const rows = await db.execute<{ id: string; rank: number }>(sql`
      select n.id, (ts_rank(${docN}, ${tsq}) + case when (${likeN}) then 0.01 else 0 end)::float as rank
      from notes n left join clients c on c.id = n.client_id left join projects p on p.id = n.project_id
      where (${docN} @@ ${tsq} or ${likeN}) ${clientId ? sql`and n.client_id = ${clientId}` : sql``}
      order by rank desc, n.updated_at desc limit 40`);
    out.push(...rows.map((r) => ({ kind: "note" as const, id: r.id, rank: Number(r.rank) })));
  }
  if (kinds.includes("source")) {
    const docS = sql`setweight(to_tsvector('dutch', s.title), 'A') || setweight(to_tsvector('dutch', coalesce(s.summary, '') || ' ' || coalesce(s.author, '') || ' ' || coalesce(c.name, '')), 'B') || setweight(to_tsvector('dutch', coalesce(s.body, '')), 'C')`;
    const likeS = sql.join(like.map((l) => sql`(s.title ilike ${l} or s.summary ilike ${l} or s.body ilike ${l} or s.url ilike ${l})`), sql` or `);
    const rows = await db.execute<{ id: string; rank: number }>(sql`
      select s.id, (ts_rank(${docS}, ${tsq}) + case when (${likeS}) then 0.01 else 0 end)::float as rank
      from sources s left join clients c on c.id = s.client_id
      where (${docS} @@ ${tsq} or ${likeS}) ${clientId ? sql`and s.client_id = ${clientId}` : sql``}
      order by rank desc, s.updated_at desc limit 40`);
    out.push(...rows.map((r) => ({ kind: "source" as const, id: r.id, rank: Number(r.rank) })));
  }
  return out.sort((a, b) => b.rank - a.rank);
}

async function semanticSearch(cfg: EmbeddingConfig, q: string, kinds: SearchKind[], clientId: string | null) {
  const [v] = await embed(cfg, [q], "query");
  const rows = await db.execute<{ kind: SearchKind; ref_id: string; content: string; dist: number }>(sql`
    select e.kind, e.ref_id, e.content, (e.embedding <=> ${vectorLiteral(v)}::vector)::float as dist
    from embeddings e
    left join notes n on e.kind = 'note' and n.id = e.ref_id
    left join sources s on e.kind = 'source' and s.id = e.ref_id
    where e.model = ${cfg.model}
      and e.kind in (${sql.join(kinds.map((k) => sql`${k}`), sql`, `)})
      ${clientId ? sql`and coalesce(n.client_id, s.client_id) = ${clientId}` : sql``}
    order by dist asc limit 80`);
  if (!rows.length) return [];
  // Beste stuk per item; items ver onder de beste treffer vallen af
  const best = Number(rows[0].dist);
  const seen = new Set<string>();
  const out: { kind: SearchKind; id: string; content: string }[] = [];
  for (const r of rows) {
    const k = `${r.kind}:${r.ref_id}`;
    if (seen.has(k) || Number(r.dist) > best + 0.35) continue;
    seen.add(k);
    out.push({ kind: r.kind, id: r.ref_id, content: r.content });
    if (out.length >= 20) break;
  }
  return out;
}

async function itemMeta(items: { kind: SearchKind; id: string }[]) {
  const noteIds = items.filter((i) => i.kind === "note").map((i) => i.id);
  const sourceIds = items.filter((i) => i.kind === "source").map((i) => i.id);
  const map = new Map<string, { title: string; label: string; date: string | null; clientName: string | null; projectName: string | null; text: string }>();
  const ids = (list: string[]) => sql.join(list.map((i) => sql`${i}::uuid`), sql`, `);
  if (noteIds.length) {
    const rows = await db.execute<{ id: string; title: string; body: string | null; type: string; d: string | null; client: string | null; project: string | null }>(sql`
      select n.id, n.title, n.body, n.type::text as type, coalesce(n.note_date::text, to_char(n.created_at, 'YYYY-MM-DD')) as d, c.name as client, p.name as project
      from notes n left join clients c on c.id = n.client_id left join projects p on p.id = n.project_id
      where n.id in (${ids(noteIds)})`);
    for (const r of rows) map.set(`note:${r.id}`, { title: r.title, label: NOTE_TYPE[r.type] ?? r.type, date: r.d, clientName: r.client, projectName: r.project, text: r.body ?? "" });
  }
  if (sourceIds.length) {
    const rows = await db.execute<{ id: string; title: string; body: string | null; summary: string | null; kind: string; d: string; client: string | null; project: string | null }>(sql`
      select s.id, s.title, s.body, s.summary, s.kind::text as kind, to_char(s.created_at, 'YYYY-MM-DD') as d, c.name as client, p.name as project
      from sources s left join clients c on c.id = s.client_id left join projects p on p.id = s.project_id
      where s.id in (${ids(sourceIds)})`);
    for (const r of rows)
      map.set(`source:${r.id}`, { title: r.title, label: `Bron · ${SOURCE_KIND[r.kind] ?? r.kind}`, date: r.d, clientName: r.client, projectName: r.project, text: [r.summary, r.body].filter(Boolean).join("\n\n") });
  }
  return map;
}

/** Markdown en [[links]] weg voor een leesbaar fragment. */
function plain(text: string): string {
  return text
    .replace(/\[\[([^\]|\n]+)\|([^\]\n]+)\]\]/g, "$2")
    .replace(/\[\[(?:[a-z]+:)?([^\]\n#]+)(#[^\]\n]*)?\]\]/gi, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/[*_`~]{1,3}/g, "");
}

/** Stukje tekst rond het eerste gevonden zoekwoord. */
export function snippetFor(text: string, words: string[], max: number): string {
  const flat = plain(text).replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const lower = flat.toLowerCase();
  let at = -1;
  for (const w of words) {
    const i = lower.indexOf(w.slice(0, Math.max(4, w.length - 2)));
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return `${flat.slice(0, max)}…`;
  const from = Math.max(0, at - Math.floor(max / 3));
  return `${from > 0 ? "…" : ""}${flat.slice(from, from + max)}${from + max < flat.length ? "…" : ""}`;
}
