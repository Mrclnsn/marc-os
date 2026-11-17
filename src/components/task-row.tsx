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
  const high = task.priority === 1 && !done;
  const meta = [showClient && task.clientName, showProject && task.projectName].filter(Boolean) as string[];

  return (
    <li className={`group relative flex items-start gap-4 px-4 py-3 transition-colors hover:bg-parel/70 ${pending ? "opacity-50" : ""}`}>
      {overdue && <span className="absolute inset-y-0 left-0 w-[3px] bg-nacht" title="Achterstallig" />}
      <button
        aria-label={done ? "Heropenen" : "Afronden"}
        onClick={() =>
          start(async () => {
            setDone(!done);
            await toggleTaskAction(task.id, !done);
          })
        }
        className={`mt-[3px] grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[3px] text-[11px] font-bold transition-colors ${
          done ? "border-[1.5px] border-nacht bg-nacht text-white" : high ? "border-2 border-nacht" : "border-[1.5px] border-nacht/35 hover:border-nacht"
        }`}
      >
        {done ? "✓" : ""}
      </button>

      <div className="min-w-0 flex-1">
        <Link
          href={`/taken/${task.id}`}
          className={`block text-[15px] leading-snug ${done ? "text-steen line-through" : high ? "font-bold text-nacht" : "text-grafiet hover:text-nacht"}`}
        >
          {task.title}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-steen">
          <span
            className={`inline-block h-2 w-2 rounded-full border border-nacht ${task.area === "prive" ? "bg-transparent" : "bg-nacht"}`}
            title={task.area === "prive" ? "Privé" : "Zakelijk"}
          />
          {meta.map((m) => (
            <span key={m} className="text-grafiet">{m}</span>
          ))}
          {when && <span className={overdue ? "font-bold text-nacht" : ""}>{label(when, today, tomorrow)}</span>}
          {task.dueDate && task.planDate && task.dueDate !== task.planDate && (
            <span className={deadlineSoon ? "font-bold text-nacht" : ""}>deadline {label(task.dueDate, today, tomorrow)}</span>
          )}
          {task.recurrence !== "none" && <span title="Terugkerend">↻</span>}
          {task.status === "waiting" && <span className="chip">wacht op</span>}
          {task.estimateMin ? <span>{task.estimateMin} min</span> : null}
        </div>
      </div>

      {!done && (
        <div className="flex shrink-0 gap-1 md:opacity-0 md:transition-opacity md:group-hover:opacity-100">
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
  if (!tasks.length) return <p className="px-4 py-4 text-sm text-steen">{empty ?? "Niets hier."}</p>;
  return (
    <ul className="divide-y divide-lijn">
      {tasks.map((t) => (
        <TaskRow key={t.id} task={t} today={today} tomorrow={tomorrow} showClient={showClient} showProject={showProject} />
      ))}
    </ul>
  );
}
