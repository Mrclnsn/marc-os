"use client";

import Link from "next/link";
import { useOptimistic, useTransition } from "react";
import { planTaskAction, toggleTaskAction } from "@/app/actions";
import type { TaskWithRefs } from "@/lib/data";

type Props = {
  task: TaskWithRefs;
  today: string;
  tomorrow: string;
  showClient?: boolean;
  showProject?: boolean;
};

const nlDate = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short" });

function label(iso: string, today: string, tomorrow: string) {
  if (iso === today) return "Vandaag";
  if (iso === tomorrow) return "Morgen";
  return nlDate.format(new Date(`${iso}T12:00:00`));
}

export function TaskRow({ task, today, tomorrow, showClient = true, showProject = true }: Props) {
  const [pending, start] = useTransition();
  const [done, setDone] = useOptimistic(task.status === "done");

  const when = task.planDate ?? task.dueDate;
  const overdue = !done && when != null && when < today;
  const deadlineSoon = !done && task.dueDate != null && task.dueDate <= tomorrow;

  return (
    <li className={`group flex items-start gap-3 px-3 py-2 ${pending ? "opacity-60" : ""}`}>
      <button
        aria-label={done ? "Heropenen" : "Afronden"}
        onClick={() =>
          start(async () => {
            setDone(!done);
            await toggleTaskAction(task.id, !done);
          })
        }
        className={`mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 grid place-items-center text-[11px] ${
          done ? "border-accent bg-accent text-white" : task.priority === 1 ? "border-danger" : "border-line hover:border-accent"
        }`}
      >
        {done ? "✓" : ""}
      </button>
      <div className="min-w-0 flex-1">
        <Link href={`/taken/${task.id}`} className={`block text-sm leading-snug ${done ? "line-through text-muted" : ""}`}>
          {task.title}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${task.area === "prive" ? "bg-emerald-500" : "bg-accent"}`} title={task.area === "prive" ? "Privé" : "Zakelijk"} />
          {showClient && task.clientName && <span className="chip">{task.clientName}</span>}
          {showProject && task.projectName && <span className="chip">◫ {task.projectName}</span>}
          {when && (
            <span className={`text-xs ${overdue ? "text-danger font-medium" : "text-muted"}`}>{label(when, today, tomorrow)}</span>
          )}
          {task.dueDate && task.planDate && task.dueDate !== task.planDate && (
            <span className={`text-xs ${deadlineSoon ? "text-warn font-medium" : "text-muted"}`}>deadline {label(task.dueDate, today, tomorrow)}</span>
          )}
          {task.recurrence !== "none" && <span className="text-xs text-muted" title="Terugkerend">↻</span>}
          {task.status === "waiting" && <span className="chip">wacht op</span>}
          {task.estimateMin ? <span className="text-xs text-muted">{task.estimateMin} min</span> : null}
        </div>
      </div>
      {!done && (
        <div className="flex shrink-0 gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100">
          {when !== today && (
            <button className="btn-ghost text-xs" onClick={() => start(() => planTaskAction(task.id, today))}>
              Vandaag
            </button>
          )}
          {when !== tomorrow && (
            <button className="btn-ghost text-xs" onClick={() => start(() => planTaskAction(task.id, tomorrow))}>
              Morgen
            </button>
          )}
        </div>
      )}
    </li>
  );
}

export function TaskList({ tasks, today, tomorrow, empty, showClient, showProject }: { tasks: TaskWithRefs[]; today: string; tomorrow: string; empty?: string; showClient?: boolean; showProject?: boolean }) {
  if (!tasks.length) return <p className="px-3 py-3 text-sm text-muted">{empty ?? "Niets hier."}</p>;
  return (
    <ul className="divide-y divide-line">
      {tasks.map((t) => (
        <TaskRow key={t.id} task={t} today={today} tomorrow={tomorrow} showClient={showClient} showProject={showProject} />
      ))}
    </ul>
  );
}
