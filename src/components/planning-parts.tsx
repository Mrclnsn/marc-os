"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { toggleTaskAction } from "@/app/actions";
import { planTaskSlotAction } from "@/app/leven-actions";
import type { TaskWithRefs } from "@/lib/data";

/*
 * Inplannen: slepen (Mac) of "Plan in" kiezen (telefoon, één tik).
 * Een slot is "datum|blok-id"; zonder blok "datum|". Leeg = terug naar zonder plek.
 */

const MIME = "application/x-marc-os-task";

export type SlotOption = { value: string; label: string; group?: string };

function parseSlot(v: string): { date: string | null; blockId: string | null } {
  if (!v) return { date: null, blockId: null };
  const [date, blockId] = v.split("|");
  return { date, blockId: blockId || null };
}

/** Plek waar je een taak op kunt laten vallen: een blok of een dag. */
export function DropZone({ date, blockId, children, className = "" }: { date: string; blockId: string | null; children: React.ReactNode; className?: string }) {
  const [over, setOver] = useState(false);
  const [pending, start] = useTransition();
  return (
    <div
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        const id = e.dataTransfer.getData(MIME);
        setOver(false);
        if (!id) return;
        e.preventDefault();
        start(() => planTaskSlotAction(id, date, blockId));
      }}
      className={`${className} transition-colors ${over ? "outline outline-2 -outline-offset-2 outline-nacht" : ""} ${pending ? "opacity-60" : ""}`}
    >
      {children}
    </div>
  );
}

const nlDate = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short" });

/** Compacte taak om te slepen, af te vinken en in te plannen. */
export function PlanTask({
  task,
  slots,
  current,
  today,
  showDate = false,
  compact = false,
}: {
  task: TaskWithRefs;
  slots: SlotOption[];
  current: string;
  today: string;
  showDate?: boolean;
  compact?: boolean;
}) {
  const [pending, start] = useTransition();
  const [done, setDone] = useOptimistic(task.status === "done");
  const when = task.planDate ?? task.dueDate;
  const overdue = !done && when != null && when < today;
  const meta = [task.clientName, task.projectName].filter(Boolean) as string[];
  const groups = [...new Set(slots.map((s) => s.group ?? ""))];

  return (
    <div
      draggable={!done}
      onDragStart={(e) => {
        e.dataTransfer.setData(MIME, task.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className={`group relative flex items-start gap-2.5 bg-vlak px-2.5 py-2 ${done ? "" : "md:cursor-grab md:active:cursor-grabbing"} ${pending ? "opacity-50" : ""}`}
    >
      {overdue && <span className="absolute inset-y-0 left-0 w-[3px] bg-nacht" title="Achterstallig" />}
      <button
        aria-label={done ? "Heropenen" : "Afronden"}
        onClick={() =>
          start(async () => {
            setDone(!done);
            await toggleTaskAction(task.id, !done);
          })
        }
        className={`mt-[2px] grid h-4 w-4 shrink-0 place-items-center rounded-[3px] text-[10px] font-bold ${done ? "border-[1.5px] border-nacht bg-nacht text-op-nacht" : task.priority === 1 ? "border-2 border-nacht" : "border-[1.5px] border-nacht/35 hover:border-nacht"}`}
      >
        {done ? "✓" : ""}
      </button>
      <div className="min-w-0 flex-1">
        <Link href={`/taken/${task.id}`} className={`block leading-snug ${compact ? "line-clamp-2 hyphens-auto break-words text-[12.5px]" : "text-[13.5px]"} ${done ? "text-steen line-through" : task.priority === 1 ? "font-bold text-nacht" : "text-grafiet hover:text-nacht"}`}>
          {task.planTime && <span className="hud-mono mr-1.5 text-steen">{task.planTime}</span>}
          {task.title}
        </Link>
        {!compact && (
          <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-steen">
            <span className={`mt-[3px] inline-block h-1.5 w-1.5 rounded-full border border-nacht ${task.area === "prive" ? "" : "bg-nacht"}`} />
            {meta.map((m) => <span key={m}>{m}</span>)}
            {task.estimateMin ? <span>{task.estimateMin} min</span> : null}
            {showDate && when && <span className={overdue ? "font-bold text-nacht" : ""}>{when === today ? "vandaag" : nlDate.format(new Date(`${when}T12:00:00`))}</span>}
            {task.dueDate && (!showDate || task.planDate) && <span className={task.dueDate <= today ? "font-bold text-nacht" : ""}>deadline {nlDate.format(new Date(`${task.dueDate}T12:00:00`))}</span>}
          </div>
        )}
        {compact && !done && slots.length > 0 && (
          <SlotSelect task={task} slots={slots} current={current} groups={groups} compact onPlan={(d, b) => start(() => planTaskSlotAction(task.id, d, b))} />
        )}
      </div>
      {!done && slots.length > 0 && !compact && <SlotSelect task={task} slots={slots} current={current} groups={groups} onPlan={(d, b) => start(() => planTaskSlotAction(task.id, d, b))} />}
    </div>
  );
}

function SlotSelect({ task, slots, current, groups, compact, onPlan }: { task: TaskWithRefs; slots: SlotOption[]; current: string; groups: string[]; compact?: boolean; onPlan: (date: string | null, blockId: string | null) => void }) {
  return (
    <select
      aria-label={`Plan in: ${task.title}`}
      value={slots.some((s) => s.value === current) ? current : ""}
      onChange={(e) => {
        const { date, blockId } = parseSlot(e.target.value);
        onPlan(date, blockId);
      }}
      className={`input py-0.5 text-[11px] ${compact ? "mt-1 w-full md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100" : "w-[92px] shrink-0 md:w-[110px] md:opacity-60 md:group-hover:opacity-100"}`}
    >
      <option value="">{current ? "Uit planning" : "Plan in…"}</option>
      {groups.map((g) =>
        g ? (
          <optgroup key={g} label={g}>
            {slots.filter((s) => s.group === g).map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </optgroup>
        ) : (
          slots.filter((s) => !s.group).map((s) => <option key={s.value} value={s.value}>{s.label}</option>)
        ),
      )}
    </select>
  );
}

/** Ritme voor deze dag kiezen; verstuurt bij wijzigen. */
export function DayRhythmSelect({ action, value, options }: { action: (fd: FormData) => Promise<void>; value: string; options: { value: string; label: string }[] }) {
  const [pending, start] = useTransition();
  return (
    <form action={(fd) => start(() => action(fd))} className={pending ? "opacity-60" : ""}>
      <select name="rhythm" defaultValue={value} onChange={(e) => e.currentTarget.form?.requestSubmit()} className="input py-1 text-sm" aria-label="Dagritme voor deze dag">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </form>
  );
}
