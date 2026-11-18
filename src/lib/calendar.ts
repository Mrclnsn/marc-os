import "server-only";
import ical from "node-ical";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { calendarFeeds, type CalendarFeed } from "@/db/schema";
import { TIMEZONE, addDaysIso } from "./dates";

export type CalendarEvent = {
  calendar: string;
  title: string;
  start: string; // ISO-instant
  end: string;
  allDay: boolean;
  location: string | null;
  /** Lokale datum (YYYY-MM-DD) waarop het event begint */
  date: string;
  /** Lokale tijd HH:mm, of null bij hele dag */
  time: string | null;
  endTime: string | null;
};

type Feed = { id: string | null; name: string; url: string; lastError: string | null; lastOkAt: Date | null };

/** Agenda-links uit .env (oude manier, blijft werken): CALENDAR_ICS_URLS="Werk|https://...ics,Privé|https://...ics" */
export function envFeeds(): { name: string; url: string }[] {
  const raw = process.env.CALENDAR_ICS_URLS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry, i) => {
      const [name, ...rest] = entry.split("|");
      return rest.length ? { name: name.trim(), url: rest.join("|").trim() } : { name: `Agenda ${i + 1}`, url: name.trim() };
    });
}

/** Alle actieve agenda's: die in de app zijn toegevoegd plus die uit .env. */
async function feeds(): Promise<Feed[]> {
  const rows = await db.select().from(calendarFeeds).where(eq(calendarFeeds.active, true)).orderBy(asc(calendarFeeds.sortOrder), asc(calendarFeeds.createdAt));
  const known = new Set(rows.map((r) => r.url));
  return [
    ...rows.map((r) => ({ id: r.id, name: r.name, url: r.url, lastError: r.lastError, lastOkAt: r.lastOkAt })),
    ...envFeeds()
      .filter((f) => !known.has(f.url))
      .map((f) => ({ id: null, name: f.name, url: f.url, lastError: null, lastOkAt: null })),
  ];
}

const cache = new Map<string, { at: number; body: string }>();
const TTL = 5 * 60 * 1000;

