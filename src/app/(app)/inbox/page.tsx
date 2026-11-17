import { CaptureBar } from "@/components/quick-add";
import { AreaSelect, ClientSelect, NoteTypeSelect, ProjectSelect } from "@/components/forms";
import { listNotes } from "@/lib/data";
import { getOptions } from "@/lib/options";
import { today } from "@/lib/dates";
import { deleteNoteAction, inboxToNoteAction, inboxToTaskAction } from "../../actions";

export default async function InboxPage() {
  const [items, options] = await Promise.all([listNotes({ type: "inbox" }), getOptions()]);
  const t = today();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="h1">Inbox</h1>
        <p className="text-sm text-muted">Alles wat je snel hebt vastgelegd. Maak er een taak of notitie van, of gooi het weg.</p>
      </header>
      <CaptureBar />

      {items.length === 0 && <p className="text-sm text-muted">Je inbox is leeg.</p>}

      <ul className="space-y-3">
        {items.map(({ note }) => (
          <li key={note.id} className="card p-3 space-y-3">
            <div>
              <p className="font-medium">{note.title}</p>
              {note.body && <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{note.body}</p>}
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

            <form action={deleteNoteAction.bind(null, note.id, "/inbox")}>
              <button className="btn-ghost text-xs text-danger">Weggooien</button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
