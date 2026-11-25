import "server-only";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { and, eq, isNotNull, lte, ne, sql } from "drizzle-orm";
import webpush from "web-push";
import { db } from "@/db";
import { clients, pushSubscriptions, settings, tasks } from "@/db/schema";
import { calendarConfigured, getEvents } from "./calendar";
import { daysBetween, today } from "./dates";
import { blockTaskTitles, dayRhythm, nowMinutes } from "./rhythm";
import { listHabits } from "./habits";
import { PLANNABLE_KINDS, toMin, type BlockKind } from "./rhythm-shared";

/* ------------------------------------------------------------------ */
/* Soorten meldingen en voorkeuren                                     */
/* ------------------------------------------------------------------ */

export const PUSH_KINDS = {
  morning: { label: "Ochtendoverzicht", description: "Werkdagen 07:30: taken voor vandaag, achterstallig en je eerste afspraak." },
  deadlines: { label: "Deadlines", description: "Elke dag 09:00: taken met een deadline vandaag of die te laat zijn." },
  blocks: { label: "Dagritme", description: "Bij het begin van een dagritmeblok met herinnering (dagstart, diep werk, sport, dagafsluiting), met wat je erin hebt gepland. Per blok aan te zetten op Planning → Dagritme. Ook gewoontes met een vast tijdstip en herinnering." },
  routines: { label: "Routines van Hermes", description: "Als de ochtendbriefing, dagafsluiting, weekreview of een andere vaste routine klaar is (per routine aan te zetten op Hermes → Routines)." },
  assistant: { label: "Van Claude en Hermes", description: "Meldingen die de assistent via de MCP-koppeling stuurt (send_push)." },
  system: { label: "Systeem", description: "Als de nachtelijke back-up of export mislukt, of de Mac de back-up een paar dagen niet heeft opgehaald." },
} as const;
export type PushKind = keyof typeof PUSH_KINDS;
export const PUSH_KIND_KEYS = Object.keys(PUSH_KINDS) as PushKind[];
export type PushPrefs = Record<PushKind, boolean>;

async function readSetting<T>(key: string): Promise<T | null> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  return (row?.value as T) ?? null;
}

async function writeSetting(key: string, value: unknown) {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

/** Welke soorten meldingen aan staan. Standaard alles aan. */
export async function getPushPrefs(): Promise<PushPrefs> {
  const stored = (await readSetting<Partial<PushPrefs>>("push_prefs")) ?? {};
  const out = Object.fromEntries(PUSH_KIND_KEYS.map((k) => [k, true])) as PushPrefs;
  for (const k of PUSH_KIND_KEYS) if (typeof stored[k] === "boolean") out[k] = stored[k]!;
  return out;
}

export async function setPushPref(kind: PushKind, on: boolean) {
  const patch = { [kind]: on };
  await db
    .insert(settings)
    .values({ key: "push_prefs", value: patch })
    .onConflictDoUpdate({ target: settings.key, set: { value: sql`${settings.value} || ${JSON.stringify(patch)}::jsonb`, updatedAt: new Date() } });
}

/* ------------------------------------------------------------------ */
/* VAPID-sleutels                                                      */
/* ------------------------------------------------------------------ */

type Vapid = { publicKey: string; privateKey: string };

/**
 * Sleutels uit .env (VAPID_PUBLIC_KEY en VAPID_PRIVATE_KEY), anders eenmalig gemaakt en bewaard in de database.
 * Zo werkt push meteen na installatie zonder extra stap. Nieuwe sleutels betekent: elk apparaat opnieuw aanmelden.
 */
async function getVapid(): Promise<Vapid> {
  const envPub = process.env.VAPID_PUBLIC_KEY;
  const envPriv = process.env.VAPID_PRIVATE_KEY;
  if (envPub && envPriv) return { publicKey: envPub, privateKey: envPriv };
  const stored = await readSetting<Vapid>("vapid");
  if (stored?.publicKey && stored.privateKey) return stored;
  const keys = webpush.generateVAPIDKeys();
  // Bij twee gelijktijdige aanroepen wint de eerste; daarna lezen we wat er staat
  await db.insert(settings).values({ key: "vapid", value: keys }).onConflictDoNothing();
  return (await readSetting<Vapid>("vapid")) ?? keys;
}

export async function vapidPublicKey() {
  return (await getVapid()).publicKey;
}

function vapidSubject() {
  if (process.env.VAPID_SUBJECT) return process.env.VAPID_SUBJECT;
  return process.env.DOMAIN ? `https://${process.env.DOMAIN}` : "mailto:info@marclonsain.nl";
}

/* ------------------------------------------------------------------ */
/* Apparaten                                                           */
/* ------------------------------------------------------------------ */

export type PushSubscriptionInput = { endpoint: string; keys: { p256dh: string; auth: string } };

/** Een leesbare naam voor het apparaat uit de user agent. */
export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  const os = /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Apparaat";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "browser";
  return `${os} (${browser})`;
}

