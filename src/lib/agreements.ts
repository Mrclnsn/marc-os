import "server-only";
import { and, asc, eq, gte, inArray, isNotNull, lte, ne, or, sql } from "drizzle-orm";
import { addMonths, endOfMonth, format, parseISO } from "date-fns";
import { z } from "zod";
import { db } from "@/db";
import { agreements, clients, installments, projects, websites, type Agreement, type Installment } from "@/db/schema";
import { addDaysIso, today } from "./dates";
import { AGREEMENT_WARNING_DAYS, SERVICE_DEFAULTS, SERVICE_KIND, type ServiceKind } from "./labels";
import { perMonth } from "./money";

/* ------------------------------------------------------------------ */
/* Invoerschema's                                                      */
/* ------------------------------------------------------------------ */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Gebruik YYYY-MM-DD");
const optDate = isoDate.nullable().optional();
const optText = z.string().nullable().optional();
const optId = z.string().uuid().nullable().optional();

export const serviceKindSchema = z.enum(["bookkeeping", "website", "hosting", "maintenance", "sparring", "custom"]);
export const pricingSchema = z.enum(["recurring", "one_off", "hourly"]);
export const periodSchema = z.enum(["month", "quarter", "year"]);
export const agreementStatusSchema = z.enum(["draft", "active", "cancelled", "ended"]);
export const installmentTriggerSchema = z.enum(["date", "acceptance", "delivery"]);
export const installmentStatusSchema = z.enum(["planned", "ready", "draft", "sent", "paid"]);

export const agreementInput = z.object({
  clientId: z.string().uuid(),
  kind: serviceKindSchema,
  title: optText,
  websiteId: optId,
  projectId: optId,
  amountCents: z.number().int().min(0).optional(), // leeg = standaard voor de soort (sparringpartner €125)
  pricing: pricingSchema.optional(), // leeg = standaard voor de soort
  period: periodSchema.nullable().optional(),
  budgetCents: z.number().int().min(0).nullable().optional(),
  sessionsPerMonth: z.number().int().min(0).nullable().optional(),
  startDate: optDate,
  endDate: optDate,
  noticeMonths: z.number().int().min(0).max(36).nullable().optional(),
  indexationPct: z.number().min(0).max(100).nullable().optional(),
  status: agreementStatusSchema.optional(),
  notes: optText,
});
export type AgreementInput = z.infer<typeof agreementInput>;

export const installmentInput = z.object({
  clientId: z.string().uuid(),
  agreementId: optId,
  projectId: optId,
  description: z.string().min(1),
  amountCents: z.number().int(),
  trigger: installmentTriggerSchema.optional(),
  dueDate: optDate,
  status: installmentStatusSchema.optional(),
  moneybirdInvoiceId: optText,
  notes: optText,
});
export type InstallmentInput = z.infer<typeof installmentInput>;

/* ------------------------------------------------------------------ */
/* Regels                                                              */
/* ------------------------------------------------------------------ */

/** Telt een afspraak op `date` mee als lopende vaste omzet? (actief of opgezegd maar nog niet afgelopen) */
export function isRunning(a: Pick<Agreement, "status" | "startDate" | "endDate">, date = today()): boolean {
  if (a.status !== "active" && a.status !== "cancelled") return false;
  if (a.startDate && a.startDate > date) return false;
  if (a.endDate && a.endDate < date) return false;
  return true;
}

/** Maandbedrag (MRR-bijdrage) in centen, alleen voor vaste bedragen per periode. */
export function monthlyValue(a: Pick<Agreement, "pricing" | "amountCents" | "period">): number {
  return a.pricing === "recurring" ? perMonth(a.amountCents, a.period) : 0;
}

/** Laatste dag van de maand, `months` maanden na `from`. Standaard einddatum bij opzeggen. */
function endAfterNotice(from: string, months: number): string {
  return format(endOfMonth(addMonths(parseISO(from), months)), "yyyy-MM-dd");
}

