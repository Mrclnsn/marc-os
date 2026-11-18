import Link from "next/link";
import { PageHeader, SectionTitle } from "@/components/brand";
import { GoalForm, GoalTemplates } from "@/components/goal-parts";
import { GoalCard, GoalLine } from "@/components/goal-view";
import { listGoals, listHabits, listLearning } from "@/lib/data";
import { today } from "@/lib/dates";
import { GOAL_TEMPLATES, STATUS_TONE } from "@/lib/goals-shared";
import { getModules } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * Doelen (gesprek 10): lopende doelen met on-track-status, voorbeelden uit de propositie, nieuw doel,
 * en daaronder komende, afgelopen en gearchiveerde doelen.
 */
export default async function GoalsPage() {
  const t = today();
  const [all, habits, learning, modules] = await Promise.all([listGoals({ includeArchived: true }), listHabits(), listLearning(), getModules()]);
  const active = all.filter((g) => !g.archivedAt);
  const running = active.filter((g) => g.startDate <= t && g.endDate >= t);
  const upcoming = active.filter((g) => g.startDate > t);
  const ended = active.filter((g) => g.endDate < t);
  const archived = all.filter((g) => g.archivedAt);
  // Subdoelen staan onder hun bovenliggende doel als dat ook loopt
  const runningIds = new Set(running.map((g) => g.id));
  const top = running.filter((g) => !g.parentId || !runningIds.has(g.parentId));
  const tones = running.filter((g) => g.eval.status !== "inactive" && g.eval.status !== "no_data").map((g) => STATUS_TONE[g.eval.status]);
  const count = (x: string) => tones.filter((y) => y === x).length;

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Leven" title="Doelen">
        <Link href="/leren" className="btn-ghost text-sm">Leren →</Link>
      </PageHeader>

      <section className="space-y-3">
        <SectionTitle aside={tones.length ? <span className="text-xs text-steen">{count("good")} op schema · {count("warn")} achter · {count("bad")} risico</span> : undefined}>Lopend</SectionTitle>
        {top.length ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {top.map((g) => (
              <GoalCard key={g.id} g={g} sub={running.filter((c) => c.parentId === g.id)} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-steen">Nog geen lopende doelen. Begin met een voorbeeld hieronder of maak een eigen doel.</p>
        )}
        <p className="text-xs text-steen">
          Het streepje op de balk is waar je rond deze tijd zou moeten staan. Op schema vanaf 95% daarvan, voor op schema vanaf 110%, achter vanaf 80%, daaronder risico.
          Bij een doel per week of maand telt het gemiddelde over de weken die voorbij zijn.
        </p>
      </section>

      <section className="space-y-3">
        <SectionTitle>Voorbeelden uit je propositie</SectionTitle>
        <GoalTemplates templates={GOAL_TEMPLATES} existing={active.map((g) => g.title.toLowerCase())} />
        <p className="text-xs text-steen">Eén klik maakt het doel voor dit jaar (of dit kwartaal); daarna kun je alles aanpassen. Doelen die op een uitgeschakelde module leunen, tellen mee zodra die module aan staat.</p>
      </section>

      <section className="space-y-3">
        <SectionTitle>Nieuw doel</SectionTitle>
        <div className="card p-4">
          <GoalForm
            today={t}
            modules={modules}
            habits={habits.map((h) => ({ id: h.id, label: `${h.title} (${h.frequencyLabel})` }))}
            learning={learning.filter((l) => l.status !== "afgerond").map((l) => ({ id: l.id, label: l.title }))}
            parents={active.map((g) => ({ id: g.id, label: `${g.title} · ${g.periodLabel}` }))}
          />
        </div>
      </section>

      {upcoming.length > 0 && (
        <section className="space-y-3">
          <SectionTitle>Komend</SectionTitle>
          <ul className="card divide-y divide-lijn">{upcoming.map((g) => <GoalLine key={g.id} g={g} />)}</ul>
        </section>
      )}
      {ended.length > 0 && (
        <section className="space-y-3">
          <SectionTitle>Afgelopen</SectionTitle>
          <ul className="card divide-y divide-lijn">{ended.map((g) => <GoalLine key={g.id} g={g} />)}</ul>
        </section>
      )}
      {archived.length > 0 && (
        <section className="space-y-3">
          <SectionTitle>Gearchiveerd</SectionTitle>
          <ul className="card divide-y divide-lijn">{archived.map((g) => <GoalLine key={g.id} g={g} />)}</ul>
        </section>
      )}
    </div>
  );
}
