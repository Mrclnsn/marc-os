import Link from "next/link";
import { PageHeader, SectionTitle } from "@/components/brand";
import { PlanningTabs } from "@/components/planning-nav";
import { BlockRow, DeleteRhythmButton, NewBlockForm, RhythmForm } from "@/components/rhythm-parts";
import { deleteOverrideAction } from "@/app/leven-actions";
import { listOverrides, listRhythms } from "@/lib/data";
import { formatLong, today } from "@/lib/dates";
import { formatDuration } from "@/lib/duration";
import { toMin, weekdaysLabel } from "@/lib/rhythm-shared";

export const dynamic = "force-dynamic";

/** Dagritmes beheren: sjablonen (werkdag, vrijdag, weekend) met vaste blokken en herinneringen. */
export default async function RhythmPage() {
  const [rhythms, overrides] = await Promise.all([listRhythms(), listOverrides(today())]);
  const free = [1, 2, 3, 4, 5, 6, 7].filter((d) => !rhythms.some((r) => r.weekdays.includes(d)));

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Planning" title="Dagritme" />
      <PlanningTabs active="dagritme" />

      <p className="max-w-3xl text-[15px] text-grafiet">
        Een dagritme is je ideale dag als sjabloon: vaste blokken voor dagstart, diep werk, administratie, sport, pauze en dagafsluiting.
        In de planning zet je taken in een blok. Blokken met een herinnering geven een pushmelding op je telefoon bij het begin.
      </p>
      {free.length > 0 && <p className="text-sm text-steen">Zonder ritme: {weekdaysLabel(free)}. Die dagen hebben geen blokken en geen werkdag.</p>}

      {rhythms.map((r) => {
        const plannable = r.blocks.reduce((s, b) => s + (toMin(b.endTime) - toMin(b.startTime)), 0);
        return (
          <section key={r.id} className="space-y-3">
            <SectionTitle aside={<span className="text-xs text-steen">{weekdaysLabel(r.weekdays)} · {r.blocks.length} blokken · {formatDuration(plannable)}</span>}>{r.name}</SectionTitle>
            <div className="card divide-y divide-lijn">
              <div className="p-4">
                <RhythmForm rhythm={{ id: r.id, name: r.name, weekdays: r.weekdays, workStart: r.workStart, workEnd: r.workEnd }} />
              </div>
              <ul className="divide-y divide-lijn">
                {r.blocks.map((b) => (
                  <BlockRow
                    key={b.id}
                    rhythmId={r.id}
                    rhythms={rhythms.map((x) => ({ id: x.id, name: x.name }))}
                    block={{ id: b.id, title: b.title, kind: b.kind, area: b.area, startTime: b.startTime, endTime: b.endTime, remind: b.remind, remindBefore: b.remindBefore }}
                  />
                ))}
              </ul>
              <NewBlockForm rhythmId={r.id} />
              <div className="flex justify-end px-4 py-2">
                <DeleteRhythmButton id={r.id} name={r.name} />
              </div>
            </div>
          </section>
        );
      })}

      <section className="space-y-3">
        <SectionTitle>Nieuw dagritme</SectionTitle>
        <div className="card p-4">
          <RhythmForm />
        </div>
      </section>

      <section className="space-y-3">
        <SectionTitle>Afwijkende dagen</SectionTitle>
        {overrides.length === 0 ? (
          <p className="text-sm text-steen">Geen. Een ander ritme voor één dag (vrije dag, werken op zaterdag) kies je in de dagweergave van <Link href="/planning" className="underline decoration-lijn underline-offset-2 hover:decoration-nacht">Planning</Link>.</p>
        ) : (
          <ul className="card divide-y divide-lijn">
            {overrides.map((o) => (
              <li key={o.date} className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
                <Link href={`/planning?datum=${o.date}`} className="capitalize text-grafiet hover:text-nacht">{formatLong(o.date)}</Link>
                <span className="text-steen">{o.name ?? "Vrije dag"}{o.note ? ` · ${o.note}` : ""}</span>
                <form action={deleteOverrideAction.bind(null, o.date)}>
                  <button className="btn-ghost text-xs">Terug naar standaard</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
