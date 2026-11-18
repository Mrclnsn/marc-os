import Link from "next/link";
import { PageHeader, SectionTitle } from "@/components/brand";
import { ApproveAllButton, HermesChat, ProposalCard } from "@/components/hermes-parts";
import { loadThreadAction, toView } from "@/app/hermes-actions";
import { hermesStatus } from "@/lib/hermes";
import * as agent from "@/lib/agent";

const TABS = [
  { key: "chat", label: "Chat" },
  { key: "akkoord", label: "Akkoord" },
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
  const kinds = withReads ? undefined : (["direct", "proposed", "approved", "rejected", "withdrawn", "executed", "failed", "chat"] as agent.LogKind[]);
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
