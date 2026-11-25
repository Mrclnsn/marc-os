import { tokenOk } from "@/lib/mcp";
import { blockReminderMessages, habitReminderMessages, backupCheckMessages, deadlineMessages, morningMessage, sendPush, type PushMessage, type PushResult } from "@/lib/push";

export const dynamic = "force-dynamic";

/**
 * Vaste pushmeldingen, aangeroepen door de cron op de VPS (scripts/cron.sh) met de MCP-token als Bearer.
 *   morning      ochtendoverzicht (werkdagen 07:30)
 *   deadlines    deadlines vandaag en te laat (09:00)
 *   blocks       herinneringen bij dagritmeblokken (elke 5 minuten; stuurt alleen als er een blok begint)
 *   backupcheck  back-up van vannacht aanwezig en opgehaald door de Mac (na de back-up)
 *   system       vrije systeemmelding, body {"title","body"} (bijv. als de back-up mislukt)
 *   routines     vaste routines van Hermes die nu aan de beurt zijn starten (elke 5 minuten; gesprek 13)
 *   whatsapp     testbericht naar WhatsApp via Hermes (scripts/whatsapp-setup.sh)
 */
export async function POST(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!tokenOk(bearer)) return new Response("Geen toegang", { status: 401 });
  const { kind } = await params;

  if (kind === "routines") {
    const { tickRoutines } = await import("@/lib/routines");
    return Response.json({ kind, ...(await tickRoutines()) });
  }
  if (kind === "whatsapp") {
    const { sendWhatsApp } = await import("@/lib/whatsapp");
    const r = await sendWhatsApp("Test vanuit Marc OS: WhatsApp via Hermes werkt. Antwoord gerust met een vraag aan Hermes.");
    return Response.json({ kind, ...r }, { status: r.ok ? 200 : 502 });
  }

  let messages: PushMessage[];
  let pushKind: "morning" | "deadlines" | "blocks" | "system";
  switch (kind) {
    case "morning": {
      // Draait de ochtendbriefing van Hermes, dan stuurt die zijn eigen melding (of bij een fout dit overzicht)
      const { briefingReplacesMorningPush } = await import("@/lib/routines");
      messages = (await briefingReplacesMorningPush()) ? [] : [await morningMessage()];
      pushKind = "morning";
      break;
    }
    case "deadlines":
      messages = await deadlineMessages();
      pushKind = "deadlines";
      break;
    case "blocks":
      // Dagritmeblokken en gewoontes met een vast tijdstip (beide soort "Dagritme")
      messages = [...(await blockReminderMessages()), ...(await habitReminderMessages())];
      pushKind = "blocks";
      break;
    case "backupcheck":
      messages = await backupCheckMessages();
      pushKind = "system";
      break;
    case "system": {
      const b = (await req.json().catch(() => ({}))) as { title?: string; body?: string };
      if (!b.title) return Response.json({ error: "title ontbreekt" }, { status: 400 });
      messages = [{ title: b.title, body: b.body ?? "", url: "/instellingen#backups", tag: "system" }];
      pushKind = "system";
      break;
    }
    default:
      return Response.json({ error: `Onbekende soort: ${kind}` }, { status: 404 });
  }

  const results: PushResult[] = [];
  for (const m of messages) results.push(await sendPush(m, pushKind));
  return Response.json({ kind, messages: messages.length, titles: messages.map((m) => `${m.title}: ${m.body}`), results });
}
