import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, SectionTitle } from "@/components/brand";
import { DeleteEntry, GoalAdmin, GoalEntryForm, GoalForm, MilestoneForm, MilestoneRow } from "@/components/goal-parts";
import { GoalProgress, GoalLine, StatusChip } from "@/components/goal-view";
import { getGoal, listGoals, listHabits, listLearning } from "@/lib/data";
import { formatDate, today } from "@/lib/dates";
import { fmtGoalValue, GOAL_CURVES, GOAL_PER, type GoalPer } from "@/lib/goals-shared";
import { getOptions } from "@/lib/options";
import { getModules } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function GoalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await getGoal(id);
  if (!g) notFound();
  const t = today();
  const [all, habits, learning, modules, options] = await Promise.all([listGoals(), listHabits({ includeArchived: true }), listLearning(), getModules(), getOptions()]);
  // Niet onder zichzelf of een eigen subdoel hangen
  const below = new Set<string>([g.id]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const x of all) {
      if (x.parentId && below.has(x.parentId) && !below.has(x.id)) {
        below.add(x.id);
        changed = true;
      }
    }
  }
  const e = g.eval;

  return (
    <div className="space-y-8">
      <Link href="/doelen" className="inline-block text-sm text-steen hover:text-nacht">← Doelen</Link>
      <PageHeader eyebrow={`${g.areaLabel} · ${g.periodLabel}${g.parentTitle ? ` · onder ${g.parentTitle}` : ""}`} title={g.title}>
        <StatusChip status={e.status} className="text-xs" />
      </PageHeader>

      <section className="card hoeken relative space-y-4 p-5">
        <span aria-hidden className="accent absolute left-0 top-0 h-[3px] w-16 bg-nacht" />
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="hud-mono text-[11px] uppercase tracking-[0.14em] text-steen">Nu</p>
            <p className="glow hud-mono text-4xl font-bold tabular-nums leading-none text-nacht">{e.valueLabel}</p>
          </div>
          <div className="text-right">
            <p className="hud-mono text-[11px] uppercase tracking-[0.14em] text-steen">Doel</p>
            <p className="hud-mono text-xl font-bold tabular-nums text-nacht">{e.targetLabel}</p>
          </div>
        </div>
        <GoalProgress pct={e.pct} expectedPct={e.expectedPct} />
        <p className="text-sm text-grafiet">{e.summary}</p>
        {e.needed && <p className="text-sm text-steen">Nodig: {e.needed}.</p>}
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 border-t border-lijn pt-3 text-sm sm:grid-cols-4">
          <div><dt className="label">Meetwijze</dt><dd>{g.sourceLabel ?? g.measureLabel}{g.habitTitle ? `: ${g.habitTitle}` : ""}{g.learningTitle ? ` (${g.learningTitle})` : ""}</dd></div>
          <div><dt className="label">Periode</dt><dd>{formatDate(g.startDate)} tot {formatDate(g.endDate)}</dd></div>
          <div><dt className="label">Nog</dt><dd>{e.daysLeft} {e.daysLeft === 1 ? "dag" : "dagen"} ({Math.round(e.timeFraction * 100)}% voorbij)</dd></div>
          <div>
            <dt className="label">Verloop</dt>
            <dd>{g.targetPer ? `gemiddelde ${GOAL_PER[g.targetPer as GoalPer]}` : g.measure === "milestones" && g.milestoneList.length && g.milestoneList.every((m) => m.dueDate) ? "volgens de mijlpaaldatums" : GOAL_CURVES[g.curve as keyof typeof GOAL_CURVES]}{g.startValue != null ? ` · start ${fmtGoalValue(g.startValue, g.unitType, g.noun)}` : ""}</dd>
          </div>
        </dl>
        {g.notes && <p className="whitespace-pre-line border-t border-lijn pt-3 text-sm text-grafiet">{g.notes}</p>}
      </section>

      {g.measure === "manual" && (
        <section className="space-y-3">
          <SectionTitle>Metingen</SectionTitle>
          <div className="card p-4"><GoalEntryForm goalId={g.id} today={t} unit={g.unit} /></div>
          {g.entries.length > 0 && (
            <ul className="card divide-y divide-lijn">
              {g.entries.map((x) => (
                <li key={x.id} className="flex items-center gap-3 px-4 py-2">
                  <span className="hud-mono w-28 text-xs text-steen">{formatDate(x.date)}</span>
                  <span className="hud-mono font-bold tabular-nums text-nacht">{fmtGoalValue(x.value, g.unitType, g.noun)}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-steen">{[x.note, x.source !== "app" ? `via ${x.source}` : null].filter(Boolean).join(" · ")}</span>
                  <DeleteEntry id={x.id} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {(g.measure === "milestones" || g.milestoneList.length > 0) && (
        <section className="space-y-3">
          <SectionTitle aside={<span className="text-xs text-steen">{g.milestones.done} van {g.milestones.total}</span>}>Mijlpalen</SectionTitle>
          {g.milestoneList.length > 0 && <ul className="card divide-y divide-lijn">{g.milestoneList.map((m) => <MilestoneRow key={m.id} m={m} />)}</ul>}
          <div className="card p-4"><MilestoneForm goalId={g.id} projects={options.projects.map((p) => ({ id: p.id, label: p.name }))} /></div>
        </section>
      )}

      {g.children.length > 0 && (
        <section className="space-y-3">
          <SectionTitle>Subdoelen</SectionTitle>
          <ul className="card divide-y divide-lijn">{g.children.map((c) => <GoalLine key={c.id} g={c} />)}</ul>
        </section>
      )}

      <section className="space-y-3">
        <SectionTitle>Bewerken</SectionTitle>
        <div className="card p-4">
          <GoalForm
            id={g.id}
            today={t}
            modules={modules}
            goal={{ ...g }}
            habits={habits.map((h) => ({ id: h.id, label: `${h.title} (${h.frequencyLabel})${h.archivedAt ? " · gestopt" : ""}` }))}
            learning={learning.map((l) => ({ id: l.id, label: l.title }))}
            parents={all.filter((x) => !below.has(x.id)).map((x) => ({ id: x.id, label: `${x.title} · ${x.periodLabel}` }))}
          />
        </div>
        <GoalAdmin id={g.id} featured={g.featured} archived={!!g.archivedAt} title={g.title} />
      </section>
    </div>
  );
}
