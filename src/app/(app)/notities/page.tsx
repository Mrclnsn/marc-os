import { PageHeader } from "@/components/brand";
import Link from "next/link";
import { AreaSelect, ClientSelect, NoteTypeSelect } from "@/components/forms";
import { NoteList } from "@/components/note-list";
import { BrainTabs } from "@/components/brain-parts";
import { listNotes } from "@/lib/data";
import { NOTE_TYPES, type NoteType } from "@/lib/labels";
import { getOptions } from "@/lib/options";
import { createNoteAction } from "../../actions";

type SP = { type?: string; klant?: string; gebied?: string; zoek?: string };

export default async function NotesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const type = sp.type && sp.type in NOTE_TYPES ? (sp.type as NoteType) : undefined;
  const area = sp.gebied === "zakelijk" || sp.gebied === "prive" ? sp.gebied : undefined;
  const [rows, options] = await Promise.all([
    listNotes({ type, excludeInbox: !type, clientId: sp.klant || undefined, area, search: sp.zoek || undefined }),
    getOptions(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Second brain" title="Notities" />
      <BrainTabs active="notities" />

      <form action={createNoteAction} className="card grid grid-cols-2 gap-2 p-2 md:grid-cols-5">
        <input name="title" required placeholder="Nieuwe notitie..." className="input col-span-2" />
        <NoteTypeSelect withoutInbox />
        <AreaSelect allowEmpty />
        <ClientSelect clients={options.clients} />
        <input type="hidden" name="open" value="1" />
        <button className="btn-primary col-span-2 md:col-span-5">Aanmaken en openen</button>
      </form>

      <form className="flex flex-wrap gap-2" action="/notities">
        <select name="type" defaultValue={type ?? ""} className="input py-1 text-xs">
          <option value="">Alle soorten</option>
          {Object.entries(NOTE_TYPES).filter(([k]) => k !== "inbox").map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select name="gebied" defaultValue={area ?? ""} className="input py-1 text-xs">
          <option value="">Alle gebieden</option>
          <option value="zakelijk">Zakelijk</option>
          <option value="prive">Privé</option>
        </select>
        <select name="klant" defaultValue={sp.klant ?? ""} className="input py-1 text-xs">
          <option value="">Alle klanten</option>
          {options.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input name="zoek" defaultValue={sp.zoek ?? ""} placeholder="Filter op woord" className="input py-1 text-xs" />
        <button className="btn py-1 text-xs">Filter</button>
        {(type || area || sp.klant || sp.zoek) && <Link href="/notities" className="btn-ghost text-xs">Wissen</Link>}
        <Link href={`/notities/zoeken${sp.zoek ? `?q=${encodeURIComponent(sp.zoek)}` : ""}`} className="btn-ghost ml-auto text-xs">Slim zoeken →</Link>
      </form>

      <div className="card"><NoteList rows={rows} /></div>
    </div>
  );
}
