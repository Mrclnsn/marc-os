import "server-only";
import ical from "node-ical";
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

type Feed = { name: string; url: string };

/** CALENDAR_ICS_URLS="Werk|https://...ics,Privé|https://...ics" */
function feeds(): Feed[] {
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

const cache = new Map<string, { at: number; body: string }>();
const TTL = 5 * 60 * 1000;

async function fetchIcs(url: string): Promise<string> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL) return hit.body;
  const res = await fetch(url.replace(/^webcal:/, "https:"), { cache: "no-store" });
  if (!res.ok) throw new Error(`Agenda ophalen mislukt (${res.status})`);
  const body = await res.text();
  cache.set(url, { at: Date.now(), body });
  return body;
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
  const list = feeds();
  const from = new Date(`${fromIso}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 1); // marge voor tijdzones
  const to = new Date(`${addDaysIso(toIso, 1)}T23:59:59Z`);
  const events: CalendarEvent[] = [];
  const errors: string[] = [];

  await Promise.all(
    list.map(async (feed) => {
      try {
        const parsed = ical.sync.parseICS(await fetchIcs(feed.url));
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
      } catch (e) {
        errors.push(`${feed.name}: ${(e as Error).message}`);
      }
    }),
  );

  events.sort((a, b) => (a.date === b.date ? (a.allDay === b.allDay ? a.start.localeCompare(b.start) : a.allDay ? -1 : 1) : a.date.localeCompare(b.date)));
  return { events, errors };
}

export function calendarConfigured() {
  return feeds().length > 0;
}
