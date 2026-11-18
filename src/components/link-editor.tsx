"use client";

import { useMemo, useRef, useState } from "react";
import { LINK_PREFIX, PREFIX_OF, linkKey, type LinkKind } from "@/lib/wikilinks";

export type Suggestion = { kind: LinkKind; title: string };

const KIND_LABEL: Record<LinkKind, string> = { note: "Notitie", client: "Klant", project: "Project", source: "Bron" };
const ORDER: Record<LinkKind, number> = { note: 0, client: 1, project: 2, source: 3 };

/**
 * Tekstvak voor markdown met aanvullen van [[links]]: typ [[ en een deel van de naam.
 * Pijltjes en Enter (of Tab) om te kiezen, Esc om te sluiten. Cmd/Ctrl+Enter slaat op.
 */
export function LinkEditor({ name = "body", defaultValue, suggestions, rows = 18, placeholder }: { name?: string; defaultValue?: string | null; suggestions: Suggestion[]; rows?: number; placeholder?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [sel, setSel] = useState(0);

  const byKey = useMemo(() => {
    const m = new Map<string, Suggestion[]>();
    for (const s of suggestions) {
      const k = linkKey(s.title);
      m.set(k, [...(m.get(k) ?? []), s].sort((a, b) => ORDER[a.kind] - ORDER[b.kind]));
    }
    return m;
  }, [suggestions]);

  const options = useMemo(() => {
    if (query === null) return [];
    let q = query.toLowerCase().trim();
    let kind: LinkKind | null = null;
    const pre = q.match(/^([a-zé]+):\s*(.*)$/);
    if (pre && LINK_PREFIX[pre[1]]) {
      kind = LINK_PREFIX[pre[1]];
      q = pre[2];
    }
    const list = suggestions
      .filter((s) => (!kind || s.kind === kind) && s.title.toLowerCase().includes(q))
      .sort((a, b) => {
        const pa = a.title.toLowerCase().startsWith(q) ? 0 : 1;
        const pb = b.title.toLowerCase().startsWith(q) ? 0 : 1;
        return pa - pb || ORDER[a.kind] - ORDER[b.kind] || a.title.localeCompare(b.title, "nl");
      })
      .slice(0, 8)
      .map((s) => ({ ...s, isNew: false }));
    const typed = (pre && LINK_PREFIX[pre[1]] ? pre[2] : query).trim();
    if (typed && (!kind || kind === "note") && !list.some((s) => linkKey(s.title) === linkKey(typed))) list.push({ kind: "note", title: typed, isNew: true });
    return list;
  }, [query, suggestions]);

  const detect = () => {
    const el = ref.current;
    if (!el) return;
    const before = el.value.slice(0, el.selectionStart);
    const m = before.match(/\[\[([^\[\]\n|#]{0,60})$/);
    setQuery(m ? m[1] : null);
    setSel(0);
  };

  const pick = (s: Suggestion) => {
    const el = ref.current;
    if (!el || query === null) return;
    const start = el.selectionStart - query.length;
    const after = el.value.slice(el.selectionStart);
    // Voorvoegsel alleen als een andere soort met dezelfde naam anders voorgaat
    const first = byKey.get(linkKey(s.title))?.[0];
    const prefix = first && first.kind !== s.kind ? `${PREFIX_OF[s.kind]}:` : "";
    const closing = after.startsWith("]]") ? "" : "]]";
    const insert = `${prefix}${s.title}${closing}`;
    el.setRangeText(insert, start, el.selectionStart, "end");
    if (!closing) el.setSelectionRange(start + insert.length + 2, start + insert.length + 2);
    setQuery(null);
    el.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
      return;
    }
    if (query === null || !options.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((i) => (i + 1) % options.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((i) => (i - 1 + options.length) % options.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      pick(options[sel]);
    } else if (e.key === "Escape") {
      setQuery(null);
    }
  };

  return (
    <div className="relative">
      <textarea
        ref={ref}
        name={name}
        defaultValue={defaultValue ?? ""}
        rows={rows}
        placeholder={placeholder ?? "Schrijf hier... Typ [[ om te linken naar een notitie, klant, project of bron."}
        className="input w-full font-mono text-sm leading-relaxed"
        onInput={detect}
        onClick={detect}
        onKeyUp={(e) => {
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) detect();
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
      />
      {query !== null && options.length > 0 && (
        <ul className="absolute inset-x-0 bottom-full z-20 mb-1 max-h-72 overflow-y-auto rounded-sm border border-nacht bg-vlak shadow-lg md:inset-x-auto md:left-0 md:w-96" role="listbox">
          {options.map((o, i) => (
            <li key={`${o.kind}:${o.title}:${o.isNew}`} role="option" aria-selected={i === sel}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(o);
                }}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${i === sel ? "bg-parel" : ""}`}
              >
                <span className="truncate text-nacht">{o.isNew ? `Nieuwe notitie: ${o.title}` : o.title}</span>
                <span className="shrink-0 text-xs text-steen">{o.isNew ? "maakt link" : KIND_LABEL[o.kind]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
