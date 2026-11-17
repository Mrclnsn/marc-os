import Link from "next/link";
import { notFound } from "next/navigation";
import { AreaSelect, ClientSelect, Field, NoteTypeSelect, ProjectSelect } from "@/components/forms";
import { getNote } from "@/lib/data";
import { getOptions } from "@/lib/options";
import { deleteNoteAction, updateNoteAction } from "../../../actions";

export default async function NotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [row, options] = await Promise.all([getNote(id), getOptions()]);
  if (!row) notFound();
  const { note } = row;
  const back = note.clientId ? `/klanten/${note.clientId}` : note.projectId ? `/projecten/${note.projectId}` : "/notities";

  return (
    <div className="space-y-5">
      <Link href={back} className="text-sm text-muted">← Terug</Link>
      <form action={updateNoteAction.bind(null, id)} className="space-y-4">
        <input name="title" defaultValue={note.title} required className="input w-full text-lg font-medium" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Field label="Soort"><NoteTypeSelect value={note.type} /></Field>
          <Field label="Gebied"><AreaSelect value={note.area} allowEmpty /></Field>
          <Field label="Klant"><ClientSelect clients={options.clients} value={note.clientId} /></Field>
          <Field label="Project"><ProjectSelect projects={options.projects} value={note.projectId} /></Field>
          <Field label="Datum"><input type="date" name="noteDate" defaultValue={note.noteDate ?? ""} className="input w-full" /></Field>
        </div>
        <textarea name="body" defaultValue={note.body ?? ""} rows={18} className="input w-full font-mono text-sm leading-relaxed" placeholder="Schrijf hier..." />
        <button className="btn-primary">Opslaan</button>
      </form>
      <form action={deleteNoteAction.bind(null, id, back)}>
        <button className="btn-ghost text-xs text-danger">Notitie verwijderen</button>
      </form>
    </div>
  );
}
