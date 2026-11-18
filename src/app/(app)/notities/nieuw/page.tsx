import Link from "next/link";
import { PageHeader } from "@/components/brand";
import { AreaSelect, ClientSelect, Field, NoteTypeSelect, ProjectSelect } from "@/components/forms";
import { LinkEditor } from "@/components/link-editor";
import { linkSuggestions } from "@/lib/data";
import { getOptions } from "@/lib/options";
import { createNoteAction } from "../../../actions";

/** Nieuwe notitie, ook vanuit een [[link]] die nog nergens heen gaat (?titel=...). */
export default async function NewNotePage({ searchParams }: { searchParams: Promise<{ titel?: string; klant?: string; project?: string; tekst?: string }> }) {
  const sp = await searchParams;
  const [options, suggestions] = await Promise.all([getOptions(), linkSuggestions()]);
  return (
    <div className="space-y-5">
      <Link href="/notities" className="inline-block text-sm text-steen hover:text-nacht">← Notities</Link>
      <PageHeader eyebrow="Second brain" title="Nieuwe notitie" />
      <form action={createNoteAction} className="space-y-4">
        <input type="hidden" name="open" value="1" />
        <input name="title" defaultValue={sp.titel ?? ""} required autoFocus={!sp.titel} placeholder="Titel" className="input w-full text-lg font-medium" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="Soort"><NoteTypeSelect withoutInbox /></Field>
          <Field label="Gebied"><AreaSelect allowEmpty /></Field>
          <Field label="Klant"><ClientSelect clients={options.clients} value={sp.klant} /></Field>
          <Field label="Project"><ProjectSelect projects={options.projects} value={sp.project} /></Field>
        </div>
        <LinkEditor defaultValue={sp.tekst ?? ""} suggestions={suggestions} rows={14} />
        <button className="btn-primary">Aanmaken</button>
      </form>
    </div>
  );
}
