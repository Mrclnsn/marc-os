/**
 * Export naar een markdown-map in Obsidian-formaat. Marc OS blijft de bron; de map is om in Obsidian te bladeren.
 *
 *   Notities/<titel>.md    met eigenschappen (soort, gebied, klant, project, datum) en de tekst
 *   Bronnen/<titel>.md     link, samenvatting en eigen aantekeningen
 *   Klanten/<naam>.md      status, vaste informatie, contactpersonen (naam en rol), projecten, notities, bronnen
 *   Projecten/<naam>.md    status, klant, open taken, notities
 *   Reviews/<datum> <soort>.md
 *
 * [[Links]] worden omgezet naar het pad in de map ([[Klanten/Vobis|Vobis]]), zodat ze in Obsidian altijd kloppen,
 * ook als een notitie en een klant dezelfde naam hebben. Zonder "server-only": het nachtelijke script gebruikt dit ook.
 */
import { asc, ne } from "drizzle-orm";
import { db } from "@/db";
import { clientContacts, clients, notes, projects, reviews, sources, tasks } from "@/db/schema";
import { buildEntityIndex, replaceWikilinks, resolveLink, type LinkEntity, type LinkKind } from "./wikilinks";

export type VaultFile = { path: string; content: string };

export const VAULT_FOLDERS = ["Notities", "Bronnen", "Klanten", "Projecten", "Reviews"] as const;

const NOTE_TYPE: Record<string, string> = { note: "Notitie", meeting: "Meeting", call: "Telefoon", email: "E-mail", decision: "Besluit", info: "Info", idea: "Idee" };
const SOURCE_KIND: Record<string, string> = { article: "Artikel", video: "Video", podcast: "Podcast", book: "Boek", course: "Cursus", idea: "Idee", link: "Link" };
const SOURCE_STATUS: Record<string, string> = { new: "Nog bekijken", read: "Gelezen", processed: "Verwerkt" };
const CLIENT_STATUS: Record<string, string> = { lead: "Lead", active: "Actief", on_hold: "On hold", past: "Oud-klant" };
const PROJECT_STATUS: Record<string, string> = { idea: "Idee", planned: "Gepland", active: "Actief", waiting: "Wacht", done: "Afgerond", archived: "Gearchiveerd" };
const REVIEW_KIND: Record<string, string> = { day: "Dag", week: "Week", month: "Maand" };
const AREA: Record<string, string> = { zakelijk: "Zakelijk", prive: "Privé" };

/** Bestandsnaam zonder tekens die Obsidian of het bestandssysteem niet wil. */
export function safeName(title: string): string {
  const t = title
    .normalize("NFC")
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 120)
    .trim();
  return t || "Zonder titel";
}

const yamlValue = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return '""';
  if (Array.isArray(v)) return `[${v.map(yamlValue).join(", ")}]`;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(String(v)); // dubbele aanhalingstekens zijn geldige YAML
};

