import Link from "next/link";
import { notFound } from "next/navigation";
import { BacklinksPanel, MentionsPanel } from "@/components/brain-parts";
import { PageHeader, SectionTitle } from "@/components/brand";
import { GoalProgress } from "@/components/goal-view";
import { DeleteLearning, DeleteSession, LearningForm, LogLearningForm, NotesEditor, ProgressForm, SourceForm, StatusButtons, StepForm } from "@/components/learning-parts";
import { Markdown } from "@/components/markdown";
import { TaskList } from "@/components/task-row";
import { getBacklinks, getLearning, getUnlinkedMentions, linkSuggestions, listGoals, resolveLinksIn, type TaskWithRefs } from "@/lib/data";
import { addDaysIso, formatDate, today } from "@/lib/dates";
import { formatDuration } from "@/lib/duration";

export const dynamic = "force-dynamic";

export default async function LearningTopicPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ bewerk?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const x = await getLearning(id);
  if (!x) notFound();
  const t = today();
  const [backlinks, mentions, links, suggestions, goals] = await Promise.all([
    getBacklinks("learning", id),
    getUnlinkedMentions("learning", id),
    resolveLinksIn(x.notes),
    linkSuggestions(),
    listGoals(),
  ]);
  const linkedGoals = goals.filter((g) => g.learningId === id || (g.source === "learning_hours" && !g.learningId));
  const steps: TaskWithRefs[] = x.steps.map((s) => ({ ...s, clientName: null, projectName: null }));
  const open = steps.filter((s) => s.status !== "done");
  const doneSteps = steps.filter((s) => s.status === "done");
  const area = x.area as "zakelijk" | "prive";
  const editing = sp.bewerk === "1";

  return (
    <div className="space-y-8">
      <Link href="/leren" className="inline-block text-sm text-steen hover:text-nacht">← Leren</Link>
      <PageHeader eyebrow={`${x.kindLabel} · ${x.statusLabel}${x.targetDate ? ` · af willen hebben ${formatDate(x.targetDate)}` : ""}`} title={x.title}>
        <StatusButtons id={x.id} status={x.status} />
      </PageHeader>

      <section className="card hoeken relative space-y-4 p-5">
        <span aria-hidden className="accent absolute left-0 top-0 h-[3px] w-16 bg-nacht" />
        {x.goal && <p className="text-grafiet"><span className="label inline">Doel </span>{x.goal}</p>}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <p className="glow hud-mono text-4xl font-bold tabular-nums leading-none text-nacht">{x.pct}%</p>
          <p className="text-right text-sm text-steen">{x.progressLabel}</p>
        </div>
        <GoalProgress pct={x.pct} expectedPct={null} />
        <ProgressForm id={x.id} unit={x.progressUnit} total={x.progressTotal} done={x.progressDone} />
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 border-t border-lijn pt-3 text-sm sm:grid-cols-4">
          <div><dt className="label">Besteed</dt><dd>{formatDuration(x.minutesTotal)} uur{x.hoursTarget ? ` van ${x.hoursTarget}` : ""}</dd></div>
          <div><dt className="label">Deze week</dt><dd>{formatDuration(x.minutesWeek)} uur</dd></div>
          <div><dt className="label">Gestart</dt><dd>{x.startDate ? formatDate(x.startDate) : "–"}</dd></div>
          <div><dt className="label">Link</dt><dd className="truncate">{x.url ? <a href={x.url} target="_blank" rel="noreferrer" className="underline">{x.url.replace(/^https?:\/\/(www\.)?/, "")}</a> : "–"}</dd></div>
        </dl>
        {linkedGoals.length > 0 && (
          <p className="border-t border-lijn pt-3 text-xs text-steen">
            Telt mee voor: {linkedGoals.map((g, i) => <span key={g.id}>{i ? ", " : ""}<Link href={`/doelen/${g.id}`} className="underline">{g.title}</Link></span>)}
          </p>
        )}
      </section>

      <section className="space-y-3">
        <SectionTitle>Tijd</SectionTitle>
        <div className="card p-4"><LogLearningForm topicId={x.id} today={t} /></div>
        {x.sessions.length > 0 && (
          <ul className="card divide-y divide-lijn">
            {x.sessions.slice(0, 20).map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-2">
                <span className="hud-mono w-28 text-xs text-steen">{formatDate(s.date)}</span>
                <span className="hud-mono w-14 font-bold tabular-nums text-nacht">{formatDuration(s.minutes)}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-steen">{[s.note, s.source !== "app" ? `via ${s.source}` : null].filter(Boolean).join(" · ")}</span>
                <DeleteSession id={s.id} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <SectionTitle aside={<span className="text-xs text-steen">{doneSteps.length} van {steps.length} klaar</span>}>Leerplan</SectionTitle>
        <div className="card">
          <TaskList tasks={open} today={t} tomorrow={addDaysIso(t, 1)} empty="Nog geen open stappen." showClient={false} showProject={false} />
        </div>
        <div className="card p-4"><StepForm topicId={x.id} area={area} /></div>
        {doneSteps.length > 0 && (
          <details>
            <summary className="cursor-pointer text-xs text-steen hover:text-nacht">{doneSteps.length} afgeronde {doneSteps.length === 1 ? "stap" : "stappen"}</summary>
            <ul className="mt-2 space-y-1 text-sm text-steen">{doneSteps.map((s) => <li key={s.id} className="line-through"><Link href={`/taken/${s.id}`}>{s.title}</Link></li>)}</ul>
          </details>
        )}
      </section>

      <section className="space-y-3">
        <SectionTitle>Bronnen</SectionTitle>
        {x.sources.length > 0 && (
          <ul className="card divide-y divide-lijn">
            {x.sources.map((s) => (
              <li key={s.id} className="px-4 py-2.5">
                <Link href={`/notities/bronnen/${s.id}`} className="font-medium text-nacht hover:underline">{s.title}</Link>
                {s.summary && <p className="line-clamp-2 text-xs text-steen">{s.summary}</p>}
              </li>
            ))}
          </ul>
        )}
        <div className="card p-4"><SourceForm topicId={x.id} area={area} /></div>
      </section>

      <section className="space-y-3">
        <SectionTitle aside={<Link href={`/notities/nieuw?titel=${encodeURIComponent(`${x.title}: `)}&tekst=${encodeURIComponent(`[[leren:${x.title}]]\n\n`)}`} className="btn-ghost text-xs">+ Notitie</Link>}>Aantekeningen</SectionTitle>
        {x.notes && !editing ? (
          <div className="card space-y-3 p-4">
            <Markdown text={x.notes} links={links} />
            <Link href={`/leren/${x.id}?bewerk=1`} className="btn-ghost text-xs">Bewerken</Link>
          </div>
        ) : (
          <div className="card space-y-2 p-4">
            <NotesEditor id={x.id} notes={x.notes} suggestions={suggestions} />
            {editing && <Link href={`/leren/${x.id}`} className="btn-ghost text-xs">Klaar met bewerken</Link>}
          </div>
        )}
        <BacklinksPanel backlinks={backlinks} title="Notities over dit onderwerp" empty={`Nog geen notities die linken naar [[leren:${x.title}]].`} />
        {mentions.length > 0 && <MentionsPanel mentions={mentions} />}
      </section>

      <section className="space-y-3">
        <SectionTitle>Bewerken</SectionTitle>
        <div className="card p-4">
          <LearningForm id={x.id} topic={x} />
        </div>
        <DeleteLearning id={x.id} title={x.title} />
      </section>
    </div>
  );
}
