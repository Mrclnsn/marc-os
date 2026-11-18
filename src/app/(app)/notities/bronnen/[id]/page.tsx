import Link from "next/link";
import { notFound } from "next/navigation";
import { BacklinksPanel, MentionsPanel } from "@/components/brain-parts";
import { AreaSelect, ClientSelect, Field, ProjectSelect } from "@/components/forms";
import { LinkEditor } from "@/components/link-editor";
import { Markdown } from "@/components/markdown";
import { findLearning, getBacklinks, getSource, getUnlinkedMentions, linkSuggestions, resolveLinksIn } from "@/lib/data";
import { AREAS, SOURCE_KIND, SOURCE_STATUS } from "@/lib/labels";
import { formatDate } from "@/lib/dates";
import { getOptions } from "@/lib/options";
import { deleteSourceAction, setSourceStatusAction, updateSourceAction } from "../../../../actions";

export default async function SourcePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ bewerken?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const row = await getSource(id);
  if (!row) notFound();
  const { source: s } = row;
  const learning = s.learningId ? await findLearning(s.learningId) : null;

  if (sp.bewerken !== undefined) {
    const [options, suggestions] = await Promise.all([getOptions(), linkSuggestions()]);
    return (
      <div className="space-y-5">
        <Link href={`/notities/bronnen/${id}`} className="inline-block text-sm text-steen hover:text-nacht">← Annuleren</Link>
        <form action={updateSourceAction.bind(null, id)} className="space-y-4">
          <input type="hidden" name="view" value="1" />
          <input name="title" defaultValue={s.title} required className="input w-full text-lg font-medium" />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Field label="Link" className="col-span-2"><input name="url" defaultValue={s.url ?? ""} className="input w-full" inputMode="url" /></Field>
            <Field label="Maker of site"><input name="author" defaultValue={s.author ?? ""} className="input w-full" /></Field>
            <Field label="Soort">
              <select name="kind" defaultValue={s.kind} className="input w-full">
                {Object.entries(SOURCE_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select name="status" defaultValue={s.status} className="input w-full">
                {Object.entries(SOURCE_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Gebied"><AreaSelect value={s.area} allowEmpty /></Field>
            <Field label="Klant"><ClientSelect clients={options.clients} value={s.clientId} /></Field>
            <Field label="Project"><ProjectSelect projects={options.projects} value={s.projectId} /></Field>
          </div>
          <Field label="Samenvatting"><textarea name="summary" defaultValue={s.summary ?? ""} rows={3} className="input w-full" /></Field>
          <Field label="Eigen aantekeningen"><LinkEditor defaultValue={s.body} suggestions={suggestions} rows={12} /></Field>
          <button className="btn-primary">Opslaan</button>
        </form>
        <form action={deleteSourceAction.bind(null, id)}>
          <button className="btn-ghost text-xs text-nacht">Bron verwijderen</button>
        </form>
      </div>
    );
  }

  const [resolved, backlinks, mentions] = await Promise.all([resolveLinksIn(s.body), getBacklinks("source", id), getUnlinkedMentions("source", id)]);
  const next = s.status === "new" ? "read" : s.status === "read" ? "processed" : null;

  return (
    <div className="space-y-8">
      <Link href="/notities/bronnen" className="inline-block text-sm text-steen hover:text-nacht">← Bronnen</Link>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
        <article className="min-w-0 space-y-5">
          <header className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h1 className="text-3xl font-bold leading-tight tracking-tight text-nacht md:text-4xl">{s.title}</h1>
              <div className="flex gap-2">
                {next && (
                  <form action={setSourceStatusAction.bind(null, id, next)}>
                    <button className="btn">{next === "read" ? "Gelezen" : "Verwerkt"}</button>
                  </form>
                )}
                <Link href={`/notities/bronnen/${id}?bewerken`} className="btn">Bewerken</Link>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-steen">
              <span className="chip">{SOURCE_KIND[s.kind]}</span>
              <span className="chip">{SOURCE_STATUS[s.status]}</span>
              {s.area && <span className="chip">{AREAS[s.area]}</span>}
              {s.clientId && row.clientName && <Link href={`/klanten/${s.clientId}`} className="chip hover:bg-lijn">{row.clientName}</Link>}
              {s.projectId && row.projectName && <Link href={`/projecten/${s.projectId}`} className="chip hover:bg-lijn">◫ {row.projectName}</Link>}
              {learning && <Link href={`/leren/${learning.id}`} className="chip hover:bg-lijn">△ {learning.title}</Link>}
              {s.author && <span>{s.author}</span>}
              <span>Bewaard {formatDate(s.createdAt.toISOString().slice(0, 10))}{s.capturedVia && s.capturedVia !== "app" ? ` via ${s.capturedVia}` : ""}</span>
            </div>
            {s.url && (
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="block break-all text-sm text-nacht underline decoration-steen underline-offset-2">
                {s.url} ↗
              </a>
            )}
            <div className="rule" />
          </header>
          {s.summary && (
            <section className="panel p-4">
              <p className="label">Samenvatting</p>
              <p className="whitespace-pre-wrap text-[15px] text-grafiet">{s.summary}</p>
            </section>
          )}
          {s.body?.trim() ? <Markdown text={s.body} links={resolved} /> : <p className="text-sm text-steen">Nog geen eigen aantekeningen. <Link href={`/notities/bronnen/${id}?bewerken`} className="underline">Schrijf er iets bij</Link>.</p>}
        </article>
        <aside className="space-y-8">
          <BacklinksPanel backlinks={backlinks} />
          <MentionsPanel mentions={mentions} />
        </aside>
      </div>
    </div>
  );
}