export async function saveSubscription(sub: PushSubscriptionInput, label: string) {
  if (!/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error("Ongeldig push-abonnement");
  await db
    .insert(pushSubscriptions)
    .values({ endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, label })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { p256dh: sub.keys.p256dh, auth: sub.keys.auth, label, failures: 0, lastError: null },
    });
}

export async function removeSubscription(by: { id?: string; endpoint?: string }) {
  if (by.id) await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, by.id));
  else if (by.endpoint) await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, by.endpoint));
}

export async function listDevices() {
  return db.select().from(pushSubscriptions).orderBy(pushSubscriptions.createdAt);
}

/* ------------------------------------------------------------------ */
/* Versturen                                                           */
/* ------------------------------------------------------------------ */

export type PushMessage = {
  title: string;
  body: string;
  /** Pagina die opent bij aantikken, bijv. "/taken/..." */
  url?: string;
  /** Meldingen met dezelfde tag vervangen elkaar op het apparaat */
  tag?: string;
};

export type PushResult = { skipped?: string; devices: number; sent: number; failed: number; removed: number };

/**
 * Stuurt een melding naar alle aangemelde apparaten.
 * Met een soort (kind) alleen als die soort aan staat op Instellingen → Pushmeldingen.
 * Apparaten die de push-dienst als verlopen meldt (404/410) worden opgeruimd.
 */
export async function sendPush(msg: PushMessage, kind?: PushKind): Promise<PushResult> {
  if (kind && !(await getPushPrefs())[kind]) return { skipped: `${PUSH_KINDS[kind].label} staat uit`, devices: 0, sent: 0, failed: 0, removed: 0 };
  const subs = await listDevices();
  if (!subs.length) return { skipped: "Geen apparaten aangemeld", devices: 0, sent: 0, failed: 0, removed: 0 };

  const vapid = await getVapid();
  const payload = JSON.stringify({
    title: msg.title.slice(0, 120),
    body: msg.body.slice(0, 400),
    url: msg.url?.startsWith("/") ? msg.url : "/",
    tag: msg.tag,
  });
  const result: PushResult = { devices: subs.length, sent: 0, failed: 0, removed: 0 };

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
          vapidDetails: { subject: vapidSubject(), publicKey: vapid.publicKey, privateKey: vapid.privateKey },
          TTL: 60 * 60 * 12,
          urgency: "normal",
          timeout: 10_000,
        });
        result.sent++;
        await db.update(pushSubscriptions).set({ lastSuccessAt: new Date(), failures: 0, lastError: null }).where(eq(pushSubscriptions.id, s.id));
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          result.removed++;
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
          return;
        }
        result.failed++;
        const message = (e instanceof Error ? e.message : String(e)).slice(0, 300);
        await db
          .update(pushSubscriptions)
          .set({ failures: sql`${pushSubscriptions.failures} + 1`, lastError: status ? `${status}: ${message}` : message })
          .where(eq(pushSubscriptions.id, s.id));
      }
    }),
  );
  return result;
}

/* ------------------------------------------------------------------ */
/* Vaste meldingen                                                     */
/* ------------------------------------------------------------------ */

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Ochtendoverzicht: taken voor vandaag, achterstallig, eerste afspraak. */
export async function morningMessage(): Promise<PushMessage> {
  const t = today();
  const when = sql`coalesce(${tasks.planDate}, ${tasks.dueDate})`;
  const open = await db
    .select({ title: tasks.title, priority: tasks.priority, when: sql<string>`${when}::text` })
    .from(tasks)
    .where(and(ne(tasks.status, "done"), sql`${when} <= ${t}`))
    .orderBy(tasks.priority, sql`${when} asc`);
  const overdue = open.filter((x) => x.when < t).length;

  let first = "";
  try {
    const now = new Date().toISOString();
    const { events } = (await calendarConfigured()) ? await getEvents(t, t) : { events: [] };
    const next = events.filter((e) => !e.allDay && e.date === t && e.end > now).sort((a, b) => a.start.localeCompare(b.start))[0];
    if (next) first = ` Eerste afspraak ${next.time} ${next.title}.`;
  } catch {
    // Agenda niet bereikbaar: melding zonder afspraak
  }

  if (!open.length) return { title: "Goedemorgen", body: `Niets gepland voor vandaag.${first} Kies in de cockpit je 1 tot 3 kerntaken.`, url: "/", tag: "morning" };
  const top = open[0]?.title;
  const body = `${plural(open.length, "taak", "taken")} voor vandaag${overdue ? `, waarvan ${overdue} achterstallig` : ""}.${first}${top ? ` Eerst: ${top}.` : ""}`;
  return { title: "Goedemorgen", body, url: "/", tag: "morning" };
}

