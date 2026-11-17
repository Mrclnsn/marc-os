import { PageHeader, SectionTitle } from "@/components/brand";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClientAgreements } from "@/components/agreement-parts";
import { ClientDetails, ClientEditForm, ContactList, DocumentList, WebsiteList } from "@/components/client-parts";
import { NoteTypeSelect } from "@/components/forms";
import { NoteList } from "@/components/note-list";
import { QuickAddTask } from "@/components/quick-add";
import { TaskList } from "@/components/task-row";
import { clientHours, getClientDossierFull, listLeads, listNotes, listProjects, listTasks, recentDescriptions } from "@/lib/data";
import { LeadLine } from "@/components/pipeline-parts";
import { BillingQueue, ManualTimeForm, RecentEntries, StartTimerForm } from "@/components/time-parts";
import { formatDuration, formatHours } from "@/lib/duration";
import { formatEuro } from "@/lib/money";
import { addDaysIso, formatShort, today } from "@/lib/dates";
import { CLIENT_STATUS, PROJECT_STATUS } from "@/lib/labels";
import { getOptions } from "@/lib/options";
import { createLeadAction, createNoteAction, createProjectAction, deleteClientAction } from "../../../actions";

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dossier = await getClientDossierFull(id);
  if (!dossier) notFound();
  const { client, contacts, websites, documents, agreements, installments, mrrCents } = dossier;
  const primary = contacts.find((c) => c.isPrimary) ?? contacts[0];

  const [tasks, projectsRows, notesRows, options, hours, descriptions, leadRows] = await Promise.all([
    listTasks({ clientId: id, view: "open" }),
    listProjects({ clientId: id, includeClosed: true }),
    listNotes({ clientId: id, excludeInbox: true }),
    getOptions(),
    clientHours(id),
    recentDescriptions(),
    listLeads({ clientId: id }),
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
          budgets={hours.budgets}
        />
      </section>

      <section className="space-y-2">
        <SectionTitle aside={<Link href="/pipeline" className="text-xs text-steen hover:text-nacht">Pipeline</Link>}>Leads en offertes</SectionTitle>
        {leadRows.length > 0 ? (
          <div className="card"><ul className="divide-y divide-lijn">{leadRows.map((l) => <LeadLine key={l.id} l={l} />)}</ul></div>
        ) : (
          <p className="text-sm text-steen">Nog geen leads of offertes.</p>
        )}
        <form action={createLeadAction} className="flex gap-2">
          <input type="hidden" name="clientId" value={id} />
          <input name="title" required placeholder="Nieuwe kans bij deze klant, bijv. Extra beheer..." className="input flex-1" />
          <button className="btn">Lead toevoegen</button>
        </form>
      </section>

      <section className="space-y-3">
        <SectionTitle aside={<Link href={`/uren?klant=${id}`} className="text-xs text-steen hover:text-nacht">Alle uren</Link>}>Uren</SectionTitle>
        <div className="flex flex-wrap gap-6 text-sm">
          <p><span className="text-steen">Dit jaar </span><span className="font-bold tabular-nums text-nacht">{formatHours(hours.rate?.minutes ?? 0)}</span></p>
          <p><span className="text-steen">Declarabel </span><span className="font-bold tabular-nums text-nacht">{formatHours(hours.rate?.billableMinutes ?? 0)}</span></p>
          <p>
            <span className="text-steen">Effectief uurtarief </span>
            <span className="font-bold tabular-nums text-nacht">{hours.rate?.rateCents != null ? formatEuro(hours.rate.rateCents) : "–"}</span>
            {hours.rate?.rateCents != null && <span className="text-steen"> ({formatEuro(hours.rate.revenueCents)} omzet)</span>}
          </p>
        </div>
        {hours.queue.length > 0 && (
          <div className="card">
            <p className="label px-3 pt-3">Te factureren uren ({formatDuration(hours.queue.reduce((s, g) => s + g.minutes, 0))})</p>
            <BillingQueue groups={hours.queue} showClient={false} />
          </div>
        )}
        <RecentEntries entries={hours.recent} />
        <StartTimerForm clients={options.clients} projects={clientProjects} descriptions={descriptions} clientId={id} />
        <ManualTimeForm clients={options.clients} projects={clientProjects} descriptions={descriptions} today={t} clientId={id} />
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
