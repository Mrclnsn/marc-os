import Link from "next/link";
import { PageHeader, SectionTitle } from "@/components/brand";
import { KpiTiles, type Tile } from "@/components/cockpit";
import { GoalProgress } from "@/components/goal-view";
import { LearningForm, LogLearningForm } from "@/components/learning-parts";
import { learningMinutes, listLearning, type LearningRow } from "@/lib/data";
import { addDaysIso, formatDate, today, weekStart } from "@/lib/dates";
import { formatDuration } from "@/lib/duration";

export const dynamic = "force-dynamic";

/** Leren (gesprek 10): leeronderwerpen met voortgang en bestede tijd. */
export default async function LearningPage() {
  const t = today();
  const wk = weekStart(t);
  const [all, lastWeek] = await Promise.all([listLearning(), learningMinutes(addDaysIso(wk, -7), addDaysIso(wk, -1))]);
  const active = all.filter((x) => x.status === "bezig");
  const ideas = all.filter((x) => x.status === "idee" || x.status === "gepauzeerd");
  const done = all.filter((x) => x.status === "afgerond");
  const week = all.reduce((s, x) => s + x.minutesWeek, 0);
  const month = all.reduce((s, x) => s + x.minutesMonth, 0);
  const tiles: Tile[] = [
    { key: "week", label: "Deze week", value: formatDuration(week), sub: `vorige week ${formatDuration(lastWeek)}` },
    { key: "maand", label: "Deze maand", value: formatDuration(month), sub: "uur leren" },
    { key: "bezig", label: "Bezig", value: active.length, sub: active.length === 1 ? "onderwerp" : "onderwerpen" },
    { key: "af", label: "Afgerond", value: done.length, sub: done.filter((x) => x.finishedAt?.startsWith(t.slice(0, 4))).length + " dit jaar" },
  ];

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Leven" title="Leren">
        <Link href="/doelen" className="btn-ghost text-sm">← Doelen</Link>
      </PageHeader>
      <KpiTiles kpis={tiles} />

      <section className="space-y-3">
        <SectionTitle>Bezig</SectionTitle>
        {active.length ? (
          <div className="grid gap-4 lg:grid-cols-2">{active.map((x) => <TopicCard key={x.id} x={x} today={t} />)}</div>
        ) : (
          <p className="text-sm text-steen">Nog niets waar je mee bezig bent. Voeg hieronder een cursus, boek, vaardigheid of certificering toe (bijvoorbeeld de jaarlijkse Wwft-training).</p>
        )}
      </section>

      {ideas.length > 0 && (
        <section className="space-y-3">
          <SectionTitle>Ideeën en gepauzeerd</SectionTitle>
          <ul className="card divide-y divide-lijn">{ideas.map((x) => <TopicLine key={x.id} x={x} />)}</ul>
        </section>
      )}

      <section className="space-y-3">
        <SectionTitle>Nieuw leeronderwerp</SectionTitle>
        <div className="card p-4"><LearningForm /></div>
        <p className="text-xs text-steen">
          Tijd leg je per onderwerp vast (los van de module Uren). Een doel als &ldquo;3 uur per week leren&rdquo; maak je op Doelen met de meetwijze Uren leren.
          Stappen uit je leerplan zijn gewone taken: je plant ze in een leren-blok op Planning.
        </p>
      </section>

      {done.length > 0 && (
        <section className="space-y-3">
          <SectionTitle>Afgerond</SectionTitle>
          <ul className="card divide-y divide-lijn">{done.map((x) => <TopicLine key={x.id} x={x} />)}</ul>
        </section>
      )}
    </div>
  );
}

function TopicCard({ x, today }: { x: LearningRow; today: string }) {
  const hours = x.hoursTarget ? Math.round((x.minutesTotal / 60 / x.hoursTarget) * 100) : null;
  return (
    <article className="card hoeken relative flex flex-col gap-3 p-4">
      <span aria-hidden className="accent absolute left-0 top-0 h-[3px] w-10 bg-nacht" />
      <div className="min-w-0">
        <p className="hud-mono text-[11px] uppercase tracking-[0.14em] text-steen">{x.kindLabel} · {x.area === "prive" ? "privé" : "zakelijk"}{x.targetDate ? ` · af ${formatDate(x.targetDate)}` : ""}</p>
        <Link href={`/leren/${x.id}`} className="mt-0.5 block text-[17px] font-bold leading-snug text-nacht hover:underline">{x.title}</Link>
        {x.goal && <p className="mt-1 text-sm text-steen">{x.goal}</p>}
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="glow hud-mono text-2xl font-bold tabular-nums leading-none text-nacht">{x.pct}%</p>
        <p className="text-right text-xs text-steen">{x.progressLabel}</p>
      </div>
      <GoalProgress pct={x.pct} expectedPct={null} />
      <p className="text-xs text-steen">
        {formatDuration(x.minutesTotal)} uur besteed{x.hoursTarget ? ` van ${x.hoursTarget} (${hours}%)` : ""} · deze week {formatDuration(x.minutesWeek)}
        {x.openSteps ? ` · ${x.openSteps} ${x.openSteps === 1 ? "stap" : "stappen"} open` : ""}
        {x.lastDate ? ` · laatst ${formatDate(x.lastDate)}` : ""}
      </p>
      <LogLearningForm topicId={x.id} today={today} compact />
    </article>
  );
}

function TopicLine({ x }: { x: LearningRow }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
      <Link href={`/leren/${x.id}`} className="min-w-0 flex-1 font-medium text-nacht hover:underline">{x.title}</Link>
      <span className="text-xs text-steen">{x.kindLabel} · {x.statusLabel}{x.finishedAt ? ` ${formatDate(x.finishedAt)}` : ""}</span>
      <span className="hud-mono text-xs tabular-nums text-steen">{x.pct}% · {formatDuration(x.minutesTotal)} uur</span>
    </li>
  );
}
