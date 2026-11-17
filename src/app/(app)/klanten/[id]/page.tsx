import { PageHeader, SectionTitle } from "@/components/brand";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClientStatusSelect, Field, NoteTypeSelect } from "@/components/forms";
import { NoteList } from "@/components/note-list";
import { QuickAddTask } from "@/components/quick-add";
import { TaskList } from "@/components/task-row";
import { getClient, listNotes, listProjects, listTasks } from "@/lib/data";
import { addDaysIso, formatShort, today } from "@/lib/dates";
import { CLIENT_STATUS, PROJECT_STATUS } from "@/lib/labels";
import { getOptions } from "@/lib/options";
import { createNoteAction, createProjectAction, deleteClientAction, updateClientAction } from "../../../actions";

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = await getClient(id);
  if (!client) notFound();

  const [tasks, projectsRows, notesRows, options] = await Promise.all([
    listTasks({ clientId: id, view: "open" }),
    listProjects({ clientId: id, includeClosed: true }),
    listNotes({ clientId: id, excludeInbox: true }),
    getOptions(),
  ]);
  const t = today();
  const clientProjects = options.projects.filter((p) => p.clientId === id);

  return (
    <div className="space-y-10">
      <Link href="/klanten" className="mb-6 inline-block text-sm text-steen hover:text-nacht">← Klanten</Link>
      <PageHeader
        eyebrow={[client.contactPerson, client.email, client.phone].filter(Boolean).join(" · ") || "Nog geen contactgegevens"}
        title={client.name}
      >
        <span className="chip">{CLIENT_STATUS[client.status]}</span>
      </PageHeader>

      {client.info && (
        <section className="card p-4">
          <SectionTitle>Informatie</SectionTitle>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{client.info}</p>
        </section>
      )}

      <section className="space-y-2">
        <SectionTitle>Projecten</SectionTitle>
        <div className="card divide-y divide-lijn">
          {projectsRows.length === 0 && <p className="px-3 py-3 text-sm text-steen">Nog geen projecten.</p>}
          {projectsRows.map(({ project, openTasks }) => (
            <Link key={project.id} href={`/projecten/${project.id}`} className="flex items-center justify-between px-3 py-2 text-sm hover:bg-parel">
              <span className={project.status === "done" || project.status === "archived" ? "text-steen line-through" : ""}>{project.name}</span>
              <span className="text-xs text-steen">
                {PROJECT_STATUS[project.status]}
                {project.dueDate ? ` · ${formatShort(project.dueDate)}` : ""} · {openTasks} open
              </span>
            </Link>
          ))}
        </div>
        <form action={createProjectAction} className="flex gap-2">
          <input type="hidden" name="clientId" value={id} />
          <input type="hidden" name="area" value="zakelijk" />
          <input name="name" required placeholder="Nieuw project voor deze klant..." className="input flex-1" />
          <button className="btn">Toevoegen</button>
        </form>
      </section>

      <section className="space-y-2">
        <SectionTitle>Taken</SectionTitle>
        <div className="card"><TaskList tasks={tasks} today={t} tomorrow={addDaysIso(t, 1)} showClient={false} empty="Geen open taken." /></div>
        <QuickAddTask clients={options.clients} projects={clientProjects} defaults={{ clientId: id, area: "zakelijk" }} placeholder="Taak voor deze klant..." />
      </section>

      <section className="space-y-2">
        <SectionTitle>Dossier</SectionTitle>
        <div className="card"><NoteList rows={notesRows} showClient={false} empty="Nog geen notities voor deze klant." /></div>
        <form action={createNoteAction} className="flex flex-wrap gap-2">
          <input type="hidden" name="clientId" value={id} />
          <input type="hidden" name="area" value="zakelijk" />
          <input type="hidden" name="open" value="1" />
          <NoteTypeSelect withoutInbox />
          <input name="title" required placeholder="Gespreksverslag, afspraak, info..." className="input flex-1" />
          <button className="btn">Toevoegen</button>
        </form>
      </section>

      <details className="card p-4">
        <summary className="cursor-pointer text-sm font-medium">Klantgegevens bewerken</summary>
        <form action={updateClientAction.bind(null, id)} className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bedrijfsnaam"><input name="name" defaultValue={client.name} required className="input w-full" /></Field>
            <Field label="Contactpersoon"><input name="contactPerson" defaultValue={client.contactPerson ?? ""} className="input w-full" /></Field>
            <Field label="E-mail"><input name="email" type="email" defaultValue={client.email ?? ""} className="input w-full" /></Field>
            <Field label="Telefoon"><input name="phone" defaultValue={client.phone ?? ""} className="input w-full" /></Field>
            <Field label="Status"><ClientStatusSelect value={client.status} /></Field>
          </div>
          <Field label="Vaste informatie (pakket, toegang, afspraken, adres...)">
            <textarea name="info" rows={6} defaultValue={client.info ?? ""} className="input w-full" />
          </Field>
          <button className="btn-primary">Opslaan</button>
        </form>
        <form action={deleteClientAction.bind(null, id)} className="mt-3">
          <button className="btn-ghost text-xs text-nacht">Klant verwijderen (taken en notities blijven bestaan)</button>
        </form>
      </details>
    </div>
  );
}
