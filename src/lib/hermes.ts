import "server-only";

/*
 * Verbinding van Marc OS met Hermes op de VPS (gesprek 12).
 * Hermes draait als eigen container met een OpenAI-compatibele API (poort 8642, alleen intern bereikbaar).
 * De chat gebruikt /v1/responses met een vaste "conversation" per gesprek: de geschiedenis houdt Hermes zelf bij.
 */

export type HermesStatus = { configured: boolean; online: boolean; error?: string; checkedAt: number };

export function hermesConfig() {
  const url = (process.env.HERMES_URL ?? "").replace(/\/+$/, "");
  const key = process.env.HERMES_API_KEY ?? "";
  return { url, key, configured: !!url && !!key };
}

let cached: HermesStatus | null = null;

/** Is Hermes bereikbaar? Kort gecachet (30 seconden), zodat de cockpit niet bij elke weergave wacht. */
export async function hermesStatus(force = false): Promise<HermesStatus> {
  const { url, configured } = hermesConfig();
  if (!configured) return { configured: false, online: false, checkedAt: Date.now() };
  if (!force && cached && Date.now() - cached.checkedAt < 30_000) return cached;
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500), cache: "no-store" });
    cached = { configured: true, online: res.ok, error: res.ok ? undefined : `HTTP ${res.status}`, checkedAt: Date.now() };
  } catch (e) {
    cached = { configured: true, online: false, error: e instanceof Error ? e.message : String(e), checkedAt: Date.now() };
  }
  return cached;
}

/** Zonder te wachten: de laatst bekende status (en op de achtergrond verversen). Voor de layout van elke pagina. */
export function hermesStatusQuick(): { configured: boolean; online: boolean } {
  const { configured } = hermesConfig();
  if (!configured) return { configured: false, online: false };
  if (!cached || Date.now() - cached.checkedAt > 30_000) void hermesStatus(true);
  return { configured: true, online: cached?.online ?? true };
}

export type ChatEvent =
  | { type: "delta"; text: string }
  | { type: "tool"; name: string }
  | { type: "done"; text: string; tools: string[] }
  | { type: "error"; message: string };

/** Naam van een MCP-tool zoals Hermes hem noemt (mcp_marcos_get_overview) terug naar de naam in Marc OS. */
export function plainToolName(name: string) {
  return name.replace(/^mcp_marcos_/, "").replace(/^mcp-marcos[._-]/, "");
}

const CHANNEL_NOTE =
  "Kanaal: chat in de Marc OS-app. Marc ziet je voorstellen direct onder je antwoord en kan ze daar met één tik goedkeuren of afwijzen. Antwoord kort en in het Nederlands.";

/**
 * Stuur één bericht naar Hermes en geef de antwoorden als stroom terug.
 * Werkt met een streamend antwoord (SSE) en valt terug op een gewoon JSON-antwoord.
 */
export async function* chatWithHermes(conversation: string, input: string, signal?: AbortSignal): AsyncGenerator<ChatEvent> {
  const { url, key, configured } = hermesConfig();
  if (!configured) {
    yield { type: "error", message: "Hermes is nog niet geïnstalleerd. Draai op de VPS: bash /opt/marc-os/scripts/hermes-setup.sh" };
    return;
  }

  let res: Response;
  try {
    res = await fetch(`${url}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}`, accept: "text/event-stream" },
      body: JSON.stringify({ model: "hermes-agent", input, conversation, instructions: CHANNEL_NOTE, stream: true, store: true }),
      signal: signal ?? AbortSignal.timeout(5 * 60_000),
    });
  } catch (e) {
    yield { type: "error", message: `Hermes is niet bereikbaar (${e instanceof Error ? e.message : String(e)}).` };
    return;
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    yield { type: "error", message: `Hermes gaf een fout (HTTP ${res.status})${body ? `: ${body.slice(0, 200)}` : ""}` };
    return;
  }

  const tools: string[] = [];
  let text = "";
  const addTool = (raw: unknown) => {
    if (typeof raw !== "string" || !raw) return null;
    const name = plainToolName(raw);
    if (!tools.includes(name)) tools.push(name);
    return name;
  };

  // Geen stroom: één JSON-antwoord in het Responses-formaat
  if (!(res.headers.get("content-type") ?? "").includes("event-stream")) {
    const body = (await res.json().catch(() => null)) as ResponsesBody | null;
    const out = body ? outputText(body) : "";
    for (const item of body?.output ?? []) if (item.type === "function_call") addTool(item.name);
    if (out) yield { type: "delta", text: out };
    yield { type: "done", text: out, tools };
    return;
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let failed: string | null = null;
  let finalText: string | null = null;

  const handle = function* (ev: string | null, raw: string): Generator<ChatEvent> {
    if (raw === "[DONE]") return;
    let d: Record<string, unknown>;
    try {
      d = JSON.parse(raw);
    } catch {
      return;
    }
    const type = (d.type as string) ?? ev ?? "";
    if (type === "response.output_text.delta" && typeof d.delta === "string") {
      text += d.delta;
      yield { type: "delta", text: d.delta };
    } else if (type === "response.output_item.added" || type === "response.output_item.done") {
      const item = d.item as { type?: string; name?: string } | undefined;
      if (item?.type === "function_call") {
        const before = tools.length;
        const name = addTool(item.name);
        if (name && tools.length > before) yield { type: "tool", name };
      }
    } else if (type === "hermes.tool.progress") {
      const before = tools.length;
      const name = addTool((d.tool as string) ?? (d.name as string));
      if (name && tools.length > before) yield { type: "tool", name };
    } else if (type === "response.completed") {
      const out = outputText((d.response as ResponsesBody) ?? {});
      if (out) finalText = out;
    } else if (type === "response.failed" || type === "error") {
      const r = d.response as { error?: { message?: string } } | undefined;
      failed = r?.error?.message ?? (d.message as string) ?? (d.error as { message?: string })?.message ?? "Hermes kon het niet afmaken.";
    } else if (type === "response.cancelled") {
      failed = "Afgebroken.";
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buf.search(/\r?\n\r?\n/)) >= 0) {
        const block = buf.slice(0, sep);
        buf = buf.slice(sep).replace(/^\r?\n\r?\n/, "");
        let ev: string | null = null;
        const data: string[] = [];
        for (const line of block.split(/\r?\n/)) {
          if (line.startsWith(":")) continue; // keepalive
          if (line.startsWith("event:")) ev = line.slice(6).trim();
          else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
        }
        if (data.length) yield* handle(ev, data.join("\n"));
      }
    }
  } catch (e) {
    failed = `Verbinding met Hermes verbroken (${e instanceof Error ? e.message : String(e)}).`;
  }

  // Kwam er geen tekst in delen, maar wel in het eindantwoord: dan alsnog tonen
  if (!text && finalText) {
    text = finalText;
    yield { type: "delta", text };
  }
  if (failed && !text) {
    yield { type: "error", message: failed };
    return;
  }
  yield { type: "done", text, tools };
}

type ResponsesBody = { output_text?: string; output?: { type?: string; name?: string; content?: { type?: string; text?: string }[] }[] };

function outputText(body: ResponsesBody): string {
  if (typeof body.output_text === "string" && body.output_text) return body.output_text;
  return (body.output ?? [])
    .filter((o) => o.type === "message")
    .flatMap((o) => o.content ?? [])
    .filter((c) => c.type === "output_text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("");
}
