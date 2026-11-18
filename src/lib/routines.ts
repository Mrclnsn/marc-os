import "server-only";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { agentProposals, agentRoutineRuns, settings, type AgentRoutineRun } from "@/db/schema";
import * as agent from "./agent";
import { addDaysIso, TIMEZONE, today } from "./dates";
import { askHermes, hermesConfig } from "./hermes";
import { morningMessage, sendPush } from "./push";
import { dayRhythms } from "./rhythm";
import { isoWeekday } from "./rhythm-shared";
import { getModules } from "./settings";
import { proposalsBlock, sendWhatsApp, whatsappConfig } from "./whatsapp";
import {
  defaultRoutineSettings,
  firstLine,
  isDue,
  isTime,
  ROUTINE_KEYS,
  ROUTINES,
  routinePeriod,
  scheduleLabel,
  upsertSection,
  type DueContext,
  type RoutineKey,
  type RoutineSetting,
  type RoutineSettings,
} from "./routines-shared";
import type { Modules } from "./modules";

/*
 * Vaste routines van Hermes (gesprek 13).
 * Marc OS plant ze (cron op de VPS, elke 5 minuten /api/notify/routines) en houdt per run de status bij.
 * Hermes schrijft de tekst via zijn eigen API (/v1/responses) met de tools van Marc OS; wijzigingen (dagindeling,
 * taken verschuiven) worden voorstellen in de akkoordwachtrij. Marc OS slaat de tekst op als review en stuurt hem
 * naar WhatsApp en/of als pushmelding, met de voorstellen eronder.
 */

/* ---------------- Instellingen ---------------- */

export async function getRoutineSettings(): Promise<RoutineSettings> {
  const [row] = await db.select().from(settings).where(eq(settings.key, "routines"));
  const stored = (row?.value ?? {}) as Partial<Record<RoutineKey, Partial<RoutineSetting>>>;
  const out = defaultRoutineSettings();
  for (const k of ROUTINE_KEYS) {
    const s = stored[k];
    if (!s) continue;
    if (typeof s.enabled === "boolean") out[k].enabled = s.enabled;
    if (isTime(s.time)) out[k].time = s.time;
    if (typeof s.weekday === "number" && s.weekday >= 1 && s.weekday <= 7) out[k].weekday = s.weekday;
    if (typeof s.whatsapp === "boolean") out[k].whatsapp = s.whatsapp;
    if (typeof s.push === "boolean") out[k].push = s.push;
  }
  return out;
}

export async function setRoutineSetting(key: RoutineKey, patch: Partial<RoutineSetting>) {
  if (!ROUTINE_KEYS.includes(key)) throw new Error("Onbekende routine");
  if (patch.time !== undefined && !isTime(patch.time)) throw new Error("Tijd als UU:MM");
  if (patch.weekday !== undefined && !(patch.weekday >= 1 && patch.weekday <= 7)) throw new Error("Ongeldige weekdag");
  const all = await getRoutineSettings();
  const next = { ...all, [key]: { ...all[key], ...patch } };
  await db.insert(settings).values({ key: "routines", value: next }).onConflictDoUpdate({ target: settings.key, set: { value: next, updatedAt: new Date() } });
  const changed = Object.entries(patch)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  await agent.log({ actor: "marc", kind: "direct", tool: "routine", summary: `${ROUTINES[key].label}: ${changed}` });
  return next[key];
}

/** Waarom een routine nu niet kan lopen (of null als hij kan). */
export function blockedReason(key: RoutineKey, modules: Modules, hermesReady: boolean): string | null {
  if (!hermesReady) return "Hermes is niet geïnstalleerd";
  const m = ROUTINES[key].module;
  if (m && !modules[m]) return "module staat uit";
  return null;
}

/* ---------------- Tijd ---------------- */

function nowMinutes(): number {
  const parts = new Intl.DateTimeFormat("nl-NL", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  return (Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24) * 60 + Number(parts.find((p) => p.type === "minute")?.value ?? 0);
}

async function dueContext(date = today(), minutes = nowMinutes()): Promise<DueContext> {
  // Werkdagen uit het dagritme (een vrije dag of weekend zonder werkdag telt niet)
  const first = `${date.slice(0, 8)}01`;
  const days: string[] = [];
  for (let d = first; d <= date; d = addDaysIso(d, 1)) days.push(d);
  const rhythms = await dayRhythms(days);
  const workday = !!rhythms.get(date)?.work;
  const firstWork = days.find((d) => !!rhythms.get(d)?.work) ?? null;
  return { date, minutes, weekday: isoWeekday(date), workday, firstWorkdayOfMonth: workday && firstWork === date };
}

const longDate = (iso: string) =>
  new Intl.DateTimeFormat("nl-NL", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));

