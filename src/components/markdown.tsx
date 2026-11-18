import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { newNoteHref, parseLinkInner, PREFIX_OF } from "@/lib/wikilinks";
import type { ResolvedLinks } from "@/lib/brain";

/**
 * Eenvoudige, veilige markdown-weergave (geen HTML uit de tekst) met [[links]].
 * Kopjes, alinea's, lijsten (ook genest en met vinkjes), citaten, code, tabellen, links, vet en cursief.
 */
export function Markdown({ text, links = {}, className = "" }: { text: string | null | undefined; links?: ResolvedLinks; className?: string }) {
  if (!text?.trim()) return null;
  return <div className={`space-y-3 text-[15px] leading-relaxed text-grafiet ${className}`}>{blocks(text.replace(/\r\n?/g, "\n"), links)}</div>;
}

/* ---------------- Blokken ---------------- */

function blocks(text: string, links: ResolvedLinks): ReactNode[] {
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  const isList = (l: string) => /^\s*([-*+]|\d+[.)])\s+/.test(l);

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    // Codeblok
    const fence = line.match(/^\s*(```|~~~)(.*)$/);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      out.push(
        <pre key={key++} className="overflow-x-auto rounded-sm bg-parel p-3 font-mono text-[13px] leading-snug text-nacht">
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    // Kopje
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const cls = level === 1 ? "text-2xl font-bold" : level === 2 ? "text-xl font-bold" : level === 3 ? "text-lg font-bold" : "font-bold";
      out.push(
        <p key={key++} role="heading" aria-level={level} className={`${cls} pt-2 text-nacht`}>
          {inline(h[2], links)}
        </p>,
      );
      i++;
      continue;
    }
    // Lijn
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push(<hr key={key++} className="border-lijn" />);
      i++;
      continue;
    }
    // Citaat
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push(
        <blockquote key={key++} className="space-y-2 border-l-[3px] border-nacht pl-4 text-grafiet">
          {blocks(body.join("\n"), links)}
        </blockquote>,
      );
      continue;
    }
    // Tabel
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      const cells = (l: string) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
      out.push(
        <div key={key++} className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-nacht text-left">
                {head.map((c, j) => <th key={j} className="px-2 py-1.5 font-bold text-nacht">{inline(c, links)}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, j) => (
                <tr key={j} className="border-b border-lijn">
                  {head.map((_, k) => <td key={k} className="px-2 py-1.5 align-top">{inline(r[k] ?? "", links)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    // Lijst (genest op inspringing)
    if (isList(line)) {
      const items: string[] = [];
      while (i < lines.length && (isList(lines[i]) || (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length))) items.push(lines[i++]);
      out.push(<Fragment key={key++}>{list(items, links)}</Fragment>);
      continue;
    }
    // Alinea
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|\s*```|\s*~~~|\s*>)/.test(lines[i]) && !isList(lines[i])) para.push(lines[i++]);
    if (!para.length) para.push(lines[i++]);
    out.push(
      <p key={key++}>
        {para.map((p, j) => (
          <Fragment key={j}>
            {j > 0 && <br />}
            {inline(p, links)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return out;
}

type Item = { indent: number; ordered: boolean; text: string; children: string[] };

function list(lines: string[], links: ResolvedLinks): ReactNode {
  const base = lines[0].match(/^\s*/)![0].length;
  const items: Item[] = [];
  for (const l of lines) {
    const m = l.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    const indent = l.match(/^\s*/)![0].length;
    if (m && indent <= base + 1) items.push({ indent, ordered: /\d/.test(m[2]), text: m[3], children: [] });
    else if (items.length) items[items.length - 1].children.push(l);
  }
  const ordered = items[0]?.ordered;
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag className={`space-y-1 pl-6 ${ordered ? "list-decimal" : "list-disc"} marker:text-steen`}>
      {items.map((it, j) => {
        const task = it.text.match(/^\[( |x|X)\]\s+(.*)$/);
        return (
          <li key={j} className={task ? "-ml-6 list-none" : ""}>
            {task ? (
              <span className="flex items-start gap-2">
                <span aria-hidden className={`mt-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-nacht text-[10px] ${task[1] !== " " ? "bg-nacht text-op-nacht" : ""}`}>
                  {task[1] !== " " ? "✓" : ""}
                </span>
                <span className={task[1] !== " " ? "text-steen line-through" : ""}>{inline(task[2], links)}</span>
              </span>
            ) : (
              inline(it.text, links)
            )}
            {it.children.length > 0 && <div className="mt-1">{list(it.children, links)}</div>}
          </li>
        );
      })}
    </Tag>
  );
}

/* ---------------- Tekst in een regel ---------------- */

const INLINE = /(`[^`]+`)|(\[\[[^\[\]\n]+?\]\])|(\[[^\]]+\]\((?:https?:\/\/|mailto:|\/)[^)\s]+\))|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(~~[^~]+~~)/g;

function inline(text: string, links: ResolvedLinks): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const [all, code, wiki, mdLink, url, bold, italic, strike] = m;
    if (code) out.push(<code key={key++} className="rounded-sm bg-parel px-1 font-mono text-[13px] text-nacht">{code.slice(1, -1)}</code>);
    else if (wiki) out.push(<WikiLink key={key++} inner={wiki.slice(2, -2)} links={links} />);
    else if (mdLink) {
      const mm = mdLink.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)!;
      const href = mm[2];
      out.push(
        href.startsWith("/") ? (
          <Link key={key++} href={href} className="font-bold text-nacht underline decoration-steen underline-offset-2">{inline(mm[1], links)}</Link>
        ) : (
          <a key={key++} href={href} target="_blank" rel="noopener noreferrer" className="text-nacht underline decoration-steen underline-offset-2">{inline(mm[1], links)}</a>
        ),
      );
    } else if (url) out.push(<a key={key++} href={url} target="_blank" rel="noopener noreferrer" className="break-all text-nacht underline decoration-steen underline-offset-2">{url.replace(/^https?:\/\/(www\.)?/, "")}</a>);
    else if (bold) out.push(<strong key={key++} className="font-bold text-nacht">{inline(bold.slice(2, -2), links)}</strong>);
    else if (italic) out.push(<em key={key++}>{inline(italic.slice(1, -1), links)}</em>);
    else if (strike) out.push(<s key={key++} className="text-steen">{inline(strike.slice(2, -2), links)}</s>);
    else out.push(all);
    last = m.index! + all.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function WikiLink({ inner, links }: { inner: string; links: ResolvedLinks }) {
  const p = parseLinkInner(inner);
  const target = links[`${p.kind ?? ""}:${p.key}`];
  const label = p.alias ?? (p.heading ? `${p.target} › ${p.heading}` : p.target);
  if (target)
    return (
      <Link href={target.href} title={`${target.title}${p.kind ? ` (${PREFIX_OF[p.kind]})` : ""}`} className="font-bold text-nacht underline decoration-nacht/40 decoration-2 underline-offset-2 hover:decoration-nacht">
        {label}
      </Link>
    );
  // Bestaat nog niet: aanklikken maakt een notitie (alleen zonder voorvoegsel of met notitie:)
  if (!p.kind || p.kind === "note")
    return (
      <Link href={newNoteHref(p.target)} title="Bestaat nog niet: klik om de notitie te maken" className="text-steen underline decoration-dashed underline-offset-2 hover:text-nacht">
        {label}
      </Link>
    );
  return <span title={`${PREFIX_OF[p.kind]} "${p.target}" niet gevonden`} className="text-steen underline decoration-dotted underline-offset-2">{label}</span>;
}
