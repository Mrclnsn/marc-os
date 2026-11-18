import Link from "next/link";
import { PageHeader, SectionTitle } from "@/components/brand";
import { ApproveAllButton, HermesChat, ProposalCard } from "@/components/hermes-parts";
import { loadThreadAction, toView } from "@/app/hermes-actions";
import { hermesStatus } from "@/lib/hermes";
import * as agent from "@/lib/agent";
import { listRuns, routineStatuses } from "@/lib/routines";
import { ROUTINES, type RoutineKey } from "@/lib/routines-shared";
import { whatsappStatus } from "@/lib/whatsapp";
import { RoutineControls } from "@/components/routine-parts";

const TABS = [
  { key: "chat", label: "Chat" },
  { key: "akkoord", label: "Akkoord" },
  { key: "routines", label: "Routines" },
  { key: "logboek", label: "Logboek" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const KIND_LABEL: Record<string, string> = {
  read: "gelezen",
  direct: "direct",
  proposed: "voorstel",
  approved: "akkoord",
  rejected: "afgewezen",
  withdrawn: "ingetrokken",
  executed: "uitgevoerd",
  failed: "mislukt",
  chat: "chat",
  routine: "routine",
  whatsapp: "whatsapp",
};
const ACTOR_LABEL: Record<string, string> = { hermes: "Hermes", claude: "Claude", marc: "Marc" };

const fmt = (d: Date) => new Intl.DateTimeFormat("nl-NL", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" }).format(d);

export default async function HermesPage({ searchParams }: { searchParams: Promise<{ tab?: string; thread?: string; wie?: string; lezen?: string }> }) {
  const sp = await searchParams;
  const tab: Tab = (TABS.find((t) => t.key === sp.tab)?.key ?? "chat") as Tab;
  const [status, pending] = await Promise.all([hermesStatus(), agent.pendingCount()]);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="AI-assistent" title="Hermes">
        <span className="flex items-center gap-2 text-sm text-steen">
          <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${status.online ? "bg-nacht" : "border border-steen"}`} />
          {status.online ? "online" : status.configured ? "offline" : "nog niet geïnstalleerd"}
        </span>
      </PageHeader>

      <nav className="flex gap-5 border-b border-lijn">
        {TABS.map((t) => (
          <Link key={t.key} href={`/hermes?tab=${t.key}`} className={tab === t.key ? "tab-active" : "tab"}>
            {t.label}
            {t.key === "akkoord" && pending > 0 ? ` (${pending})` : ""}
          </Link>
        ))}
      </nav>

      {tab === "chat" && <ChatTab threadId={sp.thread} status={status} />}
      {tab === "akkoord" && <QueueTab />}
      {tab === "routines" && <RoutinesTab />}
      {tab === "logboek" && <LogTab who={sp.wie} withReads={sp.lezen === "1"} />}

      {!status.configured && (
        <p className="max-w-2xl text-sm text-steen">
          Hermes installeren: op de VPS <code className="chip">bash /opt/marc-os/scripts/hermes-setup.sh</code>. Het script vraagt om een Anthropic API-sleutel en zet Hermes naast de app.
        </p>
      )}
    </div>
  );
}

async function ChatTab({ threadId, status }: { threadId?: string; status: { configured: boolean; online: boolean } }) {
  const [initial, threads] = await Promise.all([loadThreadAction(threadId), agent.listThreads(20)]);
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
      <div className="card min-w-0 p-4">
        <HermesChat initial={initial} status={status} />
      </div>
      <aside className="space-y-2">
        <SectionTitle>Gesprekken</SectionTitle>
        <Link href="/hermes?tab=chat&thread=nieuw" className="btn-ghost -ml-2 text-sm">
          + Nieuw gesprek
        </Link>
        <ul className="space-y-0.5">
          {threads.map((t) => (
            <li key={t.id}>
              <Link
                href={`/hermes?thread=${t.id}`}
                className={`block truncate rounded-sm px-2 py-1.5 text-sm hover:bg-parel ${t.id === initial.threadId ? "font-bold text-nacht" : "text-grafiet"}`}
              >
                {t.title}
                <span className="block text-[11px] font-normal text-steen">{fmt(t.updatedAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

async function QueueTab() {
  const [open, decided] = await Promise.all([agent.listProposals({ status: "pending", limit: 50 }), agent.listProposals({ status: "decided", limit: 30 })]);
  const openViews = await Promise.all(open.map(toView));
  const decidedViews = await Promise.all(decided.map(toView));
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <SectionTitle aside={<ApproveAllButton count={open.length} />}>Wacht op akkoord</SectionTitle>
        {openViews.length === 0 ? (
          <p className="text-sm text-steen">Niets om goed te keuren. Wat Hermes voorstelt, verschijnt hier en in de chat.</p>
        ) : (
          <div className="space-y-3">
            {openViews.map((p) => (
              <ProposalCard key={p.id} proposal={p} />
            ))}
          </div>
        )}
      </section>
      <section className="space-y-3">
        <SectionTitle>Afgehandeld</SectionTitle>
        {decidedViews.length === 0 ? (
          <p className="text-sm text-steen">Nog niets afgehandeld.</p>
        ) : (
          <div className="space-y-2">
            {decidedViews.map((p) => (
              <ProposalCard key={p.id} proposal={p} compact />
            ))}
          </div>
        )}
      </section>
      <p className="text-sm text-steen">
        Welke acties Hermes zonder akkoord mag doen, stel je in op <Link href="/instellingen#hermes" className="underline">Instellingen → Hermes</Link>.
      </p>
    </div>
  );
}

async function LogTab({ who, withReads }: { who?: string; withReads: boolean }) {
  const actor = who === "hermes" || who === "claude" || who === "marc" ? who : undefined;
  const kinds = withReads ? undefined : (["direct", "proposed", "approved", "rejected", "withdrawn", "executed", "failed", "chat", "routine", "whatsapp"] as agent.LogKind[]);
  const rows = await agent.listLog({ limit: 200, actor, kinds });
  const link = (w?: string, r = withReads) => `/hermes?tab=logboek${w ? `&wie=${w}` : ""}${r ? "&lezen=1" : ""}`;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {[undefined, "hermes", "claude", "marc"].map((w) => (
          <Link key={w ?? "alle"} href={link(w)} className={actor === w ? "chip font-bold" : "btn-ghost"}>
            {w ? ACTOR_LABEL[w] : "Iedereen"}
          </Link>
        ))}
        <span className="mx-2 h-4 w-px bg-lijn" />
        <Link href={link(actor, !withReads)} className="btn-ghost">
          {withReads ? "Zonder leesacties" : "Ook leesacties"}
        </Link>
      </div>
      <p className="text-xs text-steen">Wie deed wat en wanneer: voorstellen, akkoorden, uitvoeren, directe acties en chats. Bewaard voor ISO 27001 (ruim een jaar).</p>
      {rows.length === 0 ? (
        <p className="text-sm text-steen">Nog niets in het logboek.</p>
      ) : (
        <ul className="card divide-y divide-lijn">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2 text-sm">
              <span className="w-36 shrink-0 text-xs text-steen">{fmt(r.at)}</span>
              <span className="w-16 shrink-0 text-xs font-bold text-nacht">{ACTOR_LABEL[r.actor] ?? r.actor}</span>
              <span className="chip shrink-0">{KIND_LABEL[r.kind] ?? r.kind}</span>
              <span className="min-w-0 flex-1 break-words text-grafiet">{r.summary}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const RUN_STATUS: Record<string, string> = { running: "bezig", ok: "klaar", failed: "mislukt" };

async function RoutinesTab() {
  const [statuses, runs, wa] = await Promise.all([routineStatuses(), listRuns({ limit: 25 }), whatsappStatus()]);
  const waReady = wa.configured;
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <SectionTitle aside={<span className="text-xs text-steen">elke 5 minuten gecontroleerd</span>}>Vaste routines</SectionTitle>
        <p className="max-w-3xl text-sm text-steen">
          Hermes schrijft de tekst met de gegevens uit Marc OS; Marc OS slaat hem op bij Reviews en stuurt hem naar WhatsApp en/of als pushmelding. Wijzigingen (dagindeling, taken
          verschuiven) komen als voorstel in de akkoordwachtrij, met een nummer zodat je in WhatsApp met ja of nee kunt antwoorden. Werkdagen volgen je dagritme: op een vrije dag geen
          briefing. Was de VPS even weg, dan loopt een routine tot 3 uur later alsnog.
        </p>
        <div className="space-y-3">
          {statuses.map((r) => (
            <div key={r.key} className="card p-4">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <div className="min-w-0">
                  <p className="font-bold text-nacht">{r.label}</p>
                  <p className="text-sm text-steen">{r.description}</p>
                </div>
                <RunBadge current={r.current} blocked={r.blocked} enabled={r.setting.enabled} />
              </div>
              <RoutineControls routineKey={r.key} setting={r.setting} whatsappReady={waReady} blocked={r.blocked} />
              {r.current?.error && <p className="mt-2 text-sm font-bold text-nacht">Fout: {r.current.error}</p>}
              {r.current?.summary && r.current.status === "ok" && <p className="mt-2 truncate text-sm text-grafiet">{r.current.summary}</p>}
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <SectionTitle>Laatste runs</SectionTitle>
        {runs.length === 0 ? (
          <p className="text-sm text-steen">Nog geen routines gelopen.</p>
        ) : (
          <ul className="card divide-y divide-lijn">
            {runs.map((run) => (
              <li key={run.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2 text-sm">
                <span className="w-36 shrink-0 text-xs text-steen">{fmt(run.startedAt)}</span>
                <span className="w-32 shrink-0 font-bold text-nacht">{ROUTINES[run.routine as RoutineKey]?.label ?? run.routine}</span>
                <span className={`chip shrink-0 ${run.status === "failed" ? "font-bold" : ""}`}>{RUN_STATUS[run.status] ?? run.status}</span>
                <span className="min-w-0 flex-1 truncate text-grafiet">
                  {run.status === "failed" ? run.error : run.summary}
                  {run.proposalIds?.length ? ` · ${run.proposalIds.length} voorstel${run.proposalIds.length === 1 ? "" : "len"}` : ""}
                </span>
                <span className="text-xs text-steen">
                  {run.trigger === "manual" ? "handmatig" : "gepland"}
                  {run.delivered?.whatsapp ? ` · WhatsApp ${run.delivered.whatsapp}` : ""}
                  {run.finishedAt ? ` · ${Math.max(1, Math.round((run.finishedAt.getTime() - run.startedAt.getTime()) / 1000))} s` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <SectionTitle>WhatsApp</SectionTitle>
        {wa.configured ? (
          <p className="text-sm text-grafiet">
            Hermes is bereikbaar via WhatsApp voor {wa.number}. Status: <strong className="text-nacht">{WA_STATE[wa.state ?? ""] ?? wa.state ?? "onbekend"}</strong>
            {wa.error ? ` (${wa.error})` : ""}. Antwoord op voorstellen met <code className="chip">ja</code>, <code className="chip">ja 12</code>, <code className="chip">ja alles</code>,{" "}
            <code className="chip">nee 12: reden</code> of <code className="chip">pas aan 12: ...</code>.
          </p>
        ) : (
          <p className="text-sm text-steen">
            Nog niet gekoppeld. Regel een apart nummer voor Hermes (bijv. prepaid) en draai op de VPS <code className="chip">bash /opt/marc-os/scripts/whatsapp-setup.sh</code>. Tot
            die tijd gaan de routines als pushmelding en staan ze bij Reviews.
          </p>
        )}
      </section>
    </div>
  );
}

const WA_STATE: Record<string, string> = { connected: "verbonden", disconnected: "niet verbonden", connecting: "verbinden…", error: "fout" };

function RunBadge({ current, blocked, enabled }: { current: { status: string; at: string; proposals: number } | null; blocked: string | null; enabled: boolean }) {
  const label = !enabled
    ? "uit"
    : blocked
      ? blocked
      : current
        ? `${RUN_STATUS[current.status] ?? current.status} ${new Intl.DateTimeFormat("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" }).format(new Date(current.at))}${current.proposals ? ` · ${current.proposals} voorstel${current.proposals === 1 ? "" : "len"}` : ""}`
        : "nog niet gelopen deze periode";
  return <span className={`hud-mono shrink-0 text-[10px] uppercase tracking-[0.12em] ${current?.status === "failed" ? "font-bold text-nacht" : "text-steen"}`}>{label}</span>;
}