/* ---------------- Opdrachten voor Hermes ---------------- */

const FORMAT = [
  "Vorm: platte tekst voor WhatsApp en de app. Korte alinea's en lijstjes met '- '. Geen kopjes, geen tabellen, geen vet.",
  "Begin direct met de inhoud (geen aanhef als 'Hier is je briefing').",
  "Gebruik save_review en send_push NIET: Marc OS slaat je antwoord zelf op en stuurt het naar Marc.",
  "Wat iets wijzigt (plan_task, update_task, create_task) wordt een voorstel in de akkoordwachtrij. Noem in je tekst kort wat je hebt voorgesteld; Marc OS zet de nummers eronder.",
].join("\n");

function prompt(key: RoutineKey, ctx: { date: string; modules: Modules }): string {
  const { date, modules } = ctx;
  const nextWorkday = isoWeekday(date) >= 5 ? addDaysIso(date, 8 - isoWeekday(date)) : addDaysIso(date, 1);
  const lines: string[] = [];
  switch (key) {
    case "briefing":
      lines.push(
        `Vaste routine: ochtendbriefing voor vandaag, ${longDate(date)} (${date}).`,
        "Haal get_overview en get_day_plan op.",
        "Schrijf een korte ochtendbriefing (hooguit 15 regels): de afspraken van vandaag, het dagritme en hoeveel werktijd er vrij is, de 1 tot 3 belangrijkste taken (houd rekening met de vrije tijd tussen afspraken), wat achterstallig is, de gewoontes van vandaag, het hoofddoel en doelen met risico, slaap of sport als dat opvalt, en wat er in de inbox staat.",
        "Stel daarna de dagindeling voor: zet de belangrijkste taken voor vandaag die nog geen blok hebben in een passend blok met plan_task (hooguit 5 voorstellen, alleen taken die echt vandaag passen). Heeft alles al een plek, doe dan geen voorstellen.",
      );
      break;
    case "dagafsluiting":
      lines.push(
        `Vaste routine: dagafsluiting voor vandaag, ${longDate(date)} (${date}).`,
        `Haal get_overview, get_day_plan en completed_tasks (from en to ${date}) op${modules.uren ? `, en list_time_entries voor ${date}` : ""}.`,
        "Vat kort samen: wat is gedaan tegenover wat gepland was, welke gewoontes van vandaag nog open staan, en welke open eindjes er zijn.",
        modules.uren ? "Meld het als de timer nog loopt, of als er voor afgeronde klanttaken geen uren staan." : "",
        `Stel voor om taken die vandaag gepland waren en niet af zijn naar de volgende werkdag (${nextWorkday}) te schuiven met plan_task (hooguit 5 voorstellen; geen voorstel voor taken die al later staan).`,
        "Sluit af met één zin voor morgen: waar Marc mee begint.",
      );
      break;
    case "weekreview": {
      const ws = routinePeriod("weekreview", date);
      const tools = ["completed_tasks (deze week)", "get_health", "list_goals (running=true)", "list_learning", "list_habits", "list_projects", "list_tasks (view=open)", "get_week_plan voor volgende week"];
      if (modules.uren) tools.push("get_hours (period=month)");
      if (modules.pipeline) tools.push("get_pipeline");
      if (modules.aangiftes) tools.push("list_filings");
      if (modules.afspraken) tools.push("list_installments (klaar om te factureren)");
      lines.push(
        `Vaste routine: weekreview van de week die begon op ${longDate(ws)} (${ws}). Vandaag is het ${longDate(date)}.`,
        `Haal op: ${tools.join(", ")}.`,
        "Maak een weekreview: wat is bereikt per klant en privé, welke projecten achterlopen, wat structureel blijft liggen, gewoontes (percentage), sport, stappen, slaap en gewicht tegenover de doelen, alle lopende doelen met status en wat er nodig is, en de tijd aan leren.",
        modules.uren ? "Uren per klant (declarabel/totaal), budgetten boven 80% en opvallend lage effectieve uurtarieven." : "",
        modules.afspraken ? "Wat er klaarstaat om te factureren." : "",
        modules.pipeline ? "De pipeline: open leads zonder volgende stap, offertes zonder reactie, gewonnen en verloren." : "",
        modules.aangiftes ? "Aangiftes: deadlines in de komende twee weken en stukken die ontbreken." : "",
        "Sluit af met een voorstel voor de focus van volgende week (3 punten). Plan hooguit 5 belangrijke taken zonder datum in voor volgende week met plan_task.",
      );
      break;
    }
    case "maandafsluiting": {
      const prevFirst = `${addDaysIso(`${date.slice(0, 8)}01`, -1).slice(0, 8)}01`;
      const prevLast = addDaysIso(`${date.slice(0, 8)}01`, -1);
      lines.push(
        `Vaste routine: maandafsluiting over de vorige maand (${prevFirst} tot en met ${prevLast}). Vandaag is het ${longDate(date)}.`,
        `Haal op: completed_tasks (from ${prevFirst}, to ${prevLast}), list_goals (running=true), list_habits, get_health, list_learning, list_reviews (week)${modules.afspraken ? ", get_revenue en list_installments" : ""}${modules.uren ? ", get_hours (period=month)" : ""}.`,
        "Maak een maandoverzicht: wat is bereikt (zakelijk en privé), hoe de doelen ervoor staan (ook doelen die deze maand afliepen), gewoontes, gezondheid en leren in het kort, en wat opviel in de weekreviews.",
        modules.afspraken ? "Geef de MRR en wat er klaarstaat om te factureren, zodat Marc de facturen kan versturen." : "",
        "Sluit af met 3 aandachtspunten voor deze maand. Doe geen voorstellen.",
      );
      break;
    }
    case "aangiftecheck":
      lines.push(
        `Vaste routine: aangiftecheck, ${longDate(date)} (${date}).`,
        "Haal list_filings op. Geef per klant de aangiftes met een deadline binnen 14 dagen of die te laat zijn, en de aangiftes waarvan de stukken ontbreken.",
        "Maak voor elke aangifte waarvan de periode is afgelopen en de stukken nog niet zijn opgevraagd een conceptmail met draft_docs_reminder en zet die in je antwoord, zodat Marc ze zelf kan versturen.",
        "Verstuur niets, wijzig geen statussen en doe geen voorstellen. Is er niets te melden, zeg dat in één zin.",
      );
      break;
  }
  return [...lines.filter(Boolean), "", FORMAT].join("\n");
}

