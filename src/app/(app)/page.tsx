import Link from "next/link";
import { cookies } from "next/headers";
import { getISOWeek, parseISO } from "date-fns";
import { TaskList } from "@/components/task-row";
import { CaptureBar, QuickAddTask } from "@/components/quick-add";
import { AgentsPanel, BriefingPanel, GoalBar, HabitsPanel, HourTimeline, KpiTiles, Panel, SignalPanel } from "@/components/cockpit";
import { CockpitStyleSwitch, LiveClock } from "@/components/cockpit-client";
import { getCockpit } from "@/lib/cockpit";
import { TIMEZONE, addDaysIso, formatLong } from "@/lib/dates";
import { COCKPIT_COOKIE, parseCockpitStyle } from "@/lib/modules";
import { getOptions } from "@/lib/options";

function greeting() {
  const hour = Number(new Intl.DateTimeFormat("nl-NL", { hour: "numeric", hour12: false, timeZone: TIMEZONE }).format(new Date()));
  if (hour < 6) return "Goedenacht";
  if (hour < 12) return "Goedemorgen";
  if (hour < 18) return "Goedemiddag";
  return "Goedenavond";
}

/**
 * Vandaag: de cockpit, naar de opzet uit de inspiratievideo.
 * Boven: klok, doelbalk en KPI-tegels. Daaronder drie kolommen:
 * links Hermes en agents, midden briefing, focus en taken, rechts de tijdlijn voor de komende 8 uur en signalen.
 * Twee stijlen per apparaat: Strak (MLC) en Iron Man (HUD met gloed en animaties).
 * Op de telefoon: briefing en focus eerst, dan tijdlijn en signalen, dan Hermes.
 */
export default async function TodayPage({ searchParams }: { searchParams: Promise<{ gebied?: string }> }) {
  const { gebied } = await searchParams;
  const area = gebied === "zakelijk" || gebied === "prive" ? gebied : undefined;
  const [c, options, store] = await Promise.all([getCockpit(area), getOptions(), cookies()]);
  const style = parseCockpitStyle(store.get(COCKPIT_COOKIE)?.value);
  const hud = style === "ironman";
  const t = c.date;
  const tomorrow = addDaysIso(t, 1);

  const tabs = [
    { key: undefined, label: "Alles" },
    { key: "zakelijk", label: "Zakelijk" },
    { key: "prive", label: "Privé" },
  ];

  return (
    <div className={`-mx-5 -mb-28 -mt-8 min-h-dvh px-5 pb-36 pt-6 md:-mx-12 md:-mb-16 md:-mt-12 md:px-8 md:pb-24 md:pt-8 ${hud ? "hud" : ""}`}>
      <div className="space-y-5">
        {/* Kop: datum, begroeting, klok, filter en stijl */}
        <header className={`flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pb-4 ${hud ? "border-b border-[var(--hud)]/40" : "border-b-[3px] border-nacht"}`}>
          <div className="min-w-0">
            <p className="hud-mono eyebrow mb-1.5">
              <span className="capitalize">{formatLong(t)}</span> · week {getISOWeek(parseISO(t))}
              {hud && <span className="ml-2 text-[var(--hud)]">· systemen online</span>}
            </p>
            <h1 className="glow text-3xl font-bold leading-none tracking-tight text-nacht md:text-4xl">{greeting()}, Marc</h1>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <div className="flex gap-4">
              {tabs.map((tab) => (
                <Link key={tab.label} href={tab.key ? `/?gebied=${tab.key}` : "/"} className={area === tab.key ? "tab-active" : "tab"}>
                  {tab.label}
                </Link>
              ))}
            </div>
            <CockpitStyleSwitch style={style} />
            <LiveClock initial={c.nowLabel} tz={TIMEZONE} className="glow hud-mono text-3xl font-bold leading-none text-nacht md:text-4xl" />
          </div>
        </header>

        <GoalBar goal={c.goal} />

        <KpiTiles kpis={c.kpis} />

        <div className="grid gap-5 min-[1024px]:grid-cols-[minmax(0,1fr)_380px] min-[1360px]:grid-cols-[290px_minmax(0,1fr)_370px] min-[1700px]:grid-cols-[330px_minmax(0,1fr)_420px]">
          {/* Midden: briefing, braindump, focus en taken */}
          <div className="min-w-0 space-y-5 min-[1360px]:order-2">
            <BriefingPanel hud={hud} briefing={c.briefing} auto={c.autoBriefing} at={c.briefingAt} nowLabel={c.nowLabel} />

            <CaptureBar />

            <Panel id="vandaag" title="Focus" aside={`${c.doneCount} afgerond vandaag`}>
              <div className="genummerd">
                <TaskList tasks={c.focus} today={t} tomorrow={tomorrow} empty="Niets meer open voor vandaag. Kies iets uit de komende dagen." />
              </div>
            </Panel>

            <Panel id="achterstallig" title="Verder vandaag" aside={c.overdue.length ? `${c.overdue.length} achterstallig` : `${c.rest.length}`}>
              <TaskList tasks={c.rest} today={t} tomorrow={tomorrow} empty="Verder niets gepland." />
              <div className="border-t border-lijn p-2">
                <QuickAddTask clients={options.clients} projects={options.projects} defaults={{ planDate: t, area }} placeholder="Taak voor vandaag..." />
              </div>
            </Panel>

            <Panel title="Komende 7 dagen" aside={<Link href="/taken" className="hover:text-nacht">Alle taken</Link>}>
              <TaskList tasks={c.upcoming} today={t} tomorrow={tomorrow} empty="Niets gepland voor de komende week." />
            </Panel>
          </div>

          {/* Rechts: tijdlijn en signalen */}
          <div className="min-w-0 space-y-5 min-[1360px]:order-3">
            <HourTimeline window={c.window} timeline={c.timeline} />
            <SignalPanel signals={c.signals} />
            {/* Gesprek 8: gewoontes van vandaag */}
            <HabitsPanel habits={null} />
          </div>

          {/* Links: Hermes en agents (op een smaller scherm onder de rest) */}
          <div className="min-w-0 space-y-5 min-[1024px]:col-span-2 min-[1360px]:order-1 min-[1360px]:col-span-1">
            <AgentsPanel hasBriefing={!!c.briefing} />
          </div>
        </div>
      </div>
    </div>
  );
}
