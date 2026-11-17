import { listReviews } from "@/lib/data";
import { formatLong } from "@/lib/dates";

const KIND = { day: "Dag", week: "Week", month: "Maand" } as const;

export default async function ReviewsPage() {
  const rows = await listReviews(undefined, 60);
  return (
    <div className="space-y-5">
      <header>
        <h1 className="h1">Reviews</h1>
        <p className="text-sm text-muted">Briefings, dagafsluitingen en weekreviews. Je AI-assistent schrijft ze hier weg.</p>
      </header>
      {rows.length === 0 && <p className="text-sm text-muted">Nog geen reviews.</p>}
      {rows.map((r) => (
        <article key={r.id} className="card p-4">
          <p className="mb-2 text-xs text-muted">
            <span className="chip mr-2">{KIND[r.kind]}</span>
            <span className="capitalize">{formatLong(r.periodDate)}</span>
          </p>
          <div className="whitespace-pre-wrap text-sm leading-relaxed">{r.body}</div>
        </article>
      ))}
    </div>
  );
}