async function fetchIcs(url: string, fresh = false): Promise<string> {
  const hit = cache.get(url);
  if (!fresh && hit && Date.now() - hit.at < TTL) return hit.body;
  const res = await fetch(url.replace(/^webcal:/i, "https:"), { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Agenda ophalen mislukt (${res.status})`);
  const body = await res.text();
  if (!body.includes("BEGIN:VCALENDAR")) throw new Error("Dit is geen agenda-bestand (ICS). Gebruik het geheime iCal-adres.");
  cache.set(url, { at: Date.now(), body });
  return body;
}

/** Status van een agenda in de app bijwerken, maar alleen als er iets verandert (of hooguit eens per uur bij succes). */
async function recordStatus(feed: Feed, error: string | null) {
  if (!feed.id) return;
  if (error) {
    if (feed.lastError === error) return;
    await db.update(calendarFeeds).set({ lastError: error }).where(eq(calendarFeeds.id, feed.id));
  } else {
    if (!feed.lastError && feed.lastOkAt && Date.now() - feed.lastOkAt.getTime() < 3_600_000) return;
    await db.update(calendarFeeds).set({ lastError: null, lastOkAt: new Date() }).where(eq(calendarFeeds.id, feed.id));
  }
}

const dateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE });
const timeFmt = new Intl.DateTimeFormat("nl-NL", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit" });

function str(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && "val" in (v as Record<string, unknown>)) return String((v as { val: unknown }).val);
  return String(v);
}

/** Events tussen twee lokale datums (inclusief). */
export async function getEvents(fromIso: string, toIso: string): Promise<{ events: CalendarEvent[]; errors: string[] }> {
  return eventsFor(await feeds(), fromIso, toIso);
}

async function eventsFor(list: Feed[], fromIso: string, toIso: string, fresh = false): Promise<{ events: CalendarEvent[]; errors: string[] }> {
  const from = new Date(`${fromIso}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 1); // marge voor tijdzones
  const to = new Date(`${addDaysIso(toIso, 1)}T23:59:59Z`);
  const events: CalendarEvent[] = [];
  const errors: string[] = [];

  await Promise.all(
    list.map(async (feed) => {
      try {
        const parsed = ical.sync.parseICS(await fetchIcs(feed.url, fresh));
        for (const item of Object.values(parsed)) {
          if (!item || item.type !== "VEVENT") continue;
          const instances = ical.expandRecurringEvent(item, { from, to, expandOngoing: true });
          for (const inst of instances) {
            const start = new Date(inst.start);
            const end = new Date(inst.end ?? inst.start);
            let date: string;
            if (inst.isFullDay) {
              // Hele-dag-events worden als lokale middernacht van het proces ingelezen
              const tz = (inst.start as { tz?: string }).tz;
              date = tz
                ? new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(start)
                : `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
            } else {
              date = dateFmt.format(start);
            }
            if (date < fromIso || date > toIso) continue;
            events.push({
              calendar: feed.name,
              title: str(inst.summary) || "(zonder titel)",
              start: start.toISOString(),
              end: end.toISOString(),
              allDay: inst.isFullDay,
              location: str(item.location) || null,
              date,
              time: inst.isFullDay ? null : timeFmt.format(start),
              endTime: inst.isFullDay ? null : timeFmt.format(end),
            });
          }
        }
        await recordStatus(feed, null);
      } catch (e) {
        const err = e as Error;
        const msg =
          err.name === "TimeoutError"
            ? "Agenda reageert niet (15 seconden)"
            : err.message === "fetch failed"
              ? "Agenda niet bereikbaar: klopt de link, en is de agenda nog gedeeld?"
              : err.message;
        errors.push(`${feed.name}: ${msg}`);
        await recordStatus(feed, msg).catch(() => {});
      }
    }),
  );

  events.sort((a, b) => (a.date === b.date ? (a.allDay === b.allDay ? a.start.localeCompare(b.start) : a.allDay ? -1 : 1) : a.date.localeCompare(b.date)));
  return { events, errors };
}

export async function calendarConfigured(): Promise<boolean> {
  return (await feeds()).length > 0;
}

/* ------------------------------------------------------------------ */
/* Agenda-links beheren in de app (Instellingen → Agenda)              */
/* ------------------------------------------------------------------ */

/** URL netjes maken: webcal wordt https, spaties eruit. Alleen https (of webcal). */
export function cleanFeedUrl(input: string): string {
  const url = input.trim().replace(/^webcals?:\/\//i, "https://");
  if (!/^https:\/\/[^\s]+$/i.test(url)) throw new Error("Gebruik een https- of webcal-adres van je agenda (eindigt meestal op .ics).");
  return url;
}

/** Laat alleen het begin van de URL zien: de rest is geheim. */
export function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.length > 14 ? `${u.pathname.slice(0, 10)}…` : u.pathname;
    return `${u.host}${path}`;
  } catch {
    return "ongeldige link";
  }
}

export type FeedView = Omit<CalendarFeed, "url"> & { masked: string; source: "app" | "env" };

/** Agenda's voor het instellingenscherm, zonder de geheime URL. */
export async function listCalendarFeeds(): Promise<FeedView[]> {
  const rows = await db.select().from(calendarFeeds).orderBy(asc(calendarFeeds.sortOrder), asc(calendarFeeds.createdAt));
  const known = new Set(rows.map((r) => r.url));
  const app: FeedView[] = rows.map(({ url, ...r }) => ({ ...r, masked: maskUrl(url), source: "app" }));
  const env: FeedView[] = envFeeds()
    .filter((f) => !known.has(f.url))
    .map((f, i) => ({
      id: `env-${i}`,
      name: f.name,
      active: true,
      lastOkAt: null,
      lastError: null,
      sortOrder: 1000 + i,
      createdAt: new Date(0),
      updatedAt: new Date(0),
      masked: maskUrl(f.url),
      source: "env",
    }));
  return [...app, ...env];
}

export type FeedTest = { ok: boolean; events: number; error: string | null };

/** Agenda direct ophalen (zonder cache) en tellen hoeveel afspraken er de komende 14 dagen zijn. */
async function testFeed(feed: Feed): Promise<FeedTest> {
  const from = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date());
  const { events, errors } = await eventsFor([feed], from, addDaysIso(from, 14), true);
  return errors.length ? { ok: false, events: 0, error: errors[0].replace(`${feed.name}: `, "") } : { ok: true, events: events.length, error: null };
}

export async function addCalendarFeed(input: { name: string; url: string }): Promise<FeedTest & { id: string }> {
  const url = cleanFeedUrl(input.url);
  const name = input.name.trim() || "Agenda";
  const [row] = await db.insert(calendarFeeds).values({ name, url }).returning();
  const test = await testFeed({ id: row.id, name, url, lastError: null, lastOkAt: null });
  return { ...test, id: row.id };
}

export async function updateCalendarFeed(id: string, patch: { name?: string; url?: string; active?: boolean }) {
  const set: Partial<typeof calendarFeeds.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name.trim() || "Agenda";
  if (patch.url) {
    set.url = cleanFeedUrl(patch.url);
    set.lastError = null;
    set.lastOkAt = null;
  }
  if (patch.active !== undefined) set.active = patch.active;
  await db.update(calendarFeeds).set(set).where(eq(calendarFeeds.id, id));
}

export async function deleteCalendarFeed(id: string) {
  await db.delete(calendarFeeds).where(eq(calendarFeeds.id, id));
}

export async function testCalendarFeed(id: string): Promise<FeedTest> {
  const [row] = await db.select().from(calendarFeeds).where(eq(calendarFeeds.id, id));
  if (!row) throw new Error("Agenda niet gevonden");
  return testFeed({ id: row.id, name: row.name, url: row.url, lastError: row.lastError, lastOkAt: row.lastOkAt });
}
