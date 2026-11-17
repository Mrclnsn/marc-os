import { PageHeader } from "@/components/brand";
import Link from "next/link";
import { listClients, listClientTags } from "@/lib/data";
import { CLIENT_STATUS, type ClientStatus } from "@/lib/labels";
import { createClientAction } from "../../actions";

type Search = { alles?: string; tag?: string; status?: string };

function href(current: Search, patch: Partial<Search>) {
  const next = { ...current, ...patch };
  const qs = new URLSearchParams(Object.entries(next).filter(([, v]) => v) as [string, string][]).toString();
  return qs ? `/klanten?${qs}` : "/klanten";
}

export default async function ClientsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const status = sp.status && sp.status in CLIENT_STATUS ? (sp.status as ClientStatus) : undefined;
  const [rows, tags] = await Promise.all([listClients({ includePast: !!sp.alles, tag: sp.tag, status }), listClientTags()]);

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Zakelijk" title="Klanten">
        <Link href="/websites" className="tab">Websites</Link>
        {!status && (
          <Link href={href(sp, { alles: sp.alles ? undefined : "1" })} className="tab">
            {sp.alles ? "Verberg oud-klanten" : "Toon oud-klanten"}
          </Link>
        )}
      </PageHeader>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link href={href(sp, { status: undefined })} className={!status ? "tab-active" : "tab"}>Alle</Link>
        {Object.entries(CLIENT_STATUS).map(([k, v]) => (
          <Link key={k} href={href(sp, { status: k, alles: undefined })} className={status === k ? "tab-active" : "tab"}>{v}</Link>
        ))}
        {tags.length > 0 && <span className="mx-1 h-4 w-px bg-lijn" />}
        {tags.map((t) => (
          <Link key={t} href={href(sp, { tag: sp.tag === t ? undefined : t })} className={`chip ${sp.tag === t ? "bg-nacht text-white" : "hover:bg-lijn"}`}>{t}</Link>
        ))}
      </div>

      <form action={createClientAction} className="card grid grid-cols-2 gap-2 p-2 md:grid-cols-[2fr_2fr_2fr_auto]">
        <input name="name" required placeholder="Bedrijfsnaam" className="input" />
        <input name="contactPerson" placeholder="Contactpersoon" className="input" />
        <input name="contactEmail" type="email" placeholder="E-mail contactpersoon" className="input" />
        <button className="btn-primary">Klant toevoegen</button>
      </form>

      <div className="grid gap-3 md:grid-cols-2">
        {rows.length === 0 && <p className="text-sm text-steen">Geen klanten gevonden.</p>}
        {rows.map(({ client, openTasks, activeProjects, websiteCount, primaryContact }) => (
          <Link key={client.id} href={`/klanten/${client.id}`} className="card p-4 hover:border-nacht">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">{client.name}</p>
                {(primaryContact || client.city) && (
                  <p className="text-sm text-steen">{[primaryContact, client.city].filter(Boolean).join(" · ")}</p>
                )}
              </div>
              <span className="chip">{CLIENT_STATUS[client.status]}</span>
            </div>
            <p className="mt-3 text-xs text-steen">
              {activeProjects} {activeProjects === 1 ? "project" : "projecten"} · {openTasks} open {openTasks === 1 ? "taak" : "taken"}
              {websiteCount > 0 ? ` · ${websiteCount} ${websiteCount === 1 ? "website" : "websites"}` : ""}
            </p>
            {client.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {client.tags.map((t) => (
                  <span key={t} className="chip">{t}</span>
                ))}
              </div>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
