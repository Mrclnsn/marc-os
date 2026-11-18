import Link from "next/link";
import { notFound } from "next/navigation";
import { SectionTitle } from "@/components/brand";
import { BacklinksPanel, MentionsPanel } from "@/components/brain-parts";
import { AreaSelect, ClientSelect, Field, NoteTypeSelect, ProjectSelect } from "@/components/forms";
import { GraphView } from "@/components/graph-view";
import { LinkEditor } from "@/components/link-editor";
import { Markdown } from "@/components/markdown";
import { getBacklinks, getGraph, getNote, getOutgoing, getUnlinkedMentions, linkSuggestions, resolveLinksIn } from "@/lib/data";
import { AREAS, NOTE_TYPES } from "@/lib/labels";
import { formatDate } from "@/lib/dates";
import { getOptions } from "@/lib/options";
import { deleteNoteAction, updateNoteAction } from "../../../actions";

export default async function NotePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ bewerken?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const row = await getNote(id);
  if (!row) notFound();
  const { note } = row;
  const editing = sp.bewerken !== undefined || !note.body?.trim();
  const back = note.type === "inbox" ? "/inbox" : note.clientId ? `/klanten/${note.clientId}` : note.projectId ? `/projecten/${note.projectId}` : "/notities";

  if (editing) {
    const [options, suggestions] = await Promise.all([getOptions(), linkSuggestions()]);
    return (
      <div className="space-y-5">
        <Link href={note.body?.trim() ? `/notities/${id}` : back} className="mb-6 inline-block text-sm text-steen hover:text-nacht">← {note.body?.trim() ? "Annuleren" : "Terug"}</Link>
        <form action={updateNoteAction.bind(null, id)} className="space-y-4">
          <input type="hidden" name="view" value="1" />
          <input name="title" defaultValue={note.title} required className="input w-full text-lg font-medium" />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Field label="Soort"><NoteTypeSelect value={note.type} /></Field>
            <Field label="Gebied"><AreaSelect value={note.area} allowEmpty /></Field>
            <Field label="Klant"><ClientSelect clients={options.clients} value={note.clientId} /></Field>
            <Field label="Project"><ProjectSelect projects={options.projects} value={note.projectId} /></Field>
            <Field label="Datum"><input type="date" name="noteDate" defaultValue={note.noteDate ?? ""} className="input w-full" /></Field>
          </div>
          <LinkEditor defaultValue={note.body} suggestions={suggestions} />
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn-primary">Opslaan</button>
            <span className="text-xs text-steen">Markdown. [[Naam]] linkt naar een notitie, klant, project of bron; [[klant:Naam]] als de naam vaker voorkomt. Cmd+Enter slaat op.</span>
          </div>
        </form>
        <form action={deleteNoteAction.bind(null, id, back)}>
          <button className="btn-ghost text-xs text-nacht">Notitie verwijderen</button>
        </form>
      </div>
    );
  }

  const [resolved, backlinks, outgoing, mentions, graph] = await Promise.all([
    resolveLinksIn(note.body),
    getBacklinks("note", id),
    getOutgoing("note", id),
    getUnlinkedMentions("note", id),
    getGraph(),
  ]);
  const hasLocal = graph.edges.some((e) => e.source === `note:${id}` || e.target === `note:${id}`);

  return (
    <div className="space-y-8">
      <Link href={back} className="inline-block text-sm text-steen hover:text-nacht">← Terug</Link>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
        <article className="min-w-0 space-y-5">
          <header className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h1 className="text-3xl font-bold leading-tight tracking-tight text-nacht md:text-4xl">{note.title}</h1>
              <Link href={`/notities/${id}?bewerken`} className="btn">Bewerken</Link>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-steen">
              <span className="chip">{NOTE_TYPES[note.type]}</span>
              {note.area && <span className="chip">{AREAS[note.area]}</span>}
              {note.clientId && row.clientName && <Link href={`/klanten/${note.clientId}`} className="chip hover:bg-lijn">{row.clientName}</Link>}
              {note.projectId && row.projectName && <Link href={`/projecten/${note.projectId}`} className="chip hover:bg-lijn">◫ {row.projectName}</Link>}
              <span>{formatDate(note.noteDate ?? note.createdAt.toISOString().slice(0, 10))}</span>
            </div>
            <div className="rule" />
          </header>
          <Markdown text={note.body} links={resolved} />
        </article>

        <aside className="space-y-8">
          <BacklinksPanel backlinks={backlinks} />
          {outgoing.length > 0 && (
            <section>
              <SectionTitle aside={<span className="text-xs text-steen">{outgoing.length}</span>}>Links vanuit hier</SectionTitle>
              <ul className="space-y-1 text-sm">
                {outgoing.map((o) => (
                  <li key={`${o.kind}:${o.target}`}>
                    {o.resolved ? (
                      <Link href={o.resolved.href} className="text-nacht hover:underline">{o.resolved.title}</Link>
                    ) : (
                      <Link href={`/notities/nieuw?titel=${encodeURIComponent(o.label)}`} className="text-steen underline decoration-dashed hover:text-nacht">{o.label} (maken)</Link>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <MentionsPanel mentions={mentions} />
          {hasLocal && (
            <section>
              <SectionTitle>Lokale grafiek</SectionTitle>
              <GraphView nodes={graph.nodes} edges={graph.edges} focusId={`note:${id}`} depth={2} height={280} controls={false} />
              <Link href="/notities/grafiek" className="mt-2 inline-block text-xs text-steen hover:text-nacht">Hele grafiek →</Link>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
