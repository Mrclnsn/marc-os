import { cookies } from "next/headers";
import { deviceLabel, removeSubscription, saveSubscription, type PushSubscriptionInput } from "@/lib/push";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

/** De service worker meldt een vernieuwd push-abonnement aan (pushsubscriptionchange). */
export async function POST(req: Request) {
  if (!(await verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value))) return new Response("Niet ingelogd", { status: 401 });
  const b = (await req.json().catch(() => null)) as { old?: string | null; sub?: PushSubscriptionInput } | null;
  if (!b?.sub) return new Response("Geen abonnement", { status: 400 });
  if (b.old && b.old !== b.sub.endpoint) await removeSubscription({ endpoint: b.old });
  await saveSubscription(b.sub, deviceLabel(req.headers.get("user-agent")));
  return Response.json({ ok: true });
}
