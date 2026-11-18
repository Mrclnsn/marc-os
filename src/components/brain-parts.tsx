import Link from "next/link";
import { SectionTitle } from "./brand";
import type { Backlink } from "@/lib/brain";
import { formatShort } from "@/lib/dates";

/** Tabbladen van de second brain. */
export function BrainTabs({ active }: { active: "notities" | "bronnen" | "grafiek" | "zoeken" }) {
  const tabs = [
    { key: "notities", href: "/notities", label: "Notities" },
    { key: "bronnen", href: "/notities/bronnen", label: "Bronnen" },
    { key: "grafiek", href: "/notities/grafiek", label: "Grafiek" },
    { key: "zoeken", href: "/notities/zoeken", label: "Zoeken" },
  ] as const;
  return (
    <nav className="-mt-4 mb-6 flex gap-5 border-b border-lijn">
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} className={t.key === active ? "tab-active" : "tab"}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/** Notities en bronnen die naar dit item linken, met de regel waarin de link staat. */
export function BacklinksPanel({ backlinks, title = "Links naar hier", empty = "Nog geen notities die hiernaar linken." }: { backlinks: Backlink[]; title?: string; empty?: string }) {
  return (
    <section>
      <SectionTitle aside={<span className="text-xs text-steen">{backlinks.length}</span>}>{title}</SectionTitle>
      {backlinks.length === 0 ? (
        <p className="text-sm text-steen">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {backlinks.map((b) => (
            <li key={`${b.fromKind}:${b.fromId}`} className="card p-3">
              <Link href={b.href} className="flex items-baseline justify-between gap-3">
                <span className="font-bold text-nacht hover:underline">{b.fromKind === "source" ? "◇ " : ""}{b.title}</span>
                <span className="shrink-0 text-xs text-steen">{formatShort(b.date)}</span>
              </Link>
              {b.contexts.slice(0, 3).map((c, i) => (
                <p key={i} className="mt-1 text-sm text-grafiet">{highlightLinks(c)}</p>
              ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Context van een backlink: [[links]] vet, verder platte tekst. */
function highlightLinks(text: string) {
  const parts = text.split(/(\[\[[^\]]+\]\])/g);
  return parts.map((p, i) =>
    p.startsWith("[[") ? (
      <strong key={i} className="text-nacht">{p.slice(2, -2).split("|").pop()!.replace(/^[a-z]+:/i, "")}</strong>
    ) : (
      p
    ),
  );
}

export function MentionsPanel({ mentions }: { mentions: { key: string; title: string; href: string; context: string | null }[] }) {
  if (!mentions.length) return null;
  return (
    <section>
      <SectionTitle aside={<span className="text-xs text-steen">{mentions.length}</span>}>Genoemd zonder link</SectionTitle>
      <ul className="divide-y divide-lijn">
        {mentions.map((m) => (
          <li key={m.key} className="py-2">
            <Link href={m.href} className="text-sm font-bold text-nacht hover:underline">{m.title}</Link>
            {m.context && <p className="text-xs text-steen">{m.context}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
