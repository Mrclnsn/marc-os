import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import { chatWithHermes } from "@/lib/hermes";
import * as agent from "@/lib/agent";

export const dynamic = "force-dynamic";

/**
 * Chat met Hermes vanuit de app. Ontvangt { threadId?, message } en geeft regels JSON terug (één per gebeurtenis):
 * thread, delta, tool, done (met de voorstellen die tijdens dit antwoord zijn gemaakt) of error.
 */
export async function POST(req: Request) {
  if (!(await verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value))) return new Response("Niet ingelogd", { status: 401 });
  const body = (await req.json().catch(() => null)) as { threadId?: string; message?: string } | null;
  const message = body?.message?.trim();
  if (!message) return new Response("Leeg bericht", { status: 400 });
  if (message.length > 8000) return new Response("Bericht te lang", { status: 400 });

  let threadId = body?.threadId && /^[0-9a-f-]{36}$/i.test(body.threadId) ? body.threadId : null;
  if (threadId && !(await agent.getThread(threadId))) threadId = null;
  if (!threadId) threadId = (await agent.createThread(message)).id;
  await agent.addMessage({ threadId, role: "user", content: message });
  await agent.log({ actor: "marc", kind: "chat", summary: `Chat: ${message.slice(0, 120)}` });
  agent.markChatActive();

  const started = await agent.dbNow();
  const encoder = new TextEncoder();
  const id = threadId;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      // Safari toont een stroom pas na 1 KB: begin met een lege regel van die lengte
      controller.enqueue(encoder.encode(`${" ".repeat(1024)}\n`));
      send({ type: "thread", threadId: id });
      let text = "";
      let tools: string[] = [];
      let error: string | null = null;
      // Houd de chat "actief" zolang Hermes bezig is: dan geen pushmeldingen voor voorstellen
      const keep = setInterval(() => agent.markChatActive(), 30_000);
      try {
        for await (const ev of chatWithHermes(`marc-os-${id}`, message, req.signal)) {
          if (ev.type === "delta") text += ev.text;
          if (ev.type === "done") tools = ev.tools;
          if (ev.type === "error") error = ev.message;
          if (ev.type !== "done") send(ev);
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        send({ type: "error", message: error });
      } finally {
        clearInterval(keep);
      }
      const proposals = await agent.listProposals({ status: "all", since: started, limit: 20 });
      const saved = await agent.addMessage({
        threadId: id,
        role: "assistant",
        content: text,
        tools,
        proposalIds: proposals.map((p) => p.id),
        error,
      });
      send({ type: "done", messageId: saved.id, text, tools, proposals, error });
      controller.close();
    },
  });

  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
}
