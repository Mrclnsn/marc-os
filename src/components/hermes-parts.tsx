"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  approveAllAction,
  approveProposalAction,
  editProposalAction,
  loadThreadAction,
  rejectProposalAction,
  setAutoToolAction,
  type ChatMessageView,
  type ProposalView,
} from "@/app/hermes-actions";
import { Markdown } from "./markdown";
import { Switch } from "./settings-parts";
import { Beeldmerk } from "./brand";

/* ---------------- Voorstel ---------------- */

const STATUS: Record<string, string> = {
  pending: "wacht op akkoord",
  running: "bezig",
  executed: "uitgevoerd",
  failed: "mislukt",
  rejected: "afgewezen",
  withdrawn: "ingetrokken",
};

const fmtTime = (iso: string) =>
  new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" }).format(new Date(iso));

function argValue(v: unknown): string {
  if (v === null) return "leeg";
  if (typeof v === "boolean") return v ? "ja" : "nee";
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v);
  return s.length > 160 ? `${s.slice(0, 159)}…` : s;
}

/** Eén voorstel van Hermes met Akkoord, Afwijzen en (voor gevorderden) Aanpassen. */
export function ProposalCard({ proposal, via = "app", compact = false }: { proposal: ProposalView; via?: "app" | "chat" | "cockpit"; compact?: boolean }) {
  const [p, setP] = useState(proposal);
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"view" | "reject" | "edit">("view");
  const [note, setNote] = useState("");
  const [json, setJson] = useState(() => JSON.stringify(proposal.args, null, 2));
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  // Nieuwe gegevens van de server (na verversen) overnemen
  const [prev, setPrev] = useState(proposal);
  if (proposal !== prev) {
    setPrev(proposal);
    setP(proposal);
  }

  const open = p.status === "pending";
  const entries = Object.entries(p.args).filter(([, v]) => v !== undefined);

  const approve = () =>
    start(async () => {
      setError(null);
      const r = await approveProposalAction(p.id, via);
      if (r.proposal) setP(r.proposal);
      if (!r.ok) setError(r.error ?? "Mislukt");
      router.refresh();
    });
  const reject = () =>
    start(async () => {
      const r = await rejectProposalAction(p.id, note, via);
      if (r) setP(r);
      setMode("view");
      router.refresh();
    });
  const saveEdit = () =>
    start(async () => {
      setError(null);
      const r = await editProposalAction(p.id, json);
      if (!r.ok) setError(r.error ?? "Mislukt");
      else if (r.proposal) {
        setP(r.proposal);
        setMode("view");
      }
    });

  return (
    <div className={`relative rounded-sm border ${open ? "border-nacht" : "border-lijn"} bg-vlak ${pending ? "opacity-70" : ""}`}>
      {open && <span aria-hidden className="accent absolute inset-y-0 left-0 w-[3px] bg-nacht" />}
      <div className={compact ? "px-3 py-2.5" : "px-4 py-3"}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="min-w-0 font-bold leading-snug text-nacht">
            <span className="hud-mono mr-1.5 text-xs font-normal text-steen">#{p.nr}</span>
            {p.title}
          </p>
          <span className={`hud-mono shrink-0 text-[10px] uppercase tracking-[0.12em] ${p.status === "failed" ? "font-bold text-nacht" : "text-steen"}`}>
            {STATUS[p.status] ?? p.status}
            {p.edited ? " · aangepast" : ""}
          </span>
        </div>
        {p.reason && <p className="mt-1 text-sm text-grafiet">{p.reason}</p>}
        {!compact && entries.length > 0 && mode !== "edit" && (
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
            {entries.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-steen">{k}</dt>
                <dd className="min-w-0 break-words text-grafiet">{argValue(v)}</dd>
              </div>
            ))}
          </dl>
        )}
        <p className="mt-1 text-[11px] text-steen">
          {p.tool} · {fmtTime(p.createdAt)}
          {p.decidedAt && !open ? ` · besloten ${fmtTime(p.decidedAt)}${p.decidedVia === "whatsapp" ? " via WhatsApp" : ""}` : ""}
          {p.decisionNote ? ` · ${p.decisionNote}` : ""}
        </p>
        {p.status === "failed" && p.error && <p className="mt-1 text-sm font-bold text-nacht">Fout: {p.error}</p>}
        {error && p.status !== "failed" && <p className="mt-1 text-sm font-bold text-nacht">{error}</p>}

        {open && mode === "view" && (
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <button type="button" className="btn-primary" disabled={pending} onClick={approve}>
              Akkoord
            </button>
            <button type="button" className="btn" disabled={pending} onClick={() => setMode("reject")}>
              Afwijzen
            </button>
            {!compact && (
              <button type="button" className="btn-ghost text-xs" disabled={pending} onClick={() => setMode("edit")}>
                Aanpassen
              </button>
            )}
          </div>
        )}
        {open && mode === "reject" && (
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <input className="input flex-1 text-sm" placeholder="Reden voor Hermes (mag leeg)" value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
            <button type="button" className="btn" disabled={pending} onClick={reject}>
              Afwijzen
            </button>
            <button type="button" className="btn-ghost text-xs" onClick={() => setMode("view")}>
              Terug
            </button>
          </div>
        )}
        {open && mode === "edit" && (
          <div className="mt-2.5 space-y-2">
            <textarea className="input h-40 w-full font-mono text-xs" value={json} onChange={(e) => setJson(e.target.value)} spellCheck={false} />
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn" disabled={pending} onClick={saveEdit}>
                Opslaan
              </button>
              <button type="button" className="btn-ghost text-xs" onClick={() => setMode("view")}>
                Terug
              </button>
            </div>
            <p className="text-xs text-steen">De velden zoals Marc OS ze uitvoert. Na opslaan nog op Akkoord tikken.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export function ApproveAllButton({ count }: { count: number }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  if (count < 2) return null;
  return (
    <span className="flex items-center gap-3">
      {msg && <span className="text-xs text-steen">{msg}</span>}
      <button
        type="button"
        className="btn"
        disabled={pending}
        onClick={() => {
          if (!confirm(`Alle ${count} voorstellen goedkeuren en uitvoeren?`)) return;
          start(async () => {
            const r = await approveAllAction();
            setMsg(`${r.executed} uitgevoerd${r.failed ? `, ${r.failed} mislukt` : ""}`);
            router.refresh();
          });
        }}
      >
        Alles akkoord
      </button>
    </span>
  );
}

export function AutoToolSwitch({ tool, on, label, disabled }: { tool: string; on: boolean; label: string; disabled?: boolean }) {
  const [value, setValue] = useState(on);
  const [pending, start] = useTransition();
  return (
    <span className={pending ? "opacity-60" : ""}>
      <Switch
        on={value}
        label={label}
        disabled={disabled}
        onChange={(next) =>
          start(async () => {
            setValue(next);
            await setAutoToolAction(tool, next);
          })
        }
      />
    </span>
  );
}

/* ---------------- Chat ---------------- */

type Msg = ChatMessageView & { streaming?: boolean; liveTools?: string[] };

const TOOL_LABEL: Record<string, string> = {
  get_overview: "dagoverzicht",
  list_tasks: "taken",
  get_day_plan: "dagplanning",
  get_week_plan: "weekplanning",
  search_knowledge: "second brain",
  list_habits: "gewoontes",
  get_health: "gezondheid",
  list_goals: "doelen",
  get_calendar: "agenda",
  list_proposals: "voorstellen",
};
const toolLabel = (t: string) => TOOL_LABEL[t] ?? t.replace(/_/g, " ");

const SUGGESTIONS = ["Wat staat er vandaag op de planning?", "Zet in de inbox: offerte Vobis nabellen", "Plan mijn belangrijkste taak in het eerste blok diep werk"];

export function HermesChat({
  initial,
  compact = false,
  status,
  onThread,
}: {
  initial: { threadId: string | null; messages: ChatMessageView[] };
  compact?: boolean;
  status: { configured: boolean; online: boolean };
  onThread?: (id: string | null) => void;
}) {
  const [threadId, setThreadId] = useState(initial.threadId);
  const [messages, setMessages] = useState<Msg[]>(initial.messages);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);
  const router = useRouter();

  // Alleen overnemen als er een ander gesprek is gekozen; bij verversen van de pagina blijft de chat staan
  const lastInitial = useRef(initial.threadId);
  useEffect(() => {
    if (initial.threadId === lastInitial.current) return;
    lastInitial.current = initial.threadId;
    if (initial.threadId && initial.threadId === threadId) return;
    setThreadId(initial.threadId);
    setMessages(initial.messages);
  }, [initial, threadId]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setInput("");
    setBusy(true);
    const now = new Date().toISOString();
    const tempId = `tmp-${Date.now()}`;
    setMessages((m) => [
      ...m,
      { id: `${tempId}-u`, role: "user", content: message, tools: [], error: null, proposals: [], createdAt: now },
      { id: tempId, role: "assistant", content: "", tools: [], error: null, proposals: [], createdAt: now, streaming: true, liveTools: [] },
    ]);
    const patch = (fn: (m: Msg) => Msg) => setMessages((all) => all.map((m) => (m.id === tempId ? fn(m) : m)));

    abort.current = new AbortController();
    try {
      const res = await fetch("/api/hermes/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId, message }),
        signal: abort.current.signal,
      });
      if (!res.ok || !res.body) throw new Error(res.status === 401 ? "Je bent uitgelogd." : `Fout ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line);
          if (ev.type === "thread") {
            setThreadId(ev.threadId);
            onThread?.(ev.threadId);
          } else if (ev.type === "delta") patch((m) => ({ ...m, content: m.content + ev.text }));
          else if (ev.type === "tool") patch((m) => ({ ...m, liveTools: [...(m.liveTools ?? []), ev.name] }));
          else if (ev.type === "error") patch((m) => ({ ...m, error: ev.message }));
          else if (ev.type === "done")
            patch((m) => ({ ...m, id: ev.messageId, content: ev.text || m.content, tools: ev.tools ?? [], proposals: (ev.proposals ?? []).map(toClientProposal), error: ev.error ?? m.error, streaming: false }));
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") patch((m) => ({ ...m, error: (e as Error).message, streaming: false }));
    } finally {
      patch((m) => ({ ...m, streaming: false }));
      setBusy(false);
      abort.current = null;
      router.refresh();
    }
  };

  const newThread = () => {
    abort.current?.abort();
    setThreadId(null);
    setMessages([]);
    onThread?.(null);
  };

  const offline = !status.configured ? "Hermes is nog niet geïnstalleerd op de VPS (bash /opt/marc-os/scripts/hermes-setup.sh)." : !status.online ? "Hermes reageert nu niet. Je bericht wordt wel geprobeerd." : null;

  return (
    <div className={`flex min-h-0 flex-col ${compact ? "h-full" : "h-[min(72dvh,760px)]"}`}>
      <div className="flex items-center justify-between gap-3 border-b border-lijn pb-2">
        <span className="flex items-center gap-2 text-xs text-steen">
          <span aria-hidden className={`h-2 w-2 rounded-full ${status.online ? "bg-nacht" : "border border-steen"}`} />
          {status.online ? "Hermes online" : status.configured ? "Hermes offline" : "Hermes niet ingesteld"}
        </span>
        <span className="flex items-center gap-2">
          {compact && threadId && (
            <Link href={`/hermes?thread=${threadId}`} className="btn-ghost text-xs">
              Volledig
            </Link>
          )}
          <button type="button" className="btn-ghost text-xs" onClick={newThread} disabled={busy && !abort.current}>
            Nieuw gesprek
          </button>
        </span>
      </div>

      <div ref={scroller} className="min-h-0 flex-1 space-y-4 overflow-y-auto py-4">
        {offline && <p className="rounded-sm border border-lijn bg-parel px-3 py-2 text-sm text-grafiet">{offline}</p>}
        {messages.length === 0 && (
          <div className="space-y-3 px-1">
            <p className="text-sm text-steen">Vraag Hermes iets over je dag, taken, doelen of notities. Wat iets verandert, komt hier als voorstel om goed te keuren.</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="btn text-left text-xs font-normal" onClick={() => send(s)} disabled={busy}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="flex justify-end">
              <p className="max-w-[85%] whitespace-pre-wrap rounded-sm bg-nacht px-3 py-2 text-[15px] text-op-nacht">{m.content}</p>
            </div>
          ) : (
            <div key={m.id} className="space-y-2">
              {(m.streaming ? m.liveTools ?? [] : m.tools).length > 0 && (
                <p className="hud-mono text-[10px] uppercase tracking-[0.12em] text-steen">
                  {m.streaming ? "bezig met " : "gebruikt: "}
                  {(m.streaming ? m.liveTools ?? [] : m.tools).map(toolLabel).join(" · ")}
                </p>
              )}
              {m.content ? <Markdown text={m.content} /> : m.streaming ? <p className="animate-pulse text-sm text-steen">Hermes denkt na…</p> : null}
              {m.error && <p className="text-sm font-bold text-nacht">{m.error}</p>}
              {m.proposals.length > 0 && (
                <div className="space-y-2">
                  {m.proposals.map((p) => (
                    <ProposalCard key={p.id} proposal={p} via="chat" compact={compact} />
                  ))}
                </div>
              )}
            </div>
          ),
        )}
      </div>

      <form
        className="flex items-end gap-2 border-t border-lijn pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <textarea
          className="input max-h-40 min-h-[44px] flex-1 resize-none"
          rows={1}
          placeholder="Bericht aan Hermes"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send(input);
            }
          }}
        />
        {busy ? (
          <button type="button" className="btn" onClick={() => abort.current?.abort()}>
            Stop
          </button>
        ) : (
          <button className="btn-primary" disabled={!input.trim()}>
            Stuur
          </button>
        )}
      </form>
    </div>
  );
}

function toClientProposal(p: Record<string, unknown>): ProposalView {
  return {
    id: p.id as string,
    nr: Number(p.nr ?? 0),
    tool: p.tool as string,
    title: p.title as string,
    reason: (p.reason as string) ?? null,
    status: p.status as string,
    edited: !!p.edited,
    error: (p.error as string) ?? null,
    decisionNote: (p.decisionNote as string) ?? null,
    decidedVia: (p.decidedVia as string) ?? null,
    args: (p.args as Record<string, unknown>) ?? {},
    createdAt: String(p.createdAt),
    decidedAt: p.decidedAt ? String(p.decidedAt) : null,
  };
}

/* ---------------- Knop en paneel op elke pagina ---------------- */

/** Hermes-knop rechtsonder (op de telefoon boven de onderbalk) die de chat als paneel opent. */
export function HermesLauncher({ pending, status, timer = false }: { pending: number; status: { configured: boolean; online: boolean }; timer?: boolean }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<{ threadId: string | null; messages: ChatMessageView[] } | null>(null);

  useEffect(() => {
    if (open && !loaded) void loadThreadAction().then(setLoaded);
  }, [open, loaded]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (path.startsWith("/hermes")) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Chat met Hermes${pending ? `, ${pending} voorstellen wachten` : ""}`}
        className={`fixed ${timer ? "bottom-[calc(8.5rem+env(safe-area-inset-bottom))]" : "bottom-[calc(4.5rem+env(safe-area-inset-bottom))]"} right-4 z-20 grid h-12 w-12 place-items-center rounded-full border-2 border-nacht bg-vlak text-nacht shadow-lg transition-transform hover:scale-105 md:bottom-6 md:right-6`}
      >
        <Beeldmerk className="w-6" color="currentColor" strokeWidth={24} />
        {pending > 0 && (
          <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-nacht px-1 text-[11px] font-bold text-op-nacht">{pending}</span>
        )}
      </button>
      {open && (
        <div className="fixed inset-0 z-30 flex justify-end bg-black/30" onClick={() => setOpen(false)}>
          <aside
            role="dialog"
            aria-label="Chat met Hermes"
            className="flex h-dvh w-full flex-col bg-[var(--achtergrond)] px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-[calc(0.75rem+env(safe-area-inset-top))] shadow-2xl md:max-w-md md:border-l md:border-lijn"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2">
              <p className="hud-mono text-xs font-bold uppercase tracking-[0.16em] text-nacht">Hermes</p>
              <span className="flex items-center gap-2">
                {pending > 0 && (
                  <Link href="/hermes?tab=akkoord" className="btn-ghost text-xs" onClick={() => setOpen(false)}>
                    {pending} wacht op akkoord
                  </Link>
                )}
                <button type="button" className="btn-ghost" onClick={() => setOpen(false)} aria-label="Sluiten">
                  ✕
                </button>
              </span>
            </div>
            <div className="min-h-0 flex-1">
              {loaded ? <HermesChat initial={loaded} compact status={status} /> : <p className="py-6 text-sm text-steen">Laden…</p>}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
