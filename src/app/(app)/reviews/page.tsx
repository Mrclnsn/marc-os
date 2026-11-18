import { PageHeader } from "@/components/brand";
import { listReviews } from "@/lib/data";
import { formatLong } from "@/lib/dates";
import { Markdown } from "@/components/markdown";

const KIND = { day: "Dag", week: "Week", month: "Maand" } as const;

export default async function ReviewsPage() {
  const rows = await listReviews(undefined, 60);
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Terugkijken" title="Reviews" />
      <p className="-mt-2 text-[15px] text-grafiet">Briefings, dagafsluitingen, weekreviews en maandafsluitingen. Hermes schrijft ze hier weg (vaste routines op Hermes → Routines).</p>
      {rows.length === 0 && <p className="text-sm text-steen">Nog geen reviews.</p>}
      {rows.map((r) => (
        <article key={r.id} className="card p-4">
          <p className="mb-2 text-xs text-steen">
            <span className="chip mr-2">{KIND[r.kind]}</span>
            <span className="capitalize">{formatLong(r.periodDate)}</span>
          </p>
          <Markdown text={r.body} className="text-sm leading-relaxed" />
        </article>
      ))}
    </div>
  );
}
