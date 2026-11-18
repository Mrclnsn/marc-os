import { PageHeader } from "@/components/brand";
import { CaptureBar } from "@/components/quick-add";
import { AreaSelect, ClientSelect, NoteTypeSelect, ProjectSelect } from "@/components/forms";
import { listNotes } from "@/lib/data";
import { getOptions } from "@/lib/options";
import { today } from "@/lib/dates";
import { deleteNoteAction, inboxToNoteAction, inboxToSourceAction, inboxToTaskAction } from "../../actions";
import { firstUrl } from "@/lib/data";

export default async function InboxPage() {
  const [items, options] = await Promise.all([listNotes({ type: "inbox" }), getOptions()]);
  const t = today();

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Braindump" title="Inbox" />
      <p className="-mt-4 text-[15px] text-grafiet">Alles wat je snel hebt vastgelegd. Maak er een taak of notitie van, of gooi het weg.</p>
      <CaptureBar />

      {items.length === 0 && <p className="text-sm text-steen">Je inbox is leeg.</p>}

      <ul className="space-y-3">
        {items.map(({ note }) => (
          <li key={note.id} className="card p-3 space-y-3">
            <div>
              <p className="font-medium">{note.title}</p>
              {note.body && <p className="mt-1 whitespace-pre-wrap text-sm text-steen">{note.body}</p>}
            </div>

            <form action={inboxToTaskAction.bind(null, note.id)} className="grid grid-cols-2 gap-2 md:grid-cols-5">
              <AreaSelect />
              <ClientSelect clients={options.clients} />
              <ProjectSelect projects={options.projects} />
              <input type="date" name="planDate" defaultValue={t} className="input" />
              <button className="btn-primary">Maak taak</button>
            </form>

            <form action={inboxToNoteAction.bind(null, note.id)} className="grid grid-cols-2 gap-2 md:grid-cols-5">
              <NoteTypeSelect withoutInbox />
              <AreaSelect allowEmpty />
              <ClientSelect clients={options.clients} />
              <ProjectSelect projects={options.projects} />
              <button className="btn">Bewaar als notitie</button>
            </form>

            <div className="flex flex-wrap gap-2">
              <form action={inboxToSourceAction.bind(null, note.id)}>
                <button className="btn-ghost text-xs text-nacht">{firstUrl(`${note.title}\n${note.body ?? ""}`) ? "Bewaar als bron (link)" : "Bewaar als bron (idee)"}</button>
              </form>
              <form action={deleteNoteAction.bind(null, note.id, "/inbox")}>
                <button className="btn-ghost text-xs text-nacht">Weggooien</button>
              </form>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
