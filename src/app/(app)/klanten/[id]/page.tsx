import { PageHeader, SectionTitle } from "@/components/brand";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClientAgreements } from "@/components/agreement-parts";
import { ClientDetails, ClientEditForm, ContactList, DocumentList, WebsiteList } from "@/components/client-parts";
import { NoteTypeSelect } from "@/components/forms";
import { NoteList } from "@/components/note-list";
import { QuickAddTask } from "@/components/quick-add";
import { TaskList } from "@/components/task-row";
import { getClientDossierFull, listNotes, listProjects, listTasks } from "@/lib/data";
import { addDaysIso, formatShort, today } from "@/lib/dates";
import { CLIENT_STATUS, PROJECT_STATUS } from "@/lib/labels";
import { getOptions } from "@/lib/options";
import { createNoteAction, createProjectAction, deleteClientAction } from "../../../actions";

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dossier = await getClientDossierFull(id);
  if (!dossier) notFound();
  const { client, contacts, websites, documents, agreements, installments, mrrCents } = dossier;
  const primary = contacts.find((c) => c.isPrimary) ?? contacts[0];

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
        eyebrow={[client.legalForm, client.city, primary && `${primary.name}${primary.role ? ` (${primary.role})` : ""}`].filter(Boolean).join(" · ") || "Nog geen gegevens"}
        title={client.name}
      >
        {client.tags.map((tag) => (
          <Link key={tag} href={`/klanten?tag=${encodeURIComponent(tag)}`} className="chip hover:bg-lijn">{tag}</Link>
        ))}
        <span className="chip">{CLIENT_STATUS[client.status]}</span>
      </PageHeader>

      <section className="space-y-2">
        <SectionTitle>Gegevens</SectionTitle>
        <ClientDetails client={client} />
        <details className="card p-4">
          <summary className="cursor-pointer text-sm font-medium">Klantgegevens bewerken</summary>
          <ClientEditForm client={client} />
        </details>
      </section>

      <section>
        <SectionTitle>Contactpersonen</SectionTitle>
        <ContactList clientId={id} contacts={contacts} />
      </section>

      <section>
        <SectionTitle>Websites</SectionTitle>
        <WebsiteList clientId={id} sites={websites} />
      </section>

      <section>
        <SectionTitle>Afspraken en termijnen</SectionTitle>
        <ClientAgreements
          clientId={id}
          agreements={agreements}
          installments={installments}
          mrrCents={mrrCents}
          websites={websites.map((w) => ({ id: w.id, name: w.domain }))}
          projects={clientProjects}
        />
      </section>

      <section>
        <SectionTitle>Documenten</SectionTitle>
        <DocumentList clientId={id} documents={documents} />
      </section>

      {client.info && (
        <section>
          <SectionTitle>Vaste informatie</SectionTitle>
          <p className="card whitespace-pre-wrap p-4 text-sm leading-relaxed">{client.info}</p>
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
        <SectionTitle>Notities</SectionTitle>
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

      <form action={deleteClientAction.bind(null, id)} className="border-t border-lijn pt-4">
        <button className="btn-ghost text-xs">Klant verwijderen (contactpersonen, websites, documentlinks, afspraken en termijnen gaan mee; taken, projecten en notities blijven)</button>
      </form>
    </div>
  );
}
