import { PageHeader, SectionTitle } from "@/components/brand";
import Link from "next/link";
import { TaskList } from "@/components/task-row";
import { QuickAddTask } from "@/components/quick-add";
import { listTasks, type TaskFilter, type TaskView } from "@/lib/data";
import { addDaysIso, today } from "@/lib/dates";
import { getOptions } from "@/lib/options";

const VIEWS: { key: TaskView; label: string }[] = [
  { key: "open", label: "Alle open" },
  { key: "today", label: "Vandaag" },
  { key: "upcoming", label: "Komende 14 dagen" },
  { key: "someday", label: "Zonder datum" },
  { key: "done", label: "Afgerond" },
];

const SCOPES = [
  { key: "", label: "Alles" },
  { key: "klanten", label: "Klantwerk" },
  { key: "algemeen", label: "Bedrijf algemeen" },
  { key: "prive", label: "Privé" },
];

type SP = { weergave?: string; scope?: string; klant?: string; zoek?: string };

export default async function TasksPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const view = (VIEWS.find((v) => v.key === sp.weergave)?.key ?? "open") as TaskView;
  const scope = sp.scope ?? "";

  const filter: TaskFilter = { view, days: 14, search: sp.zoek || undefined };
  if (scope === "prive") filter.area = "prive";
  if (scope === "algemeen") filter.general = true;
  if (scope === "klanten") filter.area = "zakelijk";
  if (sp.klant) filter.clientId = sp.klant;

  const [rows, options] = await Promise.all([listTasks(filter), getOptions()]);
  const tasks = scope === "klanten" && !sp.klant ? rows.filter((r) => r.clientId) : rows;
  const t = today();

  const href = (patch: Partial<SP>) => {
    const p = new URLSearchParams();
    const merged = { weergave: view, scope, klant: sp.klant, zoek: sp.zoek, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/taken?${p}`;
  };

  // Groeperen per klant als je naar klantwerk kijkt
  const groups = new Map<string, typeof tasks>();
  if (scope === "klanten" && !sp.klant) {
    for (const task of tasks) {
      const k = task.clientName ?? "Zonder klant";
      groups.set(k, [...(groups.get(k) ?? []), task]);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Zakelijk en privé" title="Taken">
        <div className="flex flex-wrap gap-4">
          {VIEWS.map((v) => (
            <Link key={v.key} href={href({ weergave: v.key })} className={view === v.key ? "tab-active" : "tab"}>
              {v.label}
            </Link>
          ))}
        </div>
      </PageHeader>
      <div className="flex flex-wrap items-center gap-1">
        {SCOPES.map((s) => (
          <Link key={s.key} href={href({ scope: s.key, klant: undefined })} className={`rounded-md border px-2.5 py-1 text-xs ${scope === s.key && !sp.klant ? "border-nacht text-nacht" : "border-lijn text-steen hover:text-nacht"}`}>
            {s.label}
          </Link>
        ))}
        <form className="ml-auto flex gap-1" action="/taken">
          <input type="hidden" name="weergave" value={view} />
          <select name="klant" defaultValue={sp.klant ?? ""} className="input py-1 text-xs">
            <option value="">Alle klanten</option>
            {options.clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <input name="zoek" defaultValue={sp.zoek ?? ""} placeholder="Zoeken" className="input py-1 text-xs w-28" />
          <button className="btn py-1 text-xs">Filter</button>
        </form>
      </div>

      <QuickAddTask
        clients={options.clients}
        projects={options.projects}
        defaults={{ area: scope === "prive" ? "prive" : "zakelijk", clientId: sp.klant }}
      />

      {groups.size > 0 ? (
        [...groups.entries()].map(([name, list]) => (
          <section key={name} className="space-y-2">
            <SectionTitle>{name}</SectionTitle>
            <div className="card">
              <TaskList tasks={list} today={t} tomorrow={addDaysIso(t, 1)} showClient={false} />
            </div>
          </section>
        ))
      ) : (
        <div className="card">
          <TaskList tasks={tasks} today={t} tomorrow={addDaysIso(t, 1)} empty="Geen taken gevonden." />
        </div>
      )}
    </div>
  );
}
