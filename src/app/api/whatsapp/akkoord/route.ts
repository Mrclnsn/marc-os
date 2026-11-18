import { approveTokenOk, handleWhatsAppDecision } from "@/lib/whatsapp";
import * as agent from "@/lib/agent";

export const dynamic = "force-dynamic";

/**
 * "ja" / "nee" uit WhatsApp (gesprek 13). Alleen voor de akkoord-plugin in Hermes (hermes/plugins/marcos-akkoord),
 * met de eigen sleutel WHATSAPP_APPROVE_TOKEN. De plugin stuurt alleen berichten door die de WhatsApp-gateway
 * heeft toegelaten (alleen Marc's eigen nummer) en vóórdat het model ze ziet; Hermes zelf kan hier niet bij.
 * Antwoord: { handled, reply }. handled=false: het bericht gaat gewoon naar Hermes.
 */
export async function POST(req: Request) {
  const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!approveTokenOk(bearer)) return new Response("Geen toegang", { status: 401 });
  const body = (await req.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.slice(0, 500) : "";
  if (!text.trim()) return Response.json({ handled: false });
  try {
    const r = await handleWhatsAppDecision(text);
    if (r.handled) await agent.log({ actor: "marc", kind: "whatsapp", summary: `WhatsApp: "${text.slice(0, 80)}"`, detail: { reply: r.reply } });
    return Response.json(r);
  } catch (e) {
    console.error("whatsapp akkoord", e);
    return Response.json({ handled: true, reply: "Dat ging mis in Marc OS. Keur het voorstel goed in de app (Hermes → Akkoord)." });
  }
}
