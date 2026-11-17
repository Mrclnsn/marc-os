import Link from "next/link";
import { notFound } from "next/navigation";
import { AreaSelect, ClientSelect, Field, PrioritySelect, ProjectSelect, RecurrenceSelect, TaskStatusSelect } from "@/components/forms";
import { getTask } from "@/lib/data";
import { getOptions } from "@/lib/options";
import { deleteTaskAction, updateTaskAction } from "../../../actions";

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [task, options] = await Promise.all([getTask(id), getOptions()]);
  if (!task) notFound();

  return (
    <div className="space-y-5">
      <Link href="/taken" className="text-sm text-muted">← Taken</Link>
      <form action={updateTaskAction.bind(null, id)} className="space-y-4">
        <input name="title" defaultValue={task.title} className="input w-full text-lg font-medium" required />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Field label="Status"><TaskStatusSelect value={task.status} /></Field>
          <Field label="Gebied"><AreaSelect value={task.area} /></Field>
          <Field label="Prioriteit"><PrioritySelect value={task.priority} /></Field>
          <Field label="Klant"><ClientSelect clients={options.clients} value={task.clientId} /></Field>
          <Field label="Project"><ProjectSelect projects={options.projects} value={task.projectId} /></Field>
          <Field label="Herhaling"><RecurrenceSelect value={task.recurrence} /></Field>
          <Field label="Plannen op"><input type="date" name="planDate" defaultValue={task.planDate ?? ""} className="input w-full" /></Field>
          <Field label="Deadline"><input type="date" name="dueDate" defaultValue={task.dueDate ?? ""} className="input w-full" /></Field>
          <Field label="Inschatting (min)"><input type="number" name="estimateMin" min={5} step={5} defaultValue={task.estimateMin ?? ""} className="input w-full" /></Field>
        </div>
        <Field label="Notities">
          <textarea name="notes" defaultValue={task.notes ?? ""} rows={6} className="input w-full" />
        </Field>
        <input type="hidden" name="back" value="/taken" />
        <div className="flex gap-2">
          <button className="btn-primary">Opslaan</button>
          <Link href="/taken" className="btn">Annuleren</Link>
        </div>
      </form>
      <form action={deleteTaskAction.bind(null, id, "/taken")}>
        <button className="btn-ghost text-xs text-danger">Taak verwijderen</button>
      </form>
    </div>
  );
}
