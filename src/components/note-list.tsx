import Link from "next/link";
import type { Note } from "@/db/schema";
import { NOTE_TYPES } from "@/lib/labels";
import { formatShort } from "@/lib/dates";

type Row = { note: Note; clientName: string | null; projectName: string | null };

export function NoteList({ rows, empty = "Nog geen notities.", showClient = true }: { rows: Row[]; empty?: string; showClient?: boolean }) {
  if (!rows.length) return <p className="px-3 py-3 text-sm text-steen">{empty}</p>;
  return (
    <ul className="divide-y divide-lijn">
      {rows.map(({ note, clientName, projectName }) => (
        <li key={note.id}>
          <Link href={`/notities/${note.id}`} className="flex items-start gap-3 px-3 py-2 hover:bg-parel">
            <span className="chip mt-0.5">{NOTE_TYPES[note.type]}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm">{note.title}</p>
              {note.body && <p className="truncate text-xs text-steen">{note.body.slice(0, 140)}</p>}
            </div>
            <div className="shrink-0 text-right text-xs text-steen">
              {showClient && clientName && <p>{clientName}</p>}
              {projectName && <p>◫ {projectName}</p>}
              <p>{formatShort(note.noteDate ?? note.createdAt.toISOString().slice(0, 10))}</p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
