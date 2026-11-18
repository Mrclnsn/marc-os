import Link from "next/link";
import { PageHeader } from "@/components/brand";
import { BrainTabs } from "@/components/brain-parts";
import { searchKnowledge } from "@/lib/data";
import { formatShort } from "@/lib/dates";
import { getOptions } from "@/lib/options";

type SP = { q?: string; klant?: string; soort?: string };

export default async function SearchPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const kinds = sp.soort === "note" || sp.soort === "source" ? [sp.soort as "note" | "source"] : undefined;
  const [result, options] = await Promise.all([q ? searchKnowledge(q, { clientId: sp.klant || null, kinds, limit: 20 }) : null, getOptions()]);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Second brain" title="Zoeken" />
      <BrainTabs active="zoeken" />

      <form action="/notities/zoeken" className="space-y-2">
        <div className="flex gap-2">
          <input name="q" defaultValue={q} autoFocus placeholder="Vraag of zoek, bijv. wat hebben we met Vobis afgesproken over SEO?" className="input flex-1" />
          <button className="btn-primary">Zoeken</button>
        </div>
        <div className="flex flex-wrap gap-2">
          <select name="klant" defaultValue={sp.klant ?? ""} className="input py-1 text-xs">
            <option value="">Alle klanten</option>
            {options.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select name="soort" defaultValue={sp.soort ?? ""} className="input py-1 text-xs">
            <option value="">Notities en bronnen</option>
            <option value="note">Alleen notities</option>
            <option value="source">Alleen bronnen</option>
          </select>
        </div>
      </form>

      {result && (
        <>
          <p className="text-xs text-steen">
            {result.mode === "semantisch" ? "Gezocht op betekenis en trefwoord." : "Gezocht op trefwoord."}
            {result.reason && <> {result.reason} <Link href="/instellingen#second-brain" className="underline">Instellingen</Link></>}
          </p>
          {result.hits.length === 0 ? (
            <p className="text-sm text-steen">Niets gevonden voor &quot;{q}&quot;.</p>
          ) : (
            <ul className="space-y-2">
              {result.hits.map((h) => (
                <li key={`${h.kind}:${h.id}`} className="card p-3">
                  <Link href={h.href} className="flex items-baseline justify-between gap-3">
                    <span className="font-bold text-nacht hover:underline">{h.title}</span>
                    <span className="shrink-0 text-xs text-steen">{formatShort(h.date)}</span>
                  </Link>
                  <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-steen">
                    <span>{h.label}</span>
                    {h.clientName && <span>· {h.clientName}</span>}
                    {h.projectName && <span>· ◫ {h.projectName}</span>}
                    <span>· {h.match === "beide" ? "betekenis + trefwoord" : h.match === "semantisch" ? "op betekenis" : "op trefwoord"}</span>
                  </p>
                  {h.snippet && <p className="mt-1.5 text-sm text-grafiet">{h.snippet}</p>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
