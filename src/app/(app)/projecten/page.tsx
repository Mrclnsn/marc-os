import Link from "next/link";
import { AreaSelect, ClientSelect } from "@/components/forms";
import { listProjects } from "@/lib/data";
import { formatShort } from "@/lib/dates";
import { PROJECT_STATUS } from "@/lib/labels";
import { getOptions } from "@/lib/options";
import { createProjectAction } from "../../actions";

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ alles?: string }> }) {
  const { alles } = await searchParams;
  const [rows, options] = await Promise.all([listProjects({ includeClosed: !!alles }), getOptions()]);

  const groups = [
    { title: "Klanten", items: rows.filter((r) => r.project.area === "zakelijk" && r.project.clientId) },
    { title: "Bedrijf algemeen", items: rows.filter((r) => r.project.area === "zakelijk" && !r.project.clientId) },
    { title: "Privé", items: rows.filter((r) => r.project.area === "prive") },
  ];

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <h1 className="h1">Projecten</h1>
        <Link href={alles ? "/projecten" : "/projecten?alles=1"} className="text-sm text-muted">
          {alles ? "Alleen lopende" : "Toon ook afgerond"}
        </Link>
      </header>

      <form action={createProjectAction} className="card grid grid-cols-2 gap-2 p-2 md:grid-cols-4">
        <input name="name" required placeholder="Nieuw project..." className="input col-span-2 md:col-span-1" />
        <AreaSelect />
        <ClientSelect clients={options.clients} />
        <button className="btn-primary">Aanmaken</button>
      </form>

      {groups.map((g) => (
        <section key={g.title} className="space-y-2">
          <h2 className="h2">{g.title}</h2>
          {g.items.length === 0 ? (
            <p className="text-sm text-muted">Geen projecten.</p>
          ) : (
            <div className="card divide-y divide-line">
              {g.items.map(({ project, clientName, openTasks, doneTasks }) => {
                const total = openTasks + doneTasks;
                return (
                  <Link key={project.id} href={`/projecten/${project.id}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-bg">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{project.name}</p>
                      <p className="text-xs text-muted">
                        {[clientName, PROJECT_STATUS[project.status], project.dueDate && `deadline ${formatShort(project.dueDate)}`].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    {total > 0 && (
                      <div className="w-24 text-right">
                        <div className="h-1.5 rounded bg-line">
                          <div className="h-1.5 rounded bg-accent" style={{ width: `${(doneTasks / total) * 100}%` }} />
                        </div>
                        <p className="mt-1 text-xs text-muted">{openTasks} open</p>
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