const ROUTINE_NOTE =
  "Kanaal: vaste routine van Marc OS (geen chat). Marc leest je antwoord later in WhatsApp of de app; je kunt hem nu niets vragen. Antwoord in het Nederlands, kort en concreet.";

/* ---------------- Runs ---------------- */

export async function listRuns(opts: { limit?: number; routine?: RoutineKey; since?: Date } = {}) {
  return db
    .select()
    .from(agentRoutineRuns)
    .where(and(opts.routine ? eq(agentRoutineRuns.routine, opts.routine) : undefined, opts.since ? gte(agentRoutineRuns.startedAt, opts.since) : undefined))
    .orderBy(desc(agentRoutineRuns.startedAt))
    .limit(opts.limit ?? 30);
}

/** Runs die langer dan 20 minuten "bezig" staan zijn afgebroken (bijv. door een herstart). */
async function closeStale() {
  await db
    .update(agentRoutineRuns)
    .set({ status: "failed", finishedAt: new Date(), error: "Afgebroken (geen antwoord binnen 20 minuten, of de app is herstart)" })
    .where(and(eq(agentRoutineRuns.status, "running"), lt(agentRoutineRuns.startedAt, sql`now() - interval '20 minutes'`)));
}

/**
 * Een routine draaien. trigger "schedule" kan per periode maar één keer (unieke index); "manual" altijd.
 * Geeft de run terug, of null als hij al liep.
 */
export async function runRoutine(key: RoutineKey, trigger: "schedule" | "manual" = "manual", date = today()): Promise<AgentRoutineRun | null> {
  const period = routinePeriod(key, date);
  const [run] = await db
    .insert(agentRoutineRuns)
    .values({ routine: key, period, trigger })
    .onConflictDoNothing()
    .returning();
  if (!run) return null;
  try {
    return await execute(run, key, date);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    const [done] = await db.update(agentRoutineRuns).set({ status: "failed", finishedAt: new Date(), error }).where(eq(agentRoutineRuns.id, run.id)).returning();
    await agent.log({ actor: "hermes", kind: "routine", tool: key, summary: `${ROUTINES[key].label} mislukt: ${error}`, detail: { runId: run.id } });
    return done;
  }
}

