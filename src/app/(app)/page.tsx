import Link from "next/link";
import { TaskList } from "@/components/task-row";
import { CaptureBar, QuickAddTask } from "@/components/quick-add";
import { listTasks, inboxCount, listReviews } from "@/lib/data";
import { addDaysIso, formatLong, today } from "@/lib/dates";
import { calendarConfigured, getEvents } from "@/lib/calendar";
import { getOptions } from "@/lib/options";

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ gebied?: string }> }) {
  const { gebied } = await searchParams;
  const area = gebied === "zakelijk" || gebied === "prive" ? gebied : undefined;
  const t = today();
  const tomorrow = addDaysIso(t, 1);

  const [todayTasks, upcoming, inbox, options, cal, lastDay] = await Promise.all([
    listTasks({ view: "today", area }),
    listTasks({ view: "upcoming", days: 7, area }),
    inboxCount(),
    getOptions(),
    calendarConfigured() ? getEvents(t, t) : Promise.resolve(null),
    listReviews("day", 1),
  ]);

  const overdue = todayTasks.filter((x) => (x.planDate ?? x.dueDate)! < t);
  const now = todayTasks.filter((x) => (x.planDate ?? x.dueDate)! >= t);
  const briefing = lastDay[0]?.periodDate === t ? lastDay[0] : null;

  const tabs = [
    { key: undefined, label: "Alles" },
    { key: "zakelijk", label: "Zakelijk" },
    { key: "prive", label: "Privé" },
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted capitalize">{formatLong(t)}</p>
          <h1 className="h1">Vandaag</h1>
        </div>
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <Link
              key={tab.label}
              href={tab.key ? `/?gebied=${tab.key}` : "/"}
              className={`rounded-md px-2.5 py-1 text-sm ${area === tab.key ? "bg-accent-soft text-accent font-medium" : "text-muted hover:text-fg"}`}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </header>

      <CaptureBar />
      {inbox > 0 && (
        <Link href="/inbox" className="block text-sm text-accent">
          {inbox} {inbox === 1 ? "item" : "items"} in je inbox om te verwerken →
        </Link>
      )}

      {briefing && (
        <section className="card p-4">
          <h2 className="h2 mb-2">Briefing</h2>
          <div className="whitespace-pre-wrap text-sm leading-relaxed">{briefing.body}</div>
        </section>
      )}

      {cal && (
        <section className="space-y-2">
          <h2 className="h2">Agenda</h2>
          <div className="card divide-y divide-line">
            {cal.events.length === 0 && <p className="px-3 py-3 text-sm text-muted">Geen afspraken vandaag.</p>}
            {cal.events.map((e, i) => (
              <div key={i} className="flex gap-3 px-3 py-2 text-sm">
                <span className="w-24 shrink-0 tabular-nums text-muted">{e.allDay ? "Hele dag" : `${e.time}–${e.endTime}`}</span>
                <span className="flex-1">{e.title}</span>
                <span className="chip">{e.calendar}</span>
              </div>
            ))}
            {cal.errors.map((err) => (
              <p key={err} className="px-3 py-2 text-xs text-danger">{err}</p>
            ))}
          </div>
        </section>
      )}

      {overdue.length > 0 && (
        <section className="space-y-2">
          <h2 className="h2 text-danger">Achterstallig</h2>
          <div className="card">
            <TaskList tasks={overdue} today={t} tomorrow={tomorrow} />
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="h2">Taken voor vandaag</h2>
        <div className="card">
          <TaskList tasks={now} today={t} tomorrow={tomorrow} empty="Niets gepland. Kies iets uit 'Komende 7 dagen' of je takenlijst." />
        </div>
        <QuickAddTask clients={options.clients} projects={options.projects} defaults={{ planDate: t, area }} placeholder="Taak voor vandaag..." />
      </section>

      <section className="space-y-2">
        <h2 className="h2">Komende 7 dagen</h2>
        <div className="card">
          <TaskList tasks={upcoming} today={t} tomorrow={tomorrow} empty="Niets gepland voor de komende week." />
        </div>
      </section>
    </div>
  );
}