/** Standaardnaam, bijv. "Hosting · svww.nl". */
export function agreementLabel(a: Pick<Agreement, "kind" | "title">, domain?: string | null): string {
  return a.title || [SERVICE_KIND[a.kind as ServiceKind], domain].filter(Boolean).join(" · ");
}

/* ------------------------------------------------------------------ */
/* Huishouding: statussen bijwerken die van de datum afhangen          */
/* ------------------------------------------------------------------ */

/**
 * - Termijnen "op datum" waarvan de datum bereikt is: gepland → klaar om te factureren.
 * - Opgezegde afspraken waarvan de einddatum voorbij is: → beëindigd.
 * Goedkoop en idempotent; wordt aangeroepen vóór elk overzicht.
 */
export async function settleByDate() {
  const t = today();
  await db
    .update(installments)
    .set({ status: "ready", readyAt: t })
    .where(and(eq(installments.status, "planned"), eq(installments.trigger, "date"), isNotNull(installments.dueDate), lte(installments.dueDate, t)));
  const ended = await db
    .update(agreements)
    .set({ status: "ended" })
    .where(and(inArray(agreements.status, ["active", "cancelled"]), isNotNull(agreements.endDate), sql`${agreements.endDate} < ${t}`))
    .returning({ websiteId: agreements.websiteId });
  for (const r of ended) if (r.websiteId) await syncWebsiteServices(r.websiteId);
}

/**
 * Houdt "hosting afgenomen" en "beheer afgenomen" bij een website gelijk aan de afspraken.
 * Alleen als er voor die website een afspraak van die soort bestaat; anders blijft de handmatige keuze staan.
 */
async function syncWebsiteServices(websiteId: string) {
  const rows = await db.select().from(agreements).where(eq(agreements.websiteId, websiteId));
  const patch: { hostingByUs?: boolean; maintenanceByUs?: boolean } = {};
  const hosting = rows.filter((a) => a.kind === "hosting");
  const maintenance = rows.filter((a) => a.kind === "maintenance");
  if (hosting.length) patch.hostingByUs = hosting.some((a) => isRunning(a));
  if (maintenance.length) patch.maintenanceByUs = maintenance.some((a) => isRunning(a));
  if (Object.keys(patch).length) await db.update(websites).set(patch).where(eq(websites.id, websiteId));
}

/* ------------------------------------------------------------------ */
/* Afspraken                                                           */
/* ------------------------------------------------------------------ */

export type AgreementRow = Agreement & {
  clientName: string;
  domain: string | null;
  projectName: string | null;
  monthlyCents: number;
  running: boolean;
  label: string;
};

