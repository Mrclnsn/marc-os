import { PageHeader, SectionTitle } from "@/components/brand";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AreaSelect, ClientSelect, Field, ProjectStatusSelect } from "@/components/forms";
import { NoteList } from "@/components/note-list";
import { BacklinksPanel } from "@/components/brain-parts";
import { QuickAddTask } from "@/components/quick-add";
import { TaskList } from "@/components/task-row";
import { getBacklinks, getProject, listNotes, listTasks, projectHours, recentDescriptions } from "@/lib/data";
import { BudgetLine, ManualTimeForm, RecentEntries } from "@/components/time-parts";
import { StartTimerButton } from "@/components/timer";
import { formatHours } from "@/lib/duration";
import { addDaysIso, today } from "@/lib/dates";
import { getOptions } from "@/lib/options";
import { getModules } from "@/lib/settings";
import { createNoteAction, deleteProjectAction, updateProjectAction } from "../../../actions";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await getProject(id);
  if (!row) notFound();
  const { project, clientName } = row;
  const modules = await getModules();
  const [open, done, notesRows, options, hours, descriptions, backlinks] = await Promise.all([
    listTasks({ projectId: id, view: "open" }),
    listTasks({ projectId: id, view: "done", limit: 20 }),
    listNotes({ projectId: id, excludeInbox: true }),
    getOptions(),
    projectHours(id),
    recentDescriptions(),
    getBacklinks("project", id),
  ]);
  const t = today();

  return (
    <div className="space-y-10">
      <Link href="/projecten" className="mb-6 inline-block text-sm text-steen hover:text-nacht">← Projecten</Link>
      <PageHeader
        eyebrow={clientName && project.clientId ? <Link href={`/klanten/${project.clientId}`} className="hover:text-nacht">{clientName}</Link> : project.area === "prive" ? "Privé" : "Bedrijf algemeen"}
        title={project.name}
      >
        {modules.uren && <StartTimerButton projectId={id} label="▶ Start timer" className="btn" />}
      </PageHeader>

      <section className="space-y-2">
        <SectionTitle>Open taken</SectionTitle>
        <div className="card"><TaskList tasks={open} today={t} tomorrow={addDaysIso(t, 1)} showProject={false} empty="Geen open taken." /></div>
        <QuickAddTask clients={options.clients} projects={options.projects} defaults={{ projectId: id, clientId: project.clientId, area: project.area }} />
      </section>

      {modules.uren && (
      <section className="space-y-3">
        <SectionTitle>Uren</SectionTitle>
        <div className="flex flex-wrap gap-6 text-sm">
          <p><span className="text-steen">Totaal </span><span className="font-bold tabular-nums text-nacht">{formatHours(hours.minutes)}</span></p>
          <p><span className="text-steen">Declarabel </span><span className="font-bold tabular-nums text-nacht">{formatHours(hours.billableMinutes)}</span></p>
        </div>
        {modules.afspraken && hours.budgets.map((b) => <BudgetLine key={b.agreementId} b={b} />)}
        <RecentEntries entries={hours.recent} />
        <ManualTimeForm clients={options.clients} projects={options.projects} descriptions={descriptions} today={t} clientId={project.clientId ?? undefined} projectId={id} />
      </section>
      )}

      <section className="space-y-2">
        <SectionTitle>Notities</SectionTitle>
        <div className="card"><NoteList rows={notesRows} showClient={false} /></div>
        <form action={createNoteAction} className="flex gap-2">
          <input type="hidden" name="projectId" value={id} />
          <input type="hidden" name="clientId" value={project.clientId ?? ""} />
          <input type="hidden" name="area" value={project.area} />
          <input type="hidden" name="type" value="note" />
          <input type="hidden" name="open" value="1" />
          <input name="title" required placeholder="Nieuwe notitie..." className="input flex-1" />
          <button className="btn">Toevoegen</button>
        </form>
      </section>

      {backlinks.length > 0 && <BacklinksPanel backlinks={backlinks} title="Genoemd in" />}

      <details className="card p-4">
        <summary className="cursor-pointer text-sm font-medium">Projectgegevens</summary>
        <form action={updateProjectAction.bind(null, id)} className="mt-4 space-y-3">
          <Field label="Naam"><input name="name" defaultValue={project.name} required className="input w-full" /></Field>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Field label="Status"><ProjectStatusSelect value={project.status} /></Field>
            <Field label="Gebied"><AreaSelect value={project.area} /></Field>
            <Field label="Klant"><ClientSelect clients={options.clients} value={project.clientId} /></Field>
            <Field label="Start"><input type="date" name="startDate" defaultValue={project.startDate ?? ""} className="input w-full" /></Field>
            <Field label="Deadline"><input type="date" name="dueDate" defaultValue={project.dueDate ?? ""} className="input w-full" /></Field>
          </div>
          <Field label="Omschrijving / scope"><textarea name="description" rows={5} defaultValue={project.description ?? ""} className="input w-full" /></Field>
          <button className="btn-primary">Opslaan</button>
        </form>
        <form action={deleteProjectAction.bind(null, id)} className="mt-3">
          <button className="btn-ghost text-xs text-nacht">Project verwijderen (taken blijven bestaan)</button>
        </form>
      </details>

      {done.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm text-steen">Afgeronde taken ({done.length})</summary>
          <div className="card mt-2"><TaskList tasks={done} today={t} tomorrow={addDaysIso(t, 1)} showProject={false} /></div>
        </details>
      )}
    </div>
  );
}
