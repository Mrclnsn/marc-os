import Link from "next/link";
import { PageHeader } from "@/components/brand";
import { BrainTabs } from "@/components/brain-parts";
import { ClientSelect } from "@/components/forms";
import { listSources, sourceCounts } from "@/lib/data";
import { SOURCE_KIND, SOURCE_STATUS, type SourceKind, type SourceStatus } from "@/lib/labels";
import { formatShort } from "@/lib/dates";
import { getOptions } from "@/lib/options";
import { createSourceAction, setSourceStatusAction } from "../../../actions";

type SP = { status?: string; soort?: string; zoek?: string };

export default async function SourcesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const status = sp.status && sp.status in SOURCE_STATUS ? (sp.status as SourceStatus) : undefined;
  const kind = sp.soort && sp.soort in SOURCE_KIND ? (sp.soort as SourceKind) : undefined;
  const [rows, counts, options] = await Promise.all([listSources({ status, kind, search: sp.zoek || undefined }), sourceCounts(), getOptions()]);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Second brain" title="Bronnen" />
      <BrainTabs active="bronnen" />
      <p className="-mt-2 max-w-2xl text-sm text-steen">
        Links, artikelen, video&apos;s en ideeën om te bewaren. Plak een link: de titel en beschrijving worden zelf opgehaald. Schrijf in je aantekeningen [[links]] naar notities, klanten en projecten.
      </p>

      <form action={createSourceAction} className="card grid grid-cols-2 gap-2 p-2 md:grid-cols-6">
        <input name="url" placeholder="Plak een link (https://...)" className="input col-span-2 md:col-span-3" inputMode="url" />
        <input name="title" placeholder="Titel (of een idee zonder link)" className="input col-span-2 md:col-span-3" />
        <select name="kind" defaultValue="" className="input">
          <option value="">Soort: automatisch</option>
          {Object.entries(SOURCE_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <ClientSelect clients={options.clients} />
        <input name="summary" placeholder="Waarom bewaren? (optioneel)" className="input col-span-2 md:col-span-3" />
        <button className="btn-primary col-span-2 md:col-span-6">Bron bewaren</button>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <Link href="/notities/bronnen" className={!status ? "tab-active" : "tab"}>Alle</Link>
        {(Object.keys(SOURCE_STATUS) as SourceStatus[]).map((k) => (
          <Link key={k} href={`/notities/bronnen?status=${k}`} className={status === k ? "tab-active" : "tab"}>
            {SOURCE_STATUS[k]} <span className="text-xs text-steen">{counts[k] ?? 0}</span>
          </Link>
        ))}
        <form className="ml-auto flex gap-2" action="/notities/bronnen">
          {status && <input type="hidden" name="status" value={status} />}
          <select name="soort" defaultValue={kind ?? ""} className="input py-1 text-xs">
            <option value="">Alle soorten</option>
            {Object.entries(SOURCE_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input name="zoek" defaultValue={sp.zoek ?? ""} placeholder="Filter" className="input py-1 text-xs" />
          <button className="btn py-1 text-xs">Filter</button>
        </form>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-steen">Nog geen bronnen{status ? " met deze status" : ""}.</p>
      ) : (
        <ul className="card divide-y divide-lijn">
          {rows.map(({ source: s, clientName }) => (
            <li key={s.id} className="flex items-start gap-3 px-3 py-3">
              <span className="chip mt-0.5">{SOURCE_KIND[s.kind]}</span>
              <div className="min-w-0 flex-1">
                <Link href={`/notities/bronnen/${s.id}`} className="font-bold text-nacht hover:underline">{s.title}</Link>
                <p className="truncate text-xs text-steen">
                  {[s.author, s.url?.replace(/^https?:\/\/(www\.)?/, ""), clientName].filter(Boolean).join(" · ")}
                </p>
                {s.summary && <p className="mt-1 line-clamp-2 text-sm text-grafiet">{s.summary}</p>}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-steen">
                <span>{formatShort(s.createdAt.toISOString().slice(0, 10))}</span>
                {s.status === "new" && (
                  <form action={setSourceStatusAction.bind(null, s.id, "read")}>
                    <button className="btn-ghost text-xs">Gelezen</button>
                  </form>
                )}
                {s.status !== "new" && <span>{SOURCE_STATUS[s.status]}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