export async function listAgreements(filter: { clientId?: string; status?: z.infer<typeof agreementStatusSchema>[]; kind?: ServiceKind } = {}): Promise<AgreementRow[]> {
  await settleByDate();
  const conds = [];
  if (filter.clientId) conds.push(eq(agreements.clientId, filter.clientId));
  if (filter.status?.length) conds.push(inArray(agreements.status, filter.status));
  if (filter.kind) conds.push(eq(agreements.kind, filter.kind));
  const rows = await db
    .select({ a: agreements, clientName: clients.name, domain: websites.domain, projectName: projects.name })
    .from(agreements)
    .innerJoin(clients, eq(agreements.clientId, clients.id))
    .leftJoin(websites, eq(agreements.websiteId, websites.id))
    .leftJoin(projects, eq(agreements.projectId, projects.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(
      sql`case ${agreements.status} when 'active' then 0 when 'cancelled' then 1 when 'draft' then 2 else 3 end`,
      asc(clients.name),
      asc(agreements.kind),
    );
  return rows.map((r) => ({
    ...r.a,
    clientName: r.clientName,
    domain: r.domain,
    projectName: r.projectName,
    monthlyCents: monthlyValue(r.a),
    running: isRunning(r.a),
    label: agreementLabel(r.a, r.domain),
  }));
}

export async function getAgreement(id: string) {
  const [row] = await db.select().from(agreements).where(eq(agreements.id, id));
  return row ?? null;
}

/** Vult pricing, periode en bedrag aan met de standaard voor de soort en ruimt velden op die niet passen. */
function normalize<T extends Partial<AgreementInput>>(data: T, kind: ServiceKind): T {
  const def = SERVICE_DEFAULTS[kind];
  const out = { ...data };
  if (!out.pricing) out.pricing = def.pricing;
  if (out.pricing === "recurring" && !out.period) out.period = def.period ?? "month";
  if (out.pricing !== "recurring") out.period = null;
  if (out.amountCents === undefined && def.amountCents !== undefined) out.amountCents = def.amountCents;
  return out;
}

/** Eindatum invullen bij opzeggen/beëindigen als die nog leeg is. */
function fillEndDate<T extends Partial<AgreementInput>>(data: T, current?: Agreement): T {
  const status = data.status ?? current?.status;
  const end = data.endDate !== undefined ? data.endDate : current?.endDate;
  if (end) return data;
  if (status === "cancelled") return { ...data, endDate: endAfterNotice(today(), data.noticeMonths ?? current?.noticeMonths ?? 0) };
  if (status === "ended" && data.status === "ended") return { ...data, endDate: today() };
  return data;
}

/**
 * Nieuwe afspraak. Eenmalig werk krijgt automatisch termijnen:
 * - website: 2 termijnen van 50% (bij akkoord en bij oplevering), plus een websiteproject als er nog geen is;
 * - overig eenmalig: 1 termijn bij oplevering.
 * Bij status actief staat de termijn "bij akkoord" direct op klaar om te factureren.
 */
export async function createAgreement(input: AgreementInput, opts: { createProject?: boolean; createInstallments?: boolean } = {}) {
  const parsed = agreementInput.parse(input);
  let data = fillEndDate(normalize(parsed, parsed.kind));
  if (data.amountCents === undefined) throw new Error("Bedrag ontbreekt");

  const oneOff = data.pricing === "one_off";
  if (oneOff && data.kind === "website" && !data.projectId && opts.createProject !== false) {
    const [domain] = data.websiteId ? await db.select({ d: websites.domain }).from(websites).where(eq(websites.id, data.websiteId)) : [];
    const [p] = await db
      .insert(projects)
      .values({
        name: data.title || `Website${domain ? ` ${domain.d}` : ""}`,
        area: "zakelijk",
        clientId: data.clientId,
        status: data.status === "active" ? "active" : "planned",
        startDate: data.startDate ?? null,
      })
      .returning();
    data = { ...data, projectId: p.id };
  }

  const [row] = await db.insert(agreements).values({ ...data, amountCents: data.amountCents!, pricing: data.pricing!, kind: data.kind }).returning();

  if (oneOff && opts.createInstallments !== false && row.amountCents > 0) {
    const name = agreementLabel(row);
    const accepted = row.status === "active";
    if (row.kind === "website") {
      const first = Math.round(row.amountCents / 2);
      await db.insert(installments).values([
        {
          clientId: row.clientId, agreementId: row.id, projectId: row.projectId, description: `${name}: 1e termijn (50%, bij akkoord)`,
          amountCents: first, trigger: "acceptance", status: accepted ? "ready" : "planned", readyAt: accepted ? today() : null, sortOrder: 1,
        },
        {
          clientId: row.clientId, agreementId: row.id, projectId: row.projectId, description: `${name}: 2e termijn (50%, bij oplevering)`,
          amountCents: row.amountCents - first, trigger: "delivery", status: "planned", sortOrder: 2,
        },
      ]);
    } else {
      await db.insert(installments).values({
        clientId: row.clientId, agreementId: row.id, projectId: row.projectId, description: name,
        amountCents: row.amountCents, trigger: "delivery", status: "planned", sortOrder: 1,
      });
    }
  }
  if (row.websiteId) await syncWebsiteServices(row.websiteId);
  return row;
}

export async function updateAgreement(id: string, patch: Partial<Omit<AgreementInput, "clientId">>) {
  const current = await getAgreement(id);
  if (!current) throw new Error("Afspraak niet gevonden");
  const parsed = agreementInput.omit({ clientId: true }).partial().parse(patch);
  const kind = parsed.kind ?? current.kind;
  let data = parsed;
  if (parsed.kind || parsed.pricing) data = normalize({ pricing: parsed.pricing ?? (parsed.kind ? undefined : current.pricing), ...parsed }, kind);
  data = fillEndDate(data, current);

  const [row] = await db.update(agreements).set(data).where(eq(agreements.id, id)).returning();

  // Akkoord: termijnen "bij akkoord" klaarzetten, gepland project actief maken
  if (current.status !== "active" && row.status === "active") {
    await db
      .update(installments)
      .set({ status: "ready", readyAt: today() })
      .where(and(eq(installments.agreementId, id), eq(installments.trigger, "acceptance"), eq(installments.status, "planned")));
    if (row.projectId) await db.update(projects).set({ status: "active" }).where(and(eq(projects.id, row.projectId), inArray(projects.status, ["idea", "planned"])));
  }

  // Bedrag gewijzigd bij eenmalig werk: openstaande termijnen naar rato meeschalen, zolang er nog niets gefactureerd is
  if (row.pricing === "one_off" && data.amountCents !== undefined && data.amountCents !== current.amountCents) {
    const list = await db.select().from(installments).where(eq(installments.agreementId, id)).orderBy(asc(installments.sortOrder), asc(installments.createdAt));
    const total = list.reduce((s, i) => s + i.amountCents, 0);
    if (list.length && total > 0 && list.every((i) => i.status === "planned" || i.status === "ready")) {
      let rest = row.amountCents;
      for (const [n, i] of list.entries()) {
        const amount = n === list.length - 1 ? rest : Math.round((i.amountCents / total) * row.amountCents);
        rest -= amount;
        await db.update(installments).set({ amountCents: amount }).where(eq(installments.id, i.id));
      }
    }
  }

  // Projectkoppeling meenemen naar de termijnen die nog niet gefactureerd zijn
  if (data.projectId !== undefined && data.projectId !== current.projectId) {
    await db.update(installments).set({ projectId: row.projectId }).where(and(eq(installments.agreementId, id), inArray(installments.status, ["planned", "ready"])));
  }

  for (const w of new Set([current.websiteId, row.websiteId])) if (w) await syncWebsiteServices(w);
  return row;
}

/**
 * Verwijdert een afspraak. Termijnen die al gefactureerd of betaald zijn blijven bewaard (los van de afspraak);
 * geplande en klaarstaande termijnen gaan mee.
 */
export async function deleteAgreement(id: string) {
  await db.update(installments).set({ agreementId: null }).where(and(eq(installments.agreementId, id), inArray(installments.status, ["draft", "sent", "paid"])));
  const [row] = await db.delete(agreements).where(eq(agreements.id, id)).returning();
  if (row?.websiteId) await syncWebsiteServices(row.websiteId);
  return row ?? null;
}

/**
 * Oplevering: termijnen "bij oplevering" van dit project (direct of via de afspraak) worden klaar om te factureren.
 * Wordt aangeroepen als een project op afgerond gaat.
 */
export async function markProjectDelivered(projectId: string) {
  const linked = db.select({ id: agreements.id }).from(agreements).where(eq(agreements.projectId, projectId));
  return db
    .update(installments)
    .set({ status: "ready", readyAt: today() })
    .where(and(eq(installments.trigger, "delivery"), eq(installments.status, "planned"), or(eq(installments.projectId, projectId), inArray(installments.agreementId, linked))))
    .returning();
}

/** Afspraak opleveren: termijnen bij oplevering klaarzetten en het gekoppelde project afronden. */
export async function deliverAgreement(id: string) {
  const a = await getAgreement(id);
  if (!a) throw new Error("Afspraak niet gevonden");
  const ready = await db
    .update(installments)
    .set({ status: "ready", readyAt: today() })
    .where(and(eq(installments.agreementId, id), eq(installments.trigger, "delivery"), eq(installments.status, "planned")))
    .returning();
  if (a.projectId) {
    await db.update(projects).set({ status: "done" }).where(and(eq(projects.id, a.projectId), ne(projects.status, "archived")));
    ready.push(...(await markProjectDelivered(a.projectId)));
  }
  return ready;
}

/* ------------------------------------------------------------------ */
/* Termijnen                                                           */
/* ------------------------------------------------------------------ */

export type InstallmentRow = Installment & { clientName: string; agreementKind: ServiceKind | null; projectName: string | null };

export async function listInstallments(
  filter: { clientId?: string; agreementId?: string; status?: z.infer<typeof installmentStatusSchema>[]; open?: boolean } = {},
): Promise<InstallmentRow[]> {
  await settleByDate();
  const conds = [];
  if (filter.clientId) conds.push(eq(installments.clientId, filter.clientId));
  if (filter.agreementId) conds.push(eq(installments.agreementId, filter.agreementId));
  if (filter.status?.length) conds.push(inArray(installments.status, filter.status));
  if (filter.open) conds.push(ne(installments.status, "paid"));
  const rows = await db
    .select({ i: installments, clientName: clients.name, agreementKind: agreements.kind, projectName: projects.name })
    .from(installments)
    .innerJoin(clients, eq(installments.clientId, clients.id))
    .leftJoin(agreements, eq(installments.agreementId, agreements.id))
    .leftJoin(projects, eq(installments.projectId, projects.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(
      sql`case ${installments.status} when 'ready' then 0 when 'draft' then 1 when 'sent' then 2 when 'planned' then 3 else 4 end`,
      sql`${installments.dueDate} asc nulls last`,
      asc(clients.name),
      asc(installments.sortOrder),
    );
  return rows.map((r) => ({ ...r.i, clientName: r.clientName, agreementKind: r.agreementKind, projectName: r.projectName }));
}

export async function getInstallment(id: string) {
  const [row] = await db.select().from(installments).where(eq(installments.id, id));
  return row ?? null;
}

/** Datums die bij een status horen; bestaande datums blijven staan. */
function statusDates(status: z.infer<typeof installmentStatusSchema> | undefined, current?: Installment) {
  const t = today();
  const out: Partial<Installment> = {};
  if (!status) return out;
  if (status === "ready" && !current?.readyAt) out.readyAt = t;
  if ((status === "draft" || status === "sent") && !current?.invoicedAt) out.invoicedAt = t;
  if (status === "paid") {
    if (!current?.paidAt) out.paidAt = t;
    if (!current?.invoicedAt) out.invoicedAt = t;
  }
  if (status === "planned") Object.assign(out, { readyAt: null, invoicedAt: null, paidAt: null });
  return out;
}

export async function createInstallment(input: InstallmentInput) {
  const data = installmentInput.parse(input);
  if (data.agreementId && !data.projectId) {
    const a = await getAgreement(data.agreementId);
    if (a) data.projectId = a.projectId;
  }
  // Datum al bereikt? Dan direct klaar om te factureren
  if (!data.status && (data.trigger ?? "date") === "date" && data.dueDate && data.dueDate <= today()) data.status = "ready";
  const [row] = await db.insert(installments).values({ ...data, ...statusDates(data.status) }).returning();
  return row;
}

export async function updateInstallment(id: string, patch: Partial<Omit<InstallmentInput, "clientId">> & { invoicedAt?: string | null; paidAt?: string | null }) {
  const current = await getInstallment(id);
  if (!current) throw new Error("Termijn niet gevonden");
  const { invoicedAt, paidAt, ...rest } = patch;
  const data = installmentInput.omit({ clientId: true }).partial().parse(rest);
  const dates = { ...statusDates(data.status, current), ...(invoicedAt !== undefined ? { invoicedAt } : {}), ...(paidAt !== undefined ? { paidAt } : {}) };
  const [row] = await db.update(installments).set({ ...data, ...dates }).where(eq(installments.id, id)).returning();

  // Eenmalige afspraak helemaal betaald: afspraak beëindigd
  if (row.agreementId && row.status === "paid") {
    const a = await getAgreement(row.agreementId);
    if (a && a.pricing === "one_off" && a.status === "active") {
      const open = await db.select({ n: sql<number>`count(*)::int` }).from(installments).where(and(eq(installments.agreementId, a.id), ne(installments.status, "paid")));
      if (open[0].n === 0) await db.update(agreements).set({ status: "ended", endDate: a.endDate ?? today() }).where(eq(agreements.id, a.id));
    }
  }
  return row;
}

export async function deleteInstallment(id: string) {
  const [row] = await db.delete(installments).where(eq(installments.id, id)).returning();
  return row ?? null;
}

/* ------------------------------------------------------------------ */
/* Omzet: MRR, jaaromzet vast, verwachte omzet per maand, per klant    */
/* ------------------------------------------------------------------ */

const monthKey = (iso: string) => iso.slice(0, 7);

/** Eerste dag van de maand, `n` maanden na de maand van `iso`. */
function monthStart(iso: string, n = 0) {
  return format(addMonths(parseISO(`${iso.slice(0, 7)}-01`), n), "yyyy-MM-dd");
}

/**
 * Wordt een vaste afspraak in deze maand gefactureerd?
 * Per maand: elke maand. Per kwartaal: januari, april, juli, oktober. Per jaar: in de maand van de startdatum (anders januari).
 */
function billedInMonth(a: Agreement, mStart: string): boolean {
  if (a.pricing !== "recurring" || !a.period) return false;
  if (a.status !== "active" && a.status !== "cancelled") return false;
  const mEnd = format(endOfMonth(parseISO(mStart)), "yyyy-MM-dd");
  if (a.startDate && a.startDate > mEnd) return false;
  if (a.endDate && a.endDate < mStart) return false;
  const m = Number(mStart.slice(5, 7));
  if (a.period === "month") return true;
  if (a.period === "quarter") return (m - 1) % 3 === 0;
  const anchor = a.startDate ? Number(a.startDate.slice(5, 7)) : 1;
  return m === anchor;
}

export type MonthForecast = { month: string; recurringCents: number; installmentsCents: number; totalCents: number };

export type RevenueOverview = {
  date: string;
  mrrCents: number;
  arrCents: number; // jaaromzet vast = MRR x 12
  activeRecurring: number;
  byKind: { kind: ServiceKind; mrrCents: number; count: number }[];
  byClient: { clientId: string; clientName: string; mrrCents: number; openInstallmentsCents: number; paidThisYearCents: number }[];
  forecast: MonthForecast[]; // komende 12 maanden, inclusief de huidige
  undatedInstallmentsCents: number; // geplande termijnen zonder datum (bijv. bij oplevering)
  ready: { count: number; cents: number }; // klaar om te factureren
  invoicedOpen: { count: number; cents: number }; // gefactureerd, nog niet betaald
  ending: AgreementRow[]; // lopende afspraken die binnen 30 dagen eindigen
  hourly: AgreementRow[]; // maatwerk op uurbasis (omzet volgt uit uren, gesprek 3)
};

export async function revenueOverview(months = 12): Promise<RevenueOverview> {
  const t = today();
  const [all, inst] = await Promise.all([listAgreements(), listInstallments()]);

  const running = all.filter((a) => a.running && a.pricing === "recurring");
  const mrrCents = Math.round(running.reduce((s, a) => s + a.monthlyCents, 0));

  const kinds = new Map<ServiceKind, { mrrCents: number; count: number }>();
  for (const a of running) {
    const k = kinds.get(a.kind) ?? { mrrCents: 0, count: 0 };
    k.mrrCents += a.monthlyCents;
    k.count += 1;
    kinds.set(a.kind, k);
  }

  const year = t.slice(0, 4);
  const clientsMap = new Map<string, RevenueOverview["byClient"][number]>();
  const touch = (id: string, name: string) => {
    if (!clientsMap.has(id)) clientsMap.set(id, { clientId: id, clientName: name, mrrCents: 0, openInstallmentsCents: 0, paidThisYearCents: 0 });
    return clientsMap.get(id)!;
  };
  for (const a of running) touch(a.clientId, a.clientName).mrrCents += a.monthlyCents;
  for (const i of inst) {
    if (i.status === "paid") {
      if (i.paidAt?.startsWith(year)) touch(i.clientId, i.clientName).paidThisYearCents += i.amountCents;
    } else touch(i.clientId, i.clientName).openInstallmentsCents += i.amountCents;
  }

  const forecast: MonthForecast[] = [];
  for (let n = 0; n < months; n++) {
    const m = monthStart(t, n);
    const recurringCents = all.filter((a) => billedInMonth(a, m)).reduce((s, a) => s + a.amountCents, 0);
    const installmentsCents = inst
      .filter((i) => {
        if (i.status === "paid") return false;
        // Klaarstaand of gefactureerd zonder datum: hoort bij deze maand
        if (!i.dueDate) return n === 0 && i.status !== "planned";
        return n === 0 ? i.dueDate < monthStart(t, 1) : monthKey(i.dueDate) === monthKey(m);
      })
      .reduce((s, i) => s + i.amountCents, 0);
    forecast.push({ month: m, recurringCents, installmentsCents, totalCents: recurringCents + installmentsCents });
  }

  const sum = (list: Installment[]) => ({ count: list.length, cents: list.reduce((s, i) => s + i.amountCents, 0) });
  const horizon = addDaysIso(t, AGREEMENT_WARNING_DAYS);

  return {
    date: t,
    mrrCents,
    arrCents: mrrCents * 12,
    activeRecurring: running.length,
    byKind: [...kinds.entries()].map(([kind, v]) => ({ kind, mrrCents: Math.round(v.mrrCents), count: v.count })).sort((a, b) => b.mrrCents - a.mrrCents),
    byClient: [...clientsMap.values()]
      .map((c) => ({ ...c, mrrCents: Math.round(c.mrrCents) }))
      .sort((a, b) => b.mrrCents - a.mrrCents || b.openInstallmentsCents - a.openInstallmentsCents),
    forecast,
    undatedInstallmentsCents: inst.filter((i) => i.status === "planned" && !i.dueDate).reduce((s, i) => s + i.amountCents, 0),
    ready: sum(inst.filter((i) => i.status === "ready")),
    invoicedOpen: sum(inst.filter((i) => i.status === "draft" || i.status === "sent")),
    ending: all.filter((a) => a.running && a.endDate && a.endDate <= horizon),
    hourly: all.filter((a) => a.pricing === "hourly" && (a.status === "active" || a.status === "cancelled")),
  };
}

/** MRR van één klant (voor het dossier). */
export async function clientMrr(clientId: string): Promise<number> {
  const rows = await listAgreements({ clientId });
  return Math.round(rows.filter((a) => a.running).reduce((s, a) => s + a.monthlyCents, 0));
}

/** Signalen voor Vandaag: wat klaarstaat om te factureren en afspraken die binnenkort eindigen. */
export async function revenueSignals() {
  const t = today();
  const [ready, ending] = await Promise.all([
    listInstallments({ status: ["ready"] }),
    db
      .select({ a: agreements, clientName: clients.name, domain: websites.domain })
      .from(agreements)
      .innerJoin(clients, eq(agreements.clientId, clients.id))
      .leftJoin(websites, eq(agreements.websiteId, websites.id))
      .where(and(inArray(agreements.status, ["active", "cancelled"]), isNotNull(agreements.endDate), gte(agreements.endDate, t), lte(agreements.endDate, addDaysIso(t, AGREEMENT_WARNING_DAYS))))
      .orderBy(asc(agreements.endDate)),
  ]);
  return {
    ready,
    ending: ending.map((r) => ({ ...r.a, clientName: r.clientName, label: agreementLabel(r.a, r.domain) })),
  };
}

