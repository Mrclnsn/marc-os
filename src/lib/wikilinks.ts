/**
 * [[Links]] in markdown, zoals in Obsidian. Zonder database, dus ook in de browser en in scripts te gebruiken.
 *
 * Vormen:
 *   [[Titel]]                 notitie, klant, project, bron of leeronderwerp met die naam (in die volgorde)
 *   [[Titel|tekst]]           zelfde doel, andere tekst
 *   [[klant:Vobis]]           expliciet een klant (ook project:, bron:, notitie:, leren:)
 *   [[Titel#Kopje]]           kopje wordt bewaard voor de weergave, het doel is de titel
 */

export type LinkKind = "note" | "client" | "project" | "source" | "learning";

export const LINK_KINDS: LinkKind[] = ["note", "client", "project", "source", "learning"];

/** Voorvoegsels in de link, in het Nederlands zoals Marc ze typt. */
export const LINK_PREFIX: Record<string, LinkKind> = {
  notitie: "note",
  klant: "client",
  project: "project",
  bron: "source",
  leren: "learning",
};

export const PREFIX_OF: Record<LinkKind, string> = { note: "notitie", client: "klant", project: "project", source: "bron", learning: "leren" };

export const LINK_KIND_LABEL: Record<LinkKind, string> = { note: "Notitie", client: "Klant", project: "Project", source: "Bron", learning: "Leren" };

export type ParsedLink = {
  raw: string; // de hele [[...]]
  target: string; // titel zonder voorvoegsel, kopje en alias
  kind: LinkKind | null; // expliciet voorvoegsel
  key: string; // genormaliseerd doel
  alias: string | null;
  heading: string | null;
  index: number; // positie in de tekst
};

const LINK_RE = /\[\[([^\[\]\n]+?)\]\]/g;

/** Kleine letters, spaties samengevoegd: zo vergelijken we titels. */
export function linkKey(title: string): string {
  return title.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function parseLinkInner(inner: string): Omit<ParsedLink, "raw" | "index"> {
  let rest = inner;
  let alias: string | null = null;
  const pipe = rest.indexOf("|");
  if (pipe >= 0) {
    alias = rest.slice(pipe + 1).trim() || null;
    rest = rest.slice(0, pipe);
  }
  let heading: string | null = null;
  const hash = rest.indexOf("#");
  if (hash >= 0) {
    heading = rest.slice(hash + 1).trim() || null;
    rest = rest.slice(0, hash);
  }
  let kind: LinkKind | null = null;
  const m = rest.match(/^\s*([a-zA-Zé]+)\s*:\s*(.+)$/);
  if (m && LINK_PREFIX[m[1].toLowerCase()]) {
    kind = LINK_PREFIX[m[1].toLowerCase()];
    rest = m[2];
  }
  const target = rest.trim().replace(/\s+/g, " ");
  return { target, kind, key: linkKey(target), alias, heading };
}

/** Alle links in een tekst, in volgorde. Links in codeblokken en `inline code` tellen niet mee. */
export function parseWikilinks(text: string | null | undefined): ParsedLink[] {
  if (!text) return [];
  const masked = maskCode(text);
  const out: ParsedLink[] = [];
  for (const m of masked.matchAll(LINK_RE)) {
    const inner = text.slice(m.index! + 2, m.index! + m[0].length - 2);
    const p = parseLinkInner(inner);
    if (!p.target) continue;
    out.push({ raw: text.slice(m.index!, m.index! + m[0].length), index: m.index!, ...p });
  }
  return out;
}

/** Vervangt code door spaties (zelfde lengte), zodat posities kloppen. */
function maskCode(text: string): string {
  return text
    .replace(/```[\s\S]*?(```|$)/g, (s) => " ".repeat(s.length))
    .replace(/`[^`\n]*`/g, (s) => " ".repeat(s.length));
}

/** Regel rond een positie, ingekort: context voor backlinks. */
export function lineAround(text: string, index: number, max = 220): string {
  const start = text.lastIndexOf("\n", index) + 1;
  let end = text.indexOf("\n", index);
  if (end < 0) end = text.length;
  let line = text.slice(start, end).trim();
  if (line.length > max) {
    const rel = index - start;
    const from = Math.max(0, Math.min(line.length - max, rel - Math.floor(max / 2)));
    line = `${from > 0 ? "…" : ""}${line.slice(from, from + max)}${from + max < line.length ? "…" : ""}`;
  }
  return line;
}

/** Vervangt elke [[link]] in de tekst (buiten code) door de uitkomst van fn. */
export function replaceWikilinks(text: string, fn: (link: ParsedLink) => string): string {
  const links = parseWikilinks(text);
  if (!links.length) return text;
  let out = "";
  let last = 0;
  for (const l of links) {
    out += text.slice(last, l.index) + fn(l);
    last = l.index + l.raw.length;
  }
  return out + text.slice(last);
}

/* ---------------- Opzoeken ---------------- */

export type LinkEntity = { kind: LinkKind; id: string; title: string };

export type EntityIndex = Map<string, LinkEntity[]>; // key → entiteiten met die naam

/** Index van alle namen; bij dezelfde naam wint de volgorde notitie, klant, project, bron. */
export function buildEntityIndex(entities: LinkEntity[]): EntityIndex {
  const order: Record<LinkKind, number> = { note: 0, client: 1, project: 2, source: 3, learning: 4 };
  const idx: EntityIndex = new Map();
  for (const e of entities) {
    const k = linkKey(e.title);
    if (!k) continue;
    const list = idx.get(k) ?? [];
    list.push(e);
    idx.set(k, list);
  }
  for (const list of idx.values()) list.sort((a, b) => order[a.kind] - order[b.kind]);
  return idx;
}

export function resolveLink(idx: EntityIndex, link: { key: string; kind: LinkKind | null }): LinkEntity | null {
  const list = idx.get(link.key);
  if (!list?.length) return null;
  if (link.kind) return list.find((e) => e.kind === link.kind) ?? null;
  return list[0];
}

export function entityHref(e: { kind: LinkKind; id: string }): string {
  switch (e.kind) {
    case "note":
      return `/notities/${e.id}`;
    case "client":
      return `/klanten/${e.id}`;
    case "project":
      return `/projecten/${e.id}`;
    case "source":
      return `/notities/bronnen/${e.id}`;
    case "learning":
      return `/leren/${e.id}`;
  }
}

/** Link naar een notitie die nog niet bestaat: opent een nieuwe notitie met die titel. */
export function newNoteHref(title: string): string {
  return `/notities/nieuw?titel=${encodeURIComponent(title)}`;
}
