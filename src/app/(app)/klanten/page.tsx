import Link from "next/link";
import { listClients } from "@/lib/data";
import { CLIENT_STATUS } from "@/lib/labels";
import { createClientAction } from "../../actions";

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ alles?: string }> }) {
  const { alles } = await searchParams;
  const rows = await listClients({ includePast: !!alles });

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <h1 className="h1">Klanten</h1>
        <Link href={alles ? "/klanten" : "/klanten?alles=1"} className="text-sm text-muted">
          {alles ? "Verberg oud-klanten" : "Toon oud-klanten"}
        </Link>
      </header>

      <form action={createClientAction} className="card grid grid-cols-2 gap-2 p-2 md:grid-cols-3">
        <input name="name" required placeholder="Bedrijfsnaam" className="input" />
        <input name="contactPerson" placeholder="Contactpersoon" className="input" />
        <button className="btn-primary col-span-2 md:col-span-1">Klant toevoegen</button>
      </form>

      <div className="grid gap-3 md:grid-cols-2">
        {rows.map(({ client, openTasks, activeProjects }) => (
          <Link key={client.id} href={`/klanten/${client.id}`} className="card p-4 hover:border-accent">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium">{client.name}</p>
                {client.contactPerson && <p className="text-sm text-muted">{client.contactPerson}</p>}
              </div>
              <span className="chip">{CLIENT_STATUS[client.status]}</span>
            </div>
            <p className="mt-3 text-xs text-muted">
              {activeProjects} {activeProjects === 1 ? "project" : "projecten"} · {openTasks} open {openTasks === 1 ? "taak" : "taken"}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