function frontmatter(props: Record<string, unknown>): string {
  const lines = Object.entries(props)
    .filter(([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => `${k}: ${yamlValue(v)}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

const iso = (d: Date | string | null | undefined) => (d ? (typeof d === "string" ? d : d.toISOString().slice(0, 10)) : null);

/** Bouwt alle bestanden van de map (in het geheugen). */
export async function buildVault(): Promise<VaultFile[]> {
  const [ns, ss, cs, ps, contacts, rs, ts] = await Promise.all([
    db.select().from(notes).where(ne(notes.type, "inbox")).orderBy(asc(notes.createdAt)),
    db.select().from(sources).orderBy(asc(sources.createdAt)),
    db.select().from(clients).orderBy(asc(clients.name)),
    db.select().from(projects).orderBy(asc(projects.name)),
    db.select().from(clientContacts).orderBy(asc(clientContacts.name)),
    db.select().from(reviews).orderBy(asc(reviews.periodDate)),
    db.select({ id: tasks.id, title: tasks.title, status: tasks.status, projectId: tasks.projectId, dueDate: tasks.dueDate, planDate: tasks.planDate }).from(tasks).where(ne(tasks.status, "done")),
  ]);

  // Uniek pad per item; bij dezelfde naam in dezelfde map komt er (2), (3) achter, op volgorde van aanmaken
  const pathOf = new Map<string, string>();
  const used = new Set<string>();
  const assign = (kind: LinkKind, id: string, folder: string, title: string) => {
    const base = `${folder}/${safeName(title)}`;
    let p = base;
    for (let i = 2; used.has(p.toLowerCase()); i++) p = `${base} (${i})`;
    used.add(p.toLowerCase());
    pathOf.set(`${kind}:${id}`, p);
  };
  for (const c of cs) assign("client", c.id, "Klanten", c.name);
  for (const p of ps) assign("project", p.id, "Projecten", p.name);
  for (const n of ns) assign("note", n.id, "Notities", n.title);
  for (const s of ss) assign("source", s.id, "Bronnen", s.title);

  const entities: LinkEntity[] = [
    ...ns.map((n) => ({ kind: "note" as const, id: n.id, title: n.title })),
    ...cs.map((c) => ({ kind: "client" as const, id: c.id, title: c.name })),
    ...ps.map((p) => ({ kind: "project" as const, id: p.id, title: p.name })),
    ...ss.map((s) => ({ kind: "source" as const, id: s.id, title: s.title })),
  ];
  const idx = buildEntityIndex(entities);
  const link = (kind: LinkKind, id: string | null | undefined, label?: string) => {
    if (!id) return null;
    const p = pathOf.get(`${kind}:${id}`);
    if (!p) return null;
    const name = label ?? p.split("/").pop()!;
    return `[[${p}|${name}]]`;
  };
  const convert = (text: string | null | undefined) =>
    text
      ? replaceWikilinks(text, (l) => {
          const e = resolveLink(idx, l);
          const label = l.alias ?? l.target;
          if (!e) return `[[${l.target}${l.heading ? `#${l.heading}` : ""}${l.alias ? `|${l.alias}` : ""}]]`;
          return `[[${pathOf.get(`${e.kind}:${e.id}`)}${l.heading ? `#${l.heading}` : ""}|${label}]]`;
        })
      : "";

  const clientName = new Map(cs.map((c) => [c.id, c.name]));
  const projectName = new Map(ps.map((p) => [p.id, p.name]));
  const files: VaultFile[] = [];

  for (const n of ns) {
    files.push({
      path: `${pathOf.get(`note:${n.id}`)}.md`,
      content:
        frontmatter({
          soort: NOTE_TYPE[n.type] ?? n.type,
          gebied: n.area ? AREA[n.area] : null,
          klant: link("client", n.clientId, clientName.get(n.clientId ?? "")),
          project: link("project", n.projectId, projectName.get(n.projectId ?? "")),
          datum: n.noteDate,
          aangemaakt: iso(n.createdAt),
          bijgewerkt: iso(n.updatedAt),
          tags: ["marc-os/notitie"],
          marc_os_id: n.id,
        }) + `\n${convert(n.body)}\n`,
    });
  }

  for (const s of ss) {
    const parts = [s.url ? `[${s.url.replace(/^https?:\/\/(www\.)?/, "")}](${s.url})` : null, s.summary ? `> ${s.summary.replace(/\n/g, "\n> ")}` : null, convert(s.body) || null];
    files.push({
      path: `${pathOf.get(`source:${s.id}`)}.md`,
      content:
        frontmatter({
          soort: SOURCE_KIND[s.kind] ?? s.kind,
          status: SOURCE_STATUS[s.status] ?? s.status,
          link: s.url,
          maker: s.author,
          gebied: s.area ? AREA[s.area] : null,
          klant: link("client", s.clientId, clientName.get(s.clientId ?? "")),
          project: link("project", s.projectId, projectName.get(s.projectId ?? "")),
          bewaard: iso(s.createdAt),
          tags: ["marc-os/bron"],
          marc_os_id: s.id,
        }) + `\n${parts.filter(Boolean).join("\n\n")}\n`,
    });
  }

  for (const c of cs) {
    const cps = ps.filter((p) => p.clientId === c.id);
    const cns = ns.filter((n) => n.clientId === c.id);
    const css = ss.filter((s) => s.clientId === c.id);
    const people = contacts.filter((p) => p.clientId === c.id);
    const body = [
      c.info ? `## Vaste informatie\n\n${convert(c.info)}` : null,
      people.length ? `## Contactpersonen\n\n${people.map((p) => `- ${p.name}${p.role ? ` (${p.role})` : ""}${p.isPrimary ? " · primair" : ""}`).join("\n")}` : null,
      cps.length ? `## Projecten\n\n${cps.map((p) => `- ${link("project", p.id, p.name)} · ${PROJECT_STATUS[p.status]}`).join("\n")}` : null,
      cns.length ? `## Notities\n\n${[...cns].reverse().map((n) => `- ${link("note", n.id, n.title)}${n.noteDate ? ` · ${n.noteDate}` : ""}`).join("\n")}` : null,
      css.length ? `## Bronnen\n\n${css.map((s) => `- ${link("source", s.id, s.title)}`).join("\n")}` : null,
    ];
    files.push({
      path: `${pathOf.get(`client:${c.id}`)}.md`,
      content:
        frontmatter({ status: CLIENT_STATUS[c.status], klant_sinds: c.clientSince, rechtsvorm: c.legalForm, plaats: c.city, tags: ["marc-os/klant"], marc_os_id: c.id }) +
        `\n${body.filter(Boolean).join("\n\n")}\n`,
    });
  }

  for (const p of ps) {
    const pns = ns.filter((n) => n.projectId === p.id);
    const pts = ts.filter((t) => t.projectId === p.id);
    const body = [
      p.description ? convert(p.description) : null,
      pts.length ? `## Open taken\n\n${pts.map((t) => `- [ ] ${t.title}${t.dueDate ? ` (deadline ${t.dueDate})` : t.planDate ? ` (${t.planDate})` : ""}`).join("\n")}` : null,
      pns.length ? `## Notities\n\n${[...pns].reverse().map((n) => `- ${link("note", n.id, n.title)}${n.noteDate ? ` · ${n.noteDate}` : ""}`).join("\n")}` : null,
    ];
    files.push({
      path: `${pathOf.get(`project:${p.id}`)}.md`,
      content:
        frontmatter({
          status: PROJECT_STATUS[p.status],
          gebied: AREA[p.area],
          klant: link("client", p.clientId, clientName.get(p.clientId ?? "")),
          start: p.startDate,
          deadline: p.dueDate,
          tags: ["marc-os/project"],
          marc_os_id: p.id,
        }) + `\n${body.filter(Boolean).join("\n\n")}\n`,
    });
  }

  for (const r of rs) {
    files.push({
      path: `Reviews/${r.periodDate} ${REVIEW_KIND[r.kind]}.md`,
      content: frontmatter({ soort: REVIEW_KIND[r.kind], periode: r.periodDate, tags: ["marc-os/review"], marc_os_id: r.id }) + `\n${convert(r.body)}\n`,
    });
  }

  files.push({
    path: "Marc OS.md",
    content: [
      "# Marc OS",
      "",
      "Deze map is een export uit Marc OS en wordt automatisch overschreven. Schrijf en wijzig in Marc OS zelf; wat je hier aanpast gaat bij de volgende export verloren.",
      "Eigen notities in Obsidian kun je kwijt in een andere map dan " + VAULT_FOLDERS.join(", ") + ".",
      "",
      `- ${ns.length} notities, ${ss.length} bronnen, ${cs.length} klanten, ${ps.length} projecten, ${rs.length} reviews`,
      `- Geëxporteerd: ${new Date().toLocaleString("nl-NL", { timeZone: process.env.APP_TIMEZONE ?? "Europe/Amsterdam" })}`,
      "",
    ].join("\n"),
  });

  return files;
}
