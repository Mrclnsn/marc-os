import Link from "next/link";
import { getISOWeek, parseISO } from "date-fns";
import { PageHeader } from "@/components/brand";
import { TaskList } from "@/components/task-row";
import { CaptureBar, QuickAddTask } from "@/components/quick-add";
import { GoalBar, HabitsPanel, HermesPanel, KpiTiles, Panel, SignalPanel, TimelineView } from "@/components/cockpit";
import { getCockpit } from "@/lib/cockpit";
import { TIMEZONE, addDaysIso, formatLong } from "@/lib/dates";
import { getOptions } from "@/lib/options";

function greeting() {
  const hour = Number(new Intl.DateTimeFormat("nl-NL", { hour: "numeric", hour12: false, timeZone: TIMEZONE }).format(new Date()));
  if (hour < 6) return "Goedenacht";
  if (hour < 12) return "Goedemorgen";
  if (hour < 18) return "Goedemiddag";
  return "Goedenavond";
}

function isoWeek(iso: string) {
  return getISOWeek(parseISO(iso));
}

/**
 * Vandaag: de cockpit. Volgorde op de telefoon: doel, tegels, braindump, briefing, signalen,
 * achterstallig, tijdlijn met taken, komende dagen. Op de Mac staan signalen en gewoontes rechts.
 */
export default async function TodayPage({ searchParams }: { searchParams: Promise<{ gebied?: string }> }) {
  const { gebied } = await searchParams;
  const area = gebied === "zakelijk" || gebied === "prive" ? gebied : undefined;
  const [c, options] = await Promise.all([getCockpit(area), getOptions()]);
  const t = c.date;
  const tomorrow = addDaysIso(t, 1);

  const tabs = [
    { key: undefined, label: "Alles" },
    { key: "zakelijk", label: "Zakelijk" },
    { key: "prive", label: "Privé" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={<span><span className="capitalize">{formatLong(t)}</span> · week {isoWeek(t)}</span>} title={`${greeting()}, Marc`}>
        <div className="flex gap-4">
          {tabs.map((tab) => (
            <Link key={tab.label} href={tab.key ? `/?gebied=${tab.key}` : "/"} className={area === tab.key ? "tab-active" : "tab"}>
              {tab.label}
            </Link>
          ))}
        </div>
      </PageHeader>

      {/* Gesprek 10: hoofddoel met on-track-status */}
      <GoalBar goal={null} />

      <KpiTiles kpis={c.kpis} />

      <CaptureBar />

      {/* Gesprek 12/13: Hermes met akkoordwachtrij en routinestatus */}
      <HermesPanel briefing={c.briefing} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <aside className="space-y-6 lg:order-2">
          <SignalPanel signals={c.signals} />
          {/* Gesprek 8: gewoontes van vandaag */}
          <HabitsPanel habits={null} />
        </aside>

        <div className="min-w-0 space-y-6 lg:order-1">
          {c.overdue.length > 0 && (
            <Panel id="achterstallig" title="Achterstallig" aside={`${c.overdue.length}`}>
              <TaskList tasks={c.overdue} today={t} tomorrow={tomorrow} />
            </Panel>
          )}

          <Panel id="tijdlijn" title="Vandaag" aside={`${c.timeline.planned.length} ${c.timeline.planned.length === 1 ? "taak" : "taken"}`}>
            <TimelineView timeline={c.timeline} />
            <div id="vandaag" className="scroll-mt-20 border-t border-lijn">
              <p className="px-4 pt-3 text-[10px] uppercase tracking-[0.14em] text-steen">Ingepland voor vandaag</p>
              <TaskList tasks={c.timeline.planned} today={t} tomorrow={tomorrow} empty="Niets gepland. Kies iets uit de komende dagen of je takenlijst." />
              <div className="border-t border-lijn p-2">
                <QuickAddTask clients={options.clients} projects={options.projects} defaults={{ planDate: t, area }} placeholder="Taak voor vandaag..." />
              </div>
            </div>
          </Panel>

          <Panel title="Komende 7 dagen" aside={<Link href="/taken" className="hover:text-nacht">Alle taken</Link>}>
            <TaskList tasks={c.upcoming} today={t} tomorrow={tomorrow} empty="Niets gepland voor de komende week." />
          </Panel>
        </div>
      </div>
    </div>
  );
}
