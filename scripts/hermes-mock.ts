/**
 * Nep-Hermes om de chat en de akkoordwachtrij lokaal te testen, zonder Anthropic-sleutel.
 *   npm run hermes-mock        (naast npm run local)
 * Zet in .env.local: HERMES_URL=http://127.0.0.1:8642 en HERMES_API_KEY=mock (en een HERMES_MCP_TOKEN).
 * Praat met Marc OS via de MCP-sleutel van Hermes, net als de echte. Begrijpt alleen een paar zinnen:
 *   "taak: <titel>"   → create_task (wordt een voorstel)
 *   "inbox: <tekst>"  → capture (mag standaard zonder akkoord)
 *   "voorstellen"     → list_proposals
 *   anders            → get_overview en een korte samenvatting
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";

for (const f of [".env.local", ".env"]) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
const APP = process.env.MARC_OS_URL ?? "http://127.0.0.1:3000";
const TOKEN = process.env.HERMES_MCP_TOKEN ?? "";
const KEY = process.env.HERMES_API_KEY ?? "mock";
const PORT = Number(process.env.HERMES_MOCK_PORT ?? 8642);
if (!TOKEN) {
  console.error("HERMES_MCP_TOKEN ontbreekt in .env.local");
  process.exit(1);
}

let rpc = 1;
async function mcp(name: string, args: Record<string, unknown> = {}) {
  const res = await fetch(`${APP}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: rpc++, method: "tools/call", params: { name, arguments: args } }),
  });
  const body = (await res.json()) as { result?: { content?: { text: string }[]; isError?: boolean }; error?: { message: string } };
  if (body.error) throw new Error(body.error.message);
  const text = body.result?.content?.map((c) => c.text).join("\n") ?? "";
  if (body.result?.isError) throw new Error(text);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function think(input: string, tool: (n: string) => void): Promise<string> {
  const taak = input.match(/^taak:\s*(.+)$/i);
  if (taak) {
    tool("mcp_marcos_create_task");
    const r = await mcp("create_task", { title: taak[1].trim(), area: "zakelijk", planDate: new Date().toISOString().slice(0, 10), reden: "Je vroeg erom in de chat." });
    return r.status === "pending" ? `Ik stel voor de taak **${taak[1].trim()}** voor vandaag aan te maken. Die wacht op je akkoord.` : `Taak aangemaakt.`;
  }
  const inbox = input.match(/^inbox:\s*(.+)$/i);
  if (inbox) {
    tool("mcp_marcos_capture");
    const r = await mcp("capture", { text: inbox[1].trim() });
    return r.status === "pending" ? "Voorstel om dit in de inbox te zetten staat klaar." : "Staat in je inbox.";
  }
  if (/voorstellen/i.test(input)) {
    tool("mcp_marcos_list_proposals");
    const r = (await mcp("list_proposals", { limit: 5 })) as { title: string; status: string }[];
    return r.length ? r.map((p) => `- ${p.title}: ${p.status}`).join("\n") : "Geen voorstellen.";
  }
  tool("mcp_marcos_get_overview");
  const o = await mcp("get_overview");
  const today = o.today?.length ?? o.tasksToday?.length ?? 0;
  const overdue = o.overdue?.length ?? 0;
  return `Vandaag staan er **${today}** taken${overdue ? `, en ${overdue} achterstallig` : ""}. (antwoord van de nep-Hermes)`;
}

createServer(async (req, res) => {
  if (req.url === "/health" || req.url === "/v1/health") {
    res.writeHead(200, { "content-type": "application/json" }).end('{"status":"ok"}');
    return;
  }
  if (req.headers.authorization !== `Bearer ${KEY}`) {
    res.writeHead(401).end("unauthorized");
    return;
  }
  if (req.method === "POST" && req.url === "/v1/responses") {
    let raw = "";
    for await (const c of req) raw += c;
    const body = JSON.parse(raw) as { input: string; conversation?: string; stream?: boolean };
    console.log(`[mock] ${body.conversation}: ${body.input}`);
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const send = (type: string, data: Record<string, unknown>) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    send("response.created", { response: { id: "resp_mock" } });
    res.write(": keepalive\n\n");
    try {
      const text = await think(body.input, (name) => send("response.output_item.added", { item: { type: "function_call", name } }));
      for (const part of text.match(/[\s\S]{1,12}/g) ?? []) {
        send("response.output_text.delta", { delta: part });
        await new Promise((r) => setTimeout(r, 15));
      }
      send("response.completed", { response: { id: "resp_mock", output_text: text } });
    } catch (e) {
      send("response.failed", { response: { error: { message: (e as Error).message } } });
    }
    res.end();
    return;
  }
  res.writeHead(404).end();
}).listen(PORT, "127.0.0.1", () => console.log(`Nep-Hermes op http://127.0.0.1:${PORT} → Marc OS ${APP}`));
