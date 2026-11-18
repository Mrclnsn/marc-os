import { PageHeader, SectionTitle } from "@/components/brand";
import { PlanningTabs } from "@/components/planning-nav";
import { HabitAdmin, HabitCheckList, HabitForm, HabitHistory } from "@/components/habit-parts";
import { listHabits, listRhythms } from "@/lib/data";
import { today } from "@/lib/dates";

export const dynamic = "force-dynamic";

/** Gewoontes: afvinken, reeks en percentage per week en maand, laatste 28 dagen, beheren. */
export default async function HabitsPage() {
  const t = today();
  const [all, rhythms] = await Promise.all([listHabits({ includeArchived: true }), listRhythms()]);
  const active = all.filter((h) => !h.archivedAt);
  const archived = all.filter((h) => h.archivedAt);
  const blocks = rhythms.flatMap((r) => r.blocks.map((b) => ({ id: b.id, label: `${r.name} · ${b.startTime} ${b.title}` })));
  const todays = active.filter((h) => h.dueToday || h.doneToday);
  const doneToday = todays.filter((h) => h.doneToday).length;

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Planning" title="Gewoontes" />
      <PlanningTabs active="gewoontes" />

      <section className="space-y-3">
        <SectionTitle aside={<span className="text-xs text-steen">{doneToday} van {todays.length}</span>}>Vandaag</SectionTitle>
        {todays.length ? (
          <div className="card">
            <HabitCheckList
              date={t}
              habits={todays.map((h) => ({ id: h.id, title: h.title, done: h.doneToday, due: h.dueToday, streak: h.streak, streakUnit: h.streakUnit, weekPct: h.week.pct, frequency: h.frequencyLabel, block: h.blockTitle }))}
            />
          </div>
        ) : (
          <p className="text-sm text-steen">{active.length ? "Vandaag staat er geen gewoonte op het programma." : "Nog geen gewoontes. Voeg er hieronder een toe, bijvoorbeeld sporten (3x per week) of de dagafsluiting (werkdagen)."}</p>
        )}
      </section>

      {active.length > 0 && (
        <section className="space-y-3">
          <SectionTitle>Overzicht</SectionTitle>
          <ul className="card divide-y divide-lijn">
            {active.map((h) => (
              <li key={h.id} className="space-y-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
                  <div className="min-w-0">
                    <p className="font-bold text-nacht">{h.title}</p>
                    <p className="text-xs text-steen">
                      {h.frequencyLabel} · {h.area === "prive" ? "privé" : "zakelijk"}
                      {h.blockTitle ? ` · bij ${h.blockTitle} (${h.blockStart})` : ""}
                    </p>
                  </div>
                  <dl className="grid grid-cols-3 gap-x-6 text-center">
                    <div>
                      <dt className="text-[10px] uppercase tracking-[0.12em] text-steen">Reeks</dt>
                      <dd className="hud-mono text-lg font-bold tabular-nums text-nacht">{h.streak} <span className="text-xs font-normal text-steen">{h.streakUnit}</span></dd>
                    </div>
                    <div>
                      <dt className="text-[10px] uppercase tracking-[0.12em] text-steen">Week</dt>
                      <dd className="hud-mono text-lg font-bold tabular-nums text-nacht">{h.week.pct ?? "–"}{h.week.pct !== null && "%"}</dd>
                      <dd className="text-[10px] text-steen">{h.week.done} van {h.week.target}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] uppercase tracking-[0.12em] text-steen">Maand</dt>
                      <dd className="hud-mono text-lg font-bold tabular-nums text-nacht">{h.month.pct ?? "–"}{h.month.pct !== null && "%"}</dd>
                      <dd className="text-[10px] text-steen">{h.month.done} van {h.month.target}</dd>
                    </div>
                  </dl>
                </div>
                <HabitHistory id={h.id} title={h.title} history={h.history} />
                <details>
                  <summary className="cursor-pointer text-xs text-steen hover:text-nacht">Bewerken</summary>
                  <div className="mt-3 space-y-3">
                    <HabitForm id={h.id} blocks={blocks} habit={{ title: h.title, area: h.area, frequency: h.frequency, timesPerWeek: h.timesPerWeek, weekdays: h.weekdays, blockId: h.blockId, notes: h.notes }} />
                    <HabitAdmin id={h.id} archived={false} title={h.title} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
          <p className="text-xs text-steen">
            Vakjes: laatste 28 dagen (gevuld = gedaan, open = had gemoeten, grijs = hoefde niet). Klik een vakje om een vergeten dag alsnog af te vinken.
            Percentage: gedaan tegenover wat er tot nu toe had gemoeten; vandaag telt pas mee als hij is afgevinkt.
          </p>
        </section>
      )}

      <section className="space-y-3">
        <SectionTitle>Nieuwe gewoonte</SectionTitle>
        <div className="card p-4">
          <HabitForm blocks={blocks} />
        </div>
      </section>

      {archived.length > 0 && (
        <section className="space-y-3">
          <SectionTitle>Gestopt</SectionTitle>
          <ul className="card divide-y divide-lijn">
            {archived.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <span className="text-steen">{h.title} · {h.frequencyLabel}</span>
                <HabitAdmin id={h.id} archived title={h.title} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
