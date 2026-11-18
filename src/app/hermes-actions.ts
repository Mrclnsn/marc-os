"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import * as agent from "@/lib/agent";
import { approveProposal, editProposal } from "@/lib/mcp";
import type { AgentProposal } from "@/db/schema";

export type ProposalView = Pick<AgentProposal, "id" | "tool" | "title" | "reason" | "status" | "edited" | "error" | "decisionNote"> & {
  args: Record<string, unknown>;
  createdAt: string;
  decidedAt: string | null;
};

export async function toView(p: AgentProposal): Promise<ProposalView> {
  return {
    id: p.id,
    tool: p.tool,
    title: p.title,
    reason: p.reason,
    status: p.status,
    edited: p.edited,
    error: p.error,
    decisionNote: p.decisionNote,
    args: (p.args ?? {}) as Record<string, unknown>,
    createdAt: p.createdAt.toISOString(),
    decidedAt: p.decidedAt?.toISOString() ?? null,
  };
}

function refresh() {
  revalidatePath("/", "layout");
}

const VIA = new Set<agent.DecidedVia>(["app", "chat", "cockpit"]);

export async function approveProposalAction(id: string, via: agent.DecidedVia = "app"): Promise<{ ok: boolean; error?: string; proposal: ProposalView | null }> {
  await requireSession();
  const r = await approveProposal(id, VIA.has(via) ? via : "app");
  refresh();
  return { ok: r.ok, error: r.ok ? undefined : r.error, proposal: r.proposal ? await toView(r.proposal) : null };
}

export async function rejectProposalAction(id: string, note?: string, via: agent.DecidedVia = "app"): Promise<ProposalView | null> {
  await requireSession();
  const p = await agent.rejectProposal(id, VIA.has(via) ? via : "app", note?.slice(0, 500));
  refresh();
  return p ? toView(p) : null;
}

/** Argumenten aanpassen voor akkoord. Krijgt JSON-tekst; geeft een leesbare fout terug als het niet klopt. */
export async function editProposalAction(id: string, argsJson: string): Promise<{ ok: boolean; error?: string; proposal?: ProposalView }> {
  await requireSession();
  let args: unknown;
  try {
    args = JSON.parse(argsJson);
  } catch {
    return { ok: false, error: "Geen geldige JSON." };
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) return { ok: false, error: "Verwacht een object met velden." };
  try {
    const p = await editProposal(id, args as Record<string, unknown>);
    refresh();
    return p ? { ok: true, proposal: await toView(p) } : { ok: false, error: "Dit voorstel staat niet meer open." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Alle open voorstellen in één keer goedkeuren (op volgorde van binnenkomst). */
export async function approveAllAction(): Promise<{ executed: number; failed: number }> {
  await requireSession();
  const open = await agent.listProposals({ status: "pending", limit: 50 });
  let executed = 0;
  let failed = 0;
  for (const p of open) {
    const r = await approveProposal(p.id, "app");
    if (r.ok) executed++;
    else failed++;
  }
  refresh();
  return { executed, failed };
}

export async function setAutoToolAction(tool: string, on: boolean) {
  await requireSession();
  if (!/^[a-z_]+$/.test(tool)) throw new Error("Onbekende actie");
  await agent.setAutoTool(tool, on);
  revalidatePath("/instellingen");
  revalidatePath("/hermes");
}

export type ChatMessageView = {
  id: string;
  role: "user" | "assistant";
  content: string;
  tools: string[];
  error: string | null;
  proposals: ProposalView[];
  createdAt: string;
};

/** Een gesprek laden voor de chat (met de voorstellen bij elk antwoord in hun huidige staat). Zonder id: het laatste gesprek. */
export async function loadThreadAction(id?: string | null): Promise<{ threadId: string | null; title: string | null; messages: ChatMessageView[] }> {
  await requireSession();
  if (id === "nieuw") return { threadId: null, title: null, messages: [] };
  const valid = id && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
  const threadId = valid ?? (await agent.listThreads(1))[0]?.id ?? null;
  if (!threadId) return { threadId: null, title: null, messages: [] };
  const t = await agent.getThread(threadId);
  if (!t) return { threadId: null, title: null, messages: [] };
  const ids = t.messages.flatMap((m) => m.proposalIds ?? []);
  const props = new Map((await agent.listProposals({ status: "all", ids, limit: 500 })).map((p) => [p.id, p]));
  const messages: ChatMessageView[] = [];
  for (const m of t.messages) {
    const proposals: ProposalView[] = [];
    for (const pid of m.proposalIds ?? []) {
      const p = props.get(pid);
      if (p) proposals.push(await toView(p));
    }
    messages.push({ id: m.id, role: m.role as "user" | "assistant", content: m.content, tools: m.tools ?? [], error: m.error, proposals, createdAt: m.createdAt.toISOString() });
  }
  return { threadId, title: t.thread.title, messages };
}

export async function deleteThreadAction(id: string) {
  await requireSession();
  await agent.deleteThread(id);
  revalidatePath("/hermes");
}