async function execute(run: AgentRoutineRun, key: RoutineKey, date: string): Promise<AgentRoutineRun> {
  const def = ROUTINES[key];
  const [modules, all] = await Promise.all([getModules(), getRoutineSettings()]);
  const setting = all[key];
  const since = await agent.dbNow();
  const conversation = `marc-os-routine-${key}-${run.period}${run.trigger === "manual" ? `-${run.id.slice(0, 8)}` : ""}`;

  const blocked = blockedReason(key, modules, hermesConfig().configured);
  agent.quietProposalPush(13 * 60_000);
  const answer = blocked
    ? { ok: false as const, error: blocked, text: "", tools: [] as string[] }
    : await askHermes(conversation, prompt(key, { date, modules }), { instructions: ROUTINE_NOTE, timeoutMs: 12 * 60_000 });

  const proposals = await db
    .select({ id: agentProposals.id, nr: agentProposals.nr, title: agentProposals.title })
    .from(agentProposals)
    .where(and(gte(agentProposals.createdAt, since), eq(agentProposals.actor, "hermes"), eq(agentProposals.status, "pending")))
    .orderBy(agentProposals.nr);

  agent.quietProposalPush(0);
  const delivered: Record<string, string> = {};

  if (!answer.ok) {
    const error = answer.error ?? "Mislukt";
    const [done] = await db
      .update(agentRoutineRuns)
      .set({ status: "failed", finishedAt: new Date(), error, tools: answer.tools, proposalIds: proposals.map((p) => p.id) })
      .where(eq(agentRoutineRuns.id, run.id))
      .returning();
    await agent.log({ actor: "hermes", kind: "routine", tool: key, summary: `${def.label} mislukt: ${error}`, detail: { runId: run.id } });
    // Melden, en de ochtend niet zonder overzicht laten: dan het gewone ochtendoverzicht
    await sendPush({ title: `${def.label} mislukt`, body: error.slice(0, 200), url: "/hermes?tab=routines", tag: `routine-${key}` }, "system").catch(() => null);
    if (key === "briefing") await sendPush(await morningMessage(), "morning").catch(() => null);
    return done;
  }

  // Opslaan als review, onder een eigen kopje (de dag-review bevat briefing en dagafsluiting)
  const { listReviews, saveReview } = await import("./data");
  const reviewPeriod =
    def.review === "day" ? date : def.review === "week" ? routinePeriod("weekreview", date) : `${addDaysIso(`${date.slice(0, 8)}01`, -1).slice(0, 8)}01`;
  const existing = (await listReviews(def.review, 60)).find((r) => r.periodDate === reviewPeriod);
  const review = await saveReview(def.review, reviewPeriod, upsertSection(existing?.body, def.heading, answer.text));

  // Afleveren: WhatsApp (tekst met de voorstellen eronder) en een pushmelding
  const header = `${def.label} · ${longDate(date)}`;
  if (setting.whatsapp && whatsappConfig().configured) {
    const r = await sendWhatsApp([header, "", answer.text, proposals.length ? `\n${proposalsBlock(proposals)}` : ""].join("\n").trim());
    delivered.whatsapp = r.ok ? "ok" : r.error;
  }
  if (setting.push) {
    const p = await sendPush(
      {
        title: proposals.length ? `${def.label} · ${proposals.length} voorstel${proposals.length === 1 ? "" : "len"}` : def.label,
        body: firstLine(answer.text),
        url: proposals.length ? "/hermes?tab=akkoord" : def.href,
        tag: `routine-${key}`,
      },
      "routines",
    ).catch((e) => ({ skipped: e instanceof Error ? e.message : String(e), sent: 0 }));
    delivered.push = p.skipped ? p.skipped : `${p.sent} apparaat${p.sent === 1 ? "" : "en"}`;
  }

  const [done] = await db
    .update(agentRoutineRuns)
    .set({
      status: "ok",
      finishedAt: new Date(),
      summary: firstLine(answer.text, 240),
      reviewId: review.id,
      tools: answer.tools,
      proposalIds: proposals.map((p) => p.id),
      delivered,
    })
    .where(eq(agentRoutineRuns.id, run.id))
    .returning();
  await agent.log({
    actor: "hermes",
    kind: "routine",
    tool: key,
    summary: `${def.label}${run.trigger === "manual" ? " (handmatig)" : ""}: klaar${proposals.length ? `, ${proposals.length} voorstel${proposals.length === 1 ? "" : "len"}` : ""}${delivered.whatsapp ? `, WhatsApp ${delivered.whatsapp}` : ""}`,
    detail: { runId: run.id, tools: answer.tools },
  });
  return done;
}

