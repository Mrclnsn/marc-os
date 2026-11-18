"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireSession } from "@/lib/auth";
import { PUSH_KIND_KEYS, deviceLabel, removeSubscription, saveSubscription, sendPush, setPushPref, type PushKind, type PushSubscriptionInput } from "@/lib/push";

/** Dit apparaat aanmelden voor pushmeldingen. */
export async function subscribePushAction(sub: PushSubscriptionInput) {
  await requireSession();
  await saveSubscription(sub, deviceLabel((await headers()).get("user-agent")));
  revalidatePath("/instellingen");
}

/** Dit apparaat (op endpoint) of een apparaat uit de lijst (op id) afmelden. */
export async function unsubscribePushAction(by: { endpoint?: string; id?: string }) {
  await requireSession();
  await removeSubscription(by);
  revalidatePath("/instellingen");
}

export async function testPushAction() {
  await requireSession();
  const r = await sendPush({ title: "Marc OS", body: "Testmelding: pushmeldingen werken op dit apparaat.", url: "/instellingen#push", tag: "test" });
  revalidatePath("/instellingen");
  return r;
}

export async function setPushPrefAction(kind: PushKind, on: boolean) {
  await requireSession();
  if (!PUSH_KIND_KEYS.includes(kind)) throw new Error("Onbekende soort melding");
  await setPushPref(kind, on);
  revalidatePath("/instellingen");
}
