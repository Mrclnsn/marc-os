import Link from "next/link";
import { PageHeader, SectionTitle } from "@/components/brand";
import { TaskList } from "@/components/task-row";
import { CaptureBar, QuickAddTask } from "@/components/quick-add";
import { expiringDomains, listTasks, inboxCount, listReviews } from "@/lib/data";
import { domainState } from "@/components/client-parts";
import { TIMEZONE, addDaysIso, formatLong, today } from "@/lib/dates";
import { calendarConfigured, getEvents } from "@/lib/calendar";
import { getOptions } from "@/lib/options";

function greeting() {
  const hour = Number(new Intl.DateTimeFormat("nl-NL", { hour: "numeric", hour12: false, timeZone: TIMEZONE }).format(new Date()));
  if (hour < 6) return "Goedenacht";
  if (hour < 12) return "Goedemorgen";
  if (hour < 18) return "Goedemiddag";
  return "Goedenavond";
}

function Stat({ value, label, href }: { value: number; label: string; href?: string }) {
  const inner = (
    <>
      <span className="block text-4xl font-bold leading-none text-nacht tabular-nums">{value}</span>
      <span className="mt-2 block text-xs uppercase tracking-wider text-steen">{label}</span>
    </>
  );
  return href ? (
    <Link href={href} className="block border-l border-lijn pl-4 transition-colors hover:border-nacht">{inner}</Link>
  ) : (
    <div className="border-l border-lijn pl-4">{inner}</div>
  );
}

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ gebied?: string }> }) {
  const { gebied } = await searchParams;
  const area = gebied === "zakelijk" || gebied === "prive" ? gebied : undefined;
  const t = today();
  const tomorrow = addDaysIso(t, 1);

  const [todayTasks, upcoming, inbox, options, cal, lastDay, domains] = await Promise.all([
    listTasks({ view: "today", area }),
    listTasks({ view: "upcoming", days: 7, area }),
    inboxCount(),
    getOptions(),
    calendarConfigured() ? getEvents(t, t) : Promise.resolve(null),
    listReviews("day", 1),
    area === "prive" ? Promise.resolve([]) : expiringDomains(),
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
    <div>
      <PageHeader eyebrow={<span className="capitalize">{formatLong(t)}</span>} title={`${greeting()}, Marc`}>
        <div className="flex gap-4">
          {tabs.map((tab) => (
            <Link key={tab.label} href={tab.key ? `/?gebied=${tab.key}` : "/"} className={area === tab.key ? "tab-active" : "tab"}>
              {tab.label}
            </Link>
          ))}
        </div>
      </PageHeader>

      <div className="mb-10 grid grid-cols-2 gap-6 md:grid-cols-4">
        <Stat value={now.length} label="Vandaag" />
        <Stat value={overdue.length} label="Achterstallig" />
        <Stat value={cal?.events.length ?? 0} label="Afspraken" />
        <Stat value={inbox} label="In je inbox" href="/inbox" />
      </div>

      <div className="mb-10">
        <CaptureBar />
      </div>

      {briefing && (
        <section className="mb-10 rounded-sm bg-nacht p-6 text-white">
          <p className="mb-3 text-xs uppercase tracking-[0.2em] text-white/50">Briefing</p>
          <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-white/90">{briefing.body}</div>
        </section>
      )}

      <div className="grid gap-10 lg:grid-cols-[1fr_300px]">
        <div className="space-y-10">
          {overdue.length > 0 && (
            <section>
              <SectionTitle>Achterstallig</SectionTitle>
              <div className="card">
                <TaskList tasks={overdue} today={t} tomorrow={tomorrow} />
              </div>
            </section>
          )}

          <section>
            <SectionTitle>Taken voor vandaag</SectionTitle>
            <div className="card">
              <TaskList tasks={now} today={t} tomorrow={tomorrow} empty="Niets gepland. Kies iets uit de komende dagen of je takenlijst." />
            </div>
            <div className="mt-3">
              <QuickAddTask clients={options.clients} projects={options.projects} defaults={{ planDate: t, area }} placeholder="Taak voor vandaag..." />
            </div>
          </section>

          <section>
            <SectionTitle>Komende 7 dagen</SectionTitle>
            <div className="card">
              <TaskList tasks={upcoming} today={t} tomorrow={tomorrow} empty="Niets gepland voor de komende week." />
            </div>
          </section>
        </div>

        <aside>
          <SectionTitle>Agenda</SectionTitle>
          {!cal ? (
            <p className="text-sm text-steen">Nog geen agenda gekoppeld. Voeg een ICS-link toe in de instellingen.</p>
          ) : cal.events.length === 0 ? (
            <p className="text-sm text-steen">Geen afspraken vandaag.</p>
          ) : (
            <ol className="relative space-y-4 border-l-[3px] border-nacht pl-5">
              {cal.events.map((e, i) => (
                <li key={i}>
                  <p className="text-xs uppercase tracking-wider text-steen tabular-nums">{e.allDay ? "Hele dag" : `${e.time} – ${e.endTime}`}</p>
                  <p className="text-[15px] font-bold leading-snug text-nacht">{e.title}</p>
                  <p className="text-xs text-steen">{e.calendar}{e.location ? ` · ${e.location}` : ""}</p>
                </li>
              ))}
            </ol>
          )}
          {cal?.errors.map((err) => (
            <p key={err} className="mt-3 text-xs text-steen">{err}</p>
          ))}

          {domains.length > 0 && (
            <div className="mt-10">
              <SectionTitle>Domeinen</SectionTitle>
              <ul className="space-y-2">
                {domains.map(({ website, clientName }) => (
                  <li key={website.id}>
                    <Link href={`/klanten/${website.clientId}`} className="block border-l-[3px] border-nacht pl-3 hover:bg-parel">
                      <span className="block text-[15px] font-bold text-nacht">{website.domain}</span>
                      <span className="block text-xs text-steen">{clientName} · {domainState(website.domainExpiresAt)?.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