/**
 * Elke 5 minuten vanuit de cron: welke routines zijn nu aan de beurt? Die starten op de achtergrond
 * (een run kan een paar minuten duren), het antwoord komt direct terug.
 */
export async function tickRoutines(now?: { date: string; minutes: number }) {
  await closeStale();
  const [all, modules, ctx] = await Promise.all([getRoutineSettings(), getModules(), dueContext(now?.date, now?.minutes)]);
  const ready = hermesConfig().configured;
  const started: string[] = [];
  const skipped: string[] = [];
  for (const key of ROUTINE_KEYS) {
    if (!isDue(key, all[key], ctx)) continue;
    const why = blockedReason(key, modules, ready);
    if (why) {
      skipped.push(`${key}: ${why}`);
      continue;
    }
    const period = routinePeriod(key, ctx.date);
    const [prev] = await db
      .select({ id: agentRoutineRuns.id })
      .from(agentRoutineRuns)
      .where(and(eq(agentRoutineRuns.routine, key), eq(agentRoutineRuns.period, period), eq(agentRoutineRuns.trigger, "schedule")));
    if (prev) continue;
    started.push(key);
    void runRoutine(key, "schedule", ctx.date).catch((e) => console.error("routine", key, e));
  }
  return { date: ctx.date, time: `${String(Math.floor(ctx.minutes / 60)).padStart(2, "0")}:${String(ctx.minutes % 60).padStart(2, "0")}`, started, skipped };
}

/** Neemt de ochtendbriefing van Hermes vandaag het ochtendoverzicht (push 07:30) over? */
export async function briefingReplacesMorningPush(): Promise<boolean> {
  if (!hermesConfig().configured) return false;
  const [s, ctx] = await Promise.all([getRoutineSettings(), dueContext(today(), 0)]);
  return s.briefing.enabled && ctx.workday;
}

/* ---------------- Status voor de cockpit en de pagina Routines ---------------- */

export type RoutineStatus = {
  key: RoutineKey;
  label: string;
  description: string;
  schedule: string;
  setting: RoutineSetting;
  blocked: string | null;
  /** Run van de huidige periode (vandaag, deze week, deze maand), als die er is */
  current: { status: string; at: string; summary: string | null; error: string | null; proposals: number } | null;
  last: { status: string; at: string; trigger: string } | null;
};

export async function routineStatuses(date = today()): Promise<RoutineStatus[]> {
  const [all, modules] = await Promise.all([getRoutineSettings(), getModules()]);
  const ready = hermesConfig().configured;
  const runs = await db
    .select()
    .from(agentRoutineRuns)
    .where(gte(agentRoutineRuns.startedAt, sql`now() - interval '40 days'`))
    .orderBy(desc(agentRoutineRuns.startedAt));
  return ROUTINE_KEYS.map((key) => {
    const period = routinePeriod(key, date);
    const mine = runs.filter((r) => r.routine === key);
    const cur = mine.find((r) => r.period === period) ?? null;
    const last = mine[0] ?? null;
    return {
      key,
      label: ROUTINES[key].label,
      description: ROUTINES[key].description,
      schedule: scheduleLabel(key, all[key]),
      setting: all[key],
      blocked: blockedReason(key, modules, ready),
      current: cur
        ? {
            status: cur.status,
            at: (cur.finishedAt ?? cur.startedAt).toISOString(),
            summary: cur.summary,
            error: cur.error,
            proposals: cur.proposalIds?.length ?? 0,
          }
        : null,
      last: last ? { status: last.status, at: (last.finishedAt ?? last.startedAt).toISOString(), trigger: last.trigger } : null,
    };
  });
}

/** Mislukte routines van de afgelopen 24 uur waar daarna geen geslaagde run van die routine op volgde (signaal in de cockpit). */
export async function routineFailures() {
  const rows = await db
    .select({ routine: agentRoutineRuns.routine, status: agentRoutineRuns.status, at: agentRoutineRuns.startedAt, error: agentRoutineRuns.error })
    .from(agentRoutineRuns)
    .where(gte(agentRoutineRuns.startedAt, sql`now() - interval '24 hours'`))
    .orderBy(desc(agentRoutineRuns.startedAt));
  const seen = new Set<string>();
  const out: { routine: string; label: string; error: string | null; at: Date }[] = [];
  for (const r of rows) {
    if (seen.has(r.routine)) continue;
    seen.add(r.routine);
    if (r.status === "failed") out.push({ routine: r.routine, label: ROUTINES[r.routine as RoutineKey]?.label ?? r.routine, error: r.error, at: r.at });
  }
  return out;
}
