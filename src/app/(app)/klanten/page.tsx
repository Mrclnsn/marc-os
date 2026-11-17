import { PageHeader } from "@/components/brand";
import Link from "next/link";
import { listClients } from "@/lib/data";
import { CLIENT_STATUS } from "@/lib/labels";
import { createClientAction } from "../../actions";

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ alles?: string }> }) {
  const { alles } = await searchParams;
  const rows = await listClients({ includePast: !!alles });

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Zakelijk" title="Klanten">
        <Link href={alles ? "/klanten" : "/klanten?alles=1"} className="tab">
          {alles ? "Verberg oud-klanten" : "Toon oud-klanten"}
        </Link>
      </PageHeader>

      <form action={createClientAction} className="card grid grid-cols-2 gap-2 p-2 md:grid-cols-3">
        <input name="name" required placeholder="Bedrijfsnaam" className="input" />
        <input name="contactPerson" placeholder="Contactpersoon" className="input" />
        <button className="btn-primary col-span-2 md:col-span-1">Klant toevoegen</button>
      </form>

      <div className="grid gap-3 md:grid-cols-2">
        {rows.map(({ client, openTasks, activeProjects }) => (
          <Link key={client.id} href={`/klanten/${client.id}`} className="card p-4 hover:border-nacht">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium">{client.name}</p>
                {client.contactPerson && <p className="text-sm text-steen">{client.contactPerson}</p>}
              </div>
              <span className="chip">{CLIENT_STATUS[client.status]}</span>
            </div>
            <p className="mt-3 text-xs text-steen">
              {activeProjects} {activeProjects === 1 ? "project" : "projecten"} · {openTasks} open {openTasks === 1 ? "taak" : "taken"}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