/** Deadlines: taken met een deadline vandaag of eerder die nog open staan. */
export async function deadlineMessages(): Promise<PushMessage[]> {
  const t = today();
  const rows = await db
    .select({ id: tasks.id, title: tasks.title, dueDate: tasks.dueDate, client: clients.name })
    .from(tasks)
    .leftJoin(clients, eq(tasks.clientId, clients.id))
    .where(and(ne(tasks.status, "done"), isNotNull(tasks.dueDate), lte(tasks.dueDate, t)))
    .orderBy(tasks.dueDate);
  if (!rows.length) return [];
  if (rows.length > 3) {
    const late = rows.filter((r) => r.dueDate! < t).length;
    return [
      {
        title: `${rows.length} deadlines`,
        body: `${rows.length - late} vandaag, ${late} te laat. ${rows.slice(0, 3).map((r) => r.title).join(", ")}…`,
        url: "/taken",
        tag: "deadlines",
      },
    ];
  }
  return rows.map((r) => {
    const days = daysBetween(r.dueDate!, t);
    return {
      title: days === 0 ? "Deadline vandaag" : `Te laat (${plural(days, "dag", "dagen")})`,
      body: r.client ? `${r.title} · ${r.client}` : r.title,
      url: `/taken/${r.id}`,
      tag: `deadline-${r.id}`,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Herinneringen bij gewoontes met een vast tijdstip (cron elke 5 min) */
/* ------------------------------------------------------------------ */

/**
 * Gewoontes met "herinnering" en een vast tijdstip dat in de afgelopen 6 minuten viel, die vandaag moeten
 * en nog niet zijn afgevinkt. Per dag bijgehouden, dus nooit dubbel.
 */
export async function habitReminderMessages(): Promise<PushMessage[]> {
  const t = today();
  const now = nowMinutes();
  const sent = await readSetting<SentBlocks>("habit_reminders");
  const already = new Set(sent?.date === t ? sent.ids : []);
  const due = (await listHabits()).filter((h) => {
    if (!h.remind || !h.time || already.has(h.id) || !h.dueToday || h.doneToday) return false;
    const at = toMin(h.time);
    return at <= now && at > now - 6;
  });
  if (!due.length) return [];
  await writeSetting("habit_reminders", { date: t, ids: [...already, ...due.map((h) => h.id)] } satisfies SentBlocks);
  return due.map((h) => ({
    title: h.title,
    body: `${h.time} · ${h.whenLabel.replace(/ om \d\d:\d\d| \(herinnering\)/g, "")}${h.streak >= 2 ? ` · ${h.streak} ${h.streakUnit} op rij` : ""}`,
    url: "/planning/gewoontes",
    tag: `habit-${h.id}`,
  }));
}

/* ------------------------------------------------------------------ */
/* Herinneringen bij dagritmeblokken (cron elke 5 minuten)             */
/* ------------------------------------------------------------------ */

type SentBlocks = { date: string; ids: string[] };

/**
 * Meldingen voor blokken met een herinnering waarvan het moment (begin min "minuten vooraf")
 * in de afgelopen 6 minuten viel. Al verstuurde blokken worden per dag bijgehouden,
 * zodat een melding nooit dubbel komt, ook als de cron eens wat later draait.
 */
export async function blockReminderMessages(): Promise<PushMessage[]> {
  const t = today();
  const now = nowMinutes();
  const plan = await dayRhythm(t);
  const sent = await readSetting<SentBlocks>("block_reminders");
  const already = new Set(sent?.date === t ? sent.ids : []);
  const due = plan.blocks.filter((b) => {
    if (!b.remind || already.has(b.id)) return false;
    const at = toMin(b.startTime) - b.remindBefore;
    return at <= now && at > now - 6;
  });
  if (!due.length) return [];
  await writeSetting("block_reminders", { date: t, ids: [...already, ...due.map((b) => b.id)] } satisfies SentBlocks);

  const [titles, habitList, todayOpen] = await Promise.all([
    blockTaskTitles(t),
    listHabits(),
    db
      .select({ title: tasks.title })
      .from(tasks)
      .where(and(ne(tasks.status, "done"), sql`coalesce(${tasks.planDate}, ${tasks.dueDate}) <= ${t}`))
      .orderBy(tasks.priority),
  ]);
  const habitsOpen = habitList.filter((h) => h.dueToday && !h.doneToday);
  const habitsFor = (blockId: string) => habitsOpen.filter((h) => h.blockId === blockId).map((h) => h.title);

  return due.map((b) => {
    const range = `${b.startTime} tot ${b.endTime}`;
    const inBlock = titles.get(b.id) ?? [];
    const linked = habitsFor(b.id);
    let body: string;
    let url = "/planning";
    if (b.kind === "dagstart") {
      body = todayOpen.length
        ? `${plural(todayOpen.length, "taak", "taken")} voor vandaag. Eerst: ${todayOpen[0].title}.${habitsOpen.length ? ` ${plural(habitsOpen.length, "gewoonte", "gewoontes")} te doen.` : ""} Kies je 1 tot 3 kerntaken.`
        : "Nog niets gepland voor vandaag. Kies je 1 tot 3 kerntaken en zet ze in een blok.";
      url = "/";
    } else if (b.kind === "dagafsluiting") {
      body = `${todayOpen.length ? `Nog ${plural(todayOpen.length, "taak", "taken")} open: verplaats naar morgen of rond af.` : "Alles van vandaag is af."}${habitsOpen.length ? ` Gewoontes nog open: ${habitsOpen.map((h) => h.title).join(", ")}.` : ""} Zet morgen klaar.`;
      url = "/";
    } else if (b.kind === "weekreview") {
      body = "Tijd voor de weekreview: klanten en projecten langs, volgende week plannen.";
      url = "/planning?weergave=week";
    } else if (inBlock.length) {
      body = `${range}: ${inBlock.slice(0, 3).join(", ")}${inBlock.length > 3 ? ` en nog ${inBlock.length - 3}` : ""}.`;
    } else {
      body = `${range}. Nog niets ingepland${PLANNABLE_KINDS.includes(b.kind as BlockKind) ? ": kies een taak in Planning" : ""}.`;
    }
    if (linked.length && b.kind !== "dagafsluiting") body += ` Gewoonte: ${linked.join(", ")}.`;
    const title = b.remindBefore > 0 ? `${b.title} om ${b.startTime}` : b.title;
    return { title, body, url, tag: `block-${b.id}` };
  });
}

/* ------------------------------------------------------------------ */
/* Back-ups                                                            */
/* ------------------------------------------------------------------ */

export const BACKUP_DIR = process.env.BACKUP_DIR ?? "/backups";
const BACKUP_RE = /^marcos-(\d{4}-\d{2}-\d{2})\.sql\.gz\.enc$/;

export type BackupFile = { name: string; date: string; bytes: number; modified: string };

/** Versleutelde back-ups op de VPS, nieuwste eerst. Leeg als de map niet bestaat (lokaal). */
export function listBackups(): BackupFile[] {
  try {
    return readdirSync(BACKUP_DIR)
      .filter((n) => BACKUP_RE.test(n))
      .map((name) => {
        const st = statSync(join(BACKUP_DIR, name));
        return { name, date: name.match(BACKUP_RE)![1], bytes: st.size, modified: st.mtime.toISOString() };
      })
      .sort((a, b) => b.name.localeCompare(a.name));
  } catch {
    return [];
  }
}

export function isBackupName(name: string) {
  return BACKUP_RE.test(name);
}

export type BackupPull = { at: string; file: string };

export async function recordBackupPull(file: string) {
  await writeSetting("backup_last_pulled", { at: new Date().toISOString(), file } satisfies BackupPull);
}

export async function lastBackupPull() {
  return readSetting<BackupPull>("backup_last_pulled");
}

/**
 * Controle na de nachtelijke back-up: ontbreekt de back-up van vannacht, of heeft de Mac
 * al 3 dagen niets opgehaald, dan een systeemmelding.
 */
export async function backupCheckMessages(): Promise<PushMessage[]> {
  const out: PushMessage[] = [];
  const latest = listBackups()[0];
  const ageH = latest ? (Date.now() - new Date(latest.modified).getTime()) / 3_600_000 : Infinity;
  if (ageH > 26) {
    out.push({
      title: "Back-up ontbreekt",
      body: latest ? `De laatste back-up is van ${latest.date}. Bekijk /opt/marc-os/logs/cron.log op de VPS.` : "Er staat nog geen versleutelde back-up op de VPS.",
      url: "/instellingen#backups",
      tag: "backup-missing",
    });
  }
  const pull = await lastBackupPull();
  const pullAgeD = pull ? (Date.now() - new Date(pull.at).getTime()) / 86_400_000 : Infinity;
  if (latest && pullAgeD > 3) {
    out.push({
      title: "Back-up niet buiten de VPS",
      body: pull ? `Je Mac heeft sinds ${pull.at.slice(0, 10)} geen back-up opgehaald.` : "Je Mac heeft nog nooit een back-up opgehaald. Zie Instellingen → Back-ups.",
      url: "/instellingen#backups",
      tag: "backup-pull",
    });
  }
  return out;
}
