import "server-only";
import { and, asc, desc, eq, gte, inArray, isNotNull, like, lte, ne, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { clients, leads, quoteLines, quotes, websites, type Lead, type Quote, type QuoteLine } from "@/db/schema";
import { addDaysIso, today } from "./dates";
import { agreementLabel, createAgreement, serviceKindSchema, pricingSchema, periodSchema } from "./agreements";
import { cleanDomain, createClient, createDocument, createWebsite, getClient, updateClient } from "./data";
import {
  LEAD_DEFAULT_PROBABILITY,
  OPEN_LEAD_STATUSES,
  QUOTE_VALID_DAYS,
  QUOTE_WARNING_DAYS,
  SERVICE_DEFAULTS,
  type LeadStatus,
  type ServiceKind,
} from "./labels";
import { perMonth } from "./money";

/* ------------------------------------------------------------------ */
/* Invoerschema's                                                      */
/* ------------------------------------------------------------------ */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Gebruik YYYY-MM-DD");
const optDate = isoDate.nullable().optional();
const optText = z.string().nullable().optional();
const optId = z.string().uuid().nullable().optional();

export const leadStatusSchema = z.enum(["new", "contact", "quoted", "won", "lost"]);
export const quoteStatusSchema = z.enum(["draft", "sent", "accepted", "rejected", "expired"]);

export const leadInput = z.object({
  title: z.string().min(1),
  companyName: z.string().nullable().optional(), // leeg bij een bestaande klant: dan de klantnaam
  clientId: optId,
  contactName: optText,
  contactEmail: optText,
  contactPhone: optText,
  source: optText,
  interests: z.array(serviceKindSchema).optional(),
  estimatedValueCents: z.number().int().min(0).nullable().optional(),
  probabilityPct: z.number().int().min(0).max(100).optional(),
  nextStep: optText,
  nextStepDate: optDate,
  status: leadStatusSchema.optional(),
  lostReason: optText,
  notes: optText,
});
export type LeadInput = z.infer<typeof leadInput>;

export const quoteLineInput = z.object({
  kind: serviceKindSchema,
  description: optText,
  amountCents: z.number().int().min(0).optional(), // leeg = standaard voor de soort (sparringpartner €125)
  pricing: pricingSchema.optional(), // leeg = standaard voor de soort
  period: periodSchema.nullable().optional(),
  budgetCents: z.number().int().min(0).nullable().optional(),
  sessionsPerMonth: z.number().int().min(0).nullable().optional(),
  domain: optText,
  startDate: optDate,
  sortOrder: z.number().int().optional(),
});
export type QuoteLineInput = z.infer<typeof quoteLineInput>;

export const quoteInput = z.object({
  leadId: z.string().uuid(),
  title: optText,
  quoteDate: optDate,
  validUntil: optDate,
  status: quoteStatusSchema.optional(),
  url: optText,
  notes: optText,
  lines: z.array(quoteLineInput).optional(),
});
export type QuoteInput = z.infer<typeof quoteInput>;

/* ------------------------------------------------------------------ */
/* Bedragen van een offerte                                            */
/* ------------------------------------------------------------------ */

export type QuoteTotals = {
  oneOffCents: number; // eenmalig
  monthlyCents: number; // vaste bedragen omgerekend naar per maand (wordt MRR bij akkoord)
  hourlyBudgetCents: number; // budgetten van uurtarief-regels
  hourlyLines: number; // uurtarief-regels (zonder budget tellen ze niet mee in de waarde)
  firstYearCents: number; // waarde eerste jaar: eenmalig + 12 x maandbedrag + budgetten
};

export function quoteTotals(lines: Pick<QuoteLine, "pricing" | "amountCents" | "period" | "budgetCents">[]): QuoteTotals {
  let oneOffCents = 0;
  let monthly = 0;
  let hourlyBudgetCents = 0;
  let hourlyLines = 0;
  for (const l of lines) {
    if (l.pricing === "one_off") oneOffCents += l.amountCents;
    else if (l.pricing === "recurring") monthly += perMonth(l.amountCents, l.period);
    else {
      hourlyLines += 1;
      hourlyBudgetCents += l.budgetCents ?? 0;
    }
  }
  const monthlyCents = Math.round(monthly);
  return { oneOffCents, monthlyCents, hourlyBudgetCents, hourlyLines, firstYearCents: oneOffCents + Math.round(monthly * 12) + hourlyBudgetCents };
}

/** Vult prijsvorm, periode en bedrag aan met de standaard voor de soort (zoals bij een afspraak). */
function normalizeLine<T extends Partial<QuoteLineInput>>(line: T, kind: ServiceKind): T {
  const def = SERVICE_DEFAULTS[kind];
  const out = { ...line };
  if (!out.pricing) out.pricing = def.pricing;
  if (out.pricing === "recurring" && !out.period) out.period = def.period ?? "month";
  if (out.pricing !== "recurring") out.period = null;
  if (out.pricing !== "hourly") out.budgetCents = null;
  if (out.amountCents === undefined && def.amountCents !== undefined) out.amountCents = def.amountCents;
  if (out.domain) out.domain = cleanDomain(out.domain);
  return out;
}

/* ------------------------------------------------------------------ */
/* Huishouding                                                         */
/* ------------------------------------------------------------------ */

/** Verstuurde offertes waarvan "geldig tot" voorbij is: → verlopen. Goedkoop en idempotent. */
export async function settleQuotes() {
  const t = today();
  await db
    .update(quotes)
    .set({ status: "expired", decidedAt: t })
    .where(and(eq(quotes.status, "sent"), isNotNull(quotes.validUntil), sql`${quotes.validUntil} < ${t}`));
}

/* ------------------------------------------------------------------ */
/* Leads                                                               */
/* ------------------------------------------------------------------ */

export type QuoteWithLines = Quote & { lines: QuoteLine[]; totals: QuoteTotals };

export type LeadRow = Lead & {
  clientName: string | null;
  quotes: QuoteWithLines[];
  /** Waarde voor de pipeline: de lopende offerte (akkoord, verstuurd, concept), anders de geschatte waarde, anders de laatste offerte. */
  valueCents: number;
  weightedCents: number;
  open: boolean;
  nextStepDue: boolean; // volgende stap vandaag of eerder
};

function isOpenLead(status: LeadStatus) {
  return (OPEN_LEAD_STATUSES as readonly string[]).includes(status);
}

async function quotesFor(where: SQL | undefined): Promise<QuoteWithLines[]> {
  const qs = await db.select().from(quotes).where(where).orderBy(desc(quotes.quoteDate), desc(quotes.createdAt));
  if (qs.length === 0) return [];
  const ls = await db
    .select()
    .from(quoteLines)
    .where(inArray(quoteLines.quoteId, qs.map((q) => q.id)))
    .orderBy(asc(quoteLines.sortOrder), asc(quoteLines.createdAt));
  return qs.map((q) => {
    const lines = ls.filter((l) => l.quoteId === q.id);
    return { ...q, lines, totals: quoteTotals(lines) };
  });
}

function leadValue(lead: Lead, qs: QuoteWithLines[]) {
  // Akkoord, anders verstuurd, anders concept; daarna de eigen schatting, en als laatste de meest recente (verlopen of afgewezen) offerte
  const current = qs.find((q) => q.status === "accepted") ?? qs.find((q) => q.status === "sent") ?? qs.find((q) => q.status === "draft");
  if (current) return current.totals.firstYearCents;
  return lead.estimatedValueCents ?? qs[0]?.totals.firstYearCents ?? 0;
}

function toRow(lead: Lead, clientName: string | null, qs: QuoteWithLines[]): LeadRow {
  const t = today();
  const valueCents = leadValue(lead, qs);
  const open = isOpenLead(lead.status);
  return {
    ...lead,
    clientName,
    quotes: qs,
    valueCents,
    weightedCents: open ? Math.round((valueCents * lead.probabilityPct) / 100) : 0,
    open,
    nextStepDue: open && !!lead.nextStepDate && lead.nextStepDate <= t,
  };
}

export async function listLeads(filter: { status?: LeadStatus[]; open?: boolean; clientId?: string } = {}): Promise<LeadRow[]> {
  await settleQuotes();
  const conds = [];
  if (filter.status?.length) conds.push(inArray(leads.status, filter.status));
  if (filter.open) conds.push(inArray(leads.status, [...OPEN_LEAD_STATUSES]));
  if (filter.clientId) conds.push(eq(leads.clientId, filter.clientId));
  const rows = await db
    .select({ l: leads, clientName: clients.name })
    .from(leads)
    .leftJoin(clients, eq(leads.clientId, clients.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(sql`${leads.nextStepDate} asc nulls last`, desc(leads.updatedAt));
  if (rows.length === 0) return [];
  const qs = await quotesFor(inArray(quotes.leadId, rows.map((r) => r.l.id)));
  return rows.map((r) => toRow(r.l, r.clientName, qs.filter((q) => q.leadId === r.l.id)));
}

export async function getLead(id: string): Promise<LeadRow | null> {
  await settleQuotes();
  const [r] = await db.select({ l: leads, clientName: clients.name }).from(leads).leftJoin(clients, eq(leads.clientId, clients.id)).where(eq(leads.id, id));
  if (!r) return null;
  return toRow(r.l, r.clientName, await quotesFor(eq(quotes.leadId, id)));
}

export async function createLead(input: LeadInput) {
  const data = leadInput.parse(input);
  let companyName = data.companyName?.trim() || null;
  if (data.clientId && !companyName) companyName = (await getClient(data.clientId))?.name ?? null;
  if (!companyName) throw new Error("Bedrijfsnaam of klant ontbreekt");
  const status = data.status ?? "new";
  const [row] = await db
    .insert(leads)
    .values({
      ...data,
      companyName,
      status,
      interests: data.interests ?? [],
      probabilityPct: data.probabilityPct ?? LEAD_DEFAULT_PROBABILITY[status],
      closedAt: status === "won" || status === "lost" ? today() : null,
    })
    .returning();
  return row;
}

export async function updateLead(id: string, patch: Partial<LeadInput>) {
  const [current] = await db.select().from(leads).where(eq(leads.id, id));
  if (!current) throw new Error("Lead niet gevonden");
  const data = leadInput.partial().parse(patch);
  const set: Partial<Lead> = { ...data } as Partial<Lead>;
  if (data.companyName !== undefined && !data.companyName?.trim()) delete set.companyName;
  if (data.status && data.status !== current.status) {
    // Kans meeschuiven als die nog op de standaard van de oude status stond
    if (data.probabilityPct === undefined && current.probabilityPct === LEAD_DEFAULT_PROBABILITY[current.status]) set.probabilityPct = LEAD_DEFAULT_PROBABILITY[data.status];
    set.closedAt = data.status === "won" || data.status === "lost" ? today() : null;
    if (data.status !== "lost" && data.lostReason === undefined) set.lostReason = null;
  }
  const [row] = await db.update(leads).set(set).where(eq(leads.id, id)).returning();
  return row;
}

/** Verwijdert een lead met zijn offertes. Een gewonnen lead (met een akkoord) kan niet weg: de afspraken komen eruit voort. */
export async function deleteLead(id: string) {
  const accepted = await db.select({ id: quotes.id }).from(quotes).where(and(eq(quotes.leadId, id), eq(quotes.status, "accepted")));
  if (accepted.length) throw new Error("Deze lead heeft een offerte met akkoord en kan niet worden verwijderd. Zet hem eventueel op gewonnen.");
  const [row] = await db.delete(leads).where(eq(leads.id, id)).returning();
  return row ?? null;
}

/* ------------------------------------------------------------------ */
/* Offertes                                                            */
/* ------------------------------------------------------------------ */

/** Volgend offertenummer: OFF-2026-001. */
async function nextQuoteNumber(date: string) {
  const prefix = `OFF-${date.slice(0, 4)}-`;
  const rows = await db.select({ n: quotes.number }).from(quotes).where(like(quotes.number, `${prefix}%`));
  const max = rows.reduce((m, r) => Math.max(m, Number(r.n.slice(prefix.length)) || 0), 0);
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

export type QuoteDetail = QuoteWithLines & { lead: Lead; clientName: string | null };

export async function getQuote(id: string): Promise<QuoteDetail | null> {
  await settleQuotes();
  const [q] = await quotesFor(eq(quotes.id, id));
  if (!q) return null;
  const [lead] = await db.select().from(leads).where(eq(leads.id, q.leadId));
  const clientId = q.clientId ?? lead.clientId;
  const client = clientId ? await getClient(clientId) : null;
  return { ...q, lead, clientName: client?.name ?? null };
}

export type QuoteRow = QuoteWithLines & { companyName: string; leadTitle: string; clientName: string | null };

export async function listQuotes(filter: { status?: z.infer<typeof quoteStatusSchema>[]; leadId?: string } = {}): Promise<QuoteRow[]> {
  await settleQuotes();
  const conds = [];
  if (filter.status?.length) conds.push(inArray(quotes.status, filter.status));
  if (filter.leadId) conds.push(eq(quotes.leadId, filter.leadId));
  const qs = await quotesFor(conds.length ? and(...conds) : undefined);
  if (qs.length === 0) return [];
  const ls = await db
    .select({ id: leads.id, companyName: leads.companyName, title: leads.title, clientName: clients.name })
    .from(leads)
    .leftJoin(clients, eq(leads.clientId, clients.id))
    .where(inArray(leads.id, [...new Set(qs.map((q) => q.leadId))]));
  return qs.map((q) => {
    const l = ls.find((x) => x.id === q.leadId)!;
    return { ...q, companyName: l.clientName ?? l.companyName, leadTitle: l.title, clientName: l.clientName };
  });
}

export async function createQuote(input: QuoteInput) {
  const { lines, ...data } = quoteInput.parse(input);
  const [lead] = await db.select().from(leads).where(eq(leads.id, data.leadId));
  if (!lead) throw new Error("Lead niet gevonden");
  const quoteDate = data.quoteDate ?? today();
  const [row] = await db
    .insert(quotes)
    .values({
      ...data,
      title: data.title ?? lead.title,
      quoteDate,
      validUntil: data.validUntil ?? addDaysIso(quoteDate, QUOTE_VALID_DAYS),
      number: await nextQuoteNumber(quoteDate),
      clientId: lead.clientId,
      status: "draft",
    })
    .returning();
  for (const [n, l] of (lines ?? []).entries()) await addQuoteLine(row.id, { ...l, sortOrder: l.sortOrder ?? n + 1 });
  if (data.status && data.status !== "draft") await setQuoteStatus(row.id, data.status);
  // Lead nog nieuw: dan zit je nu in gesprek
  if (lead.status === "new") await updateLead(lead.id, { status: "contact" });
  return getQuote(row.id);
}

export async function updateQuote(id: string, patch: Partial<Omit<QuoteInput, "leadId" | "lines" | "status">>) {
  const { quoteDate, ...data } = quoteInput.omit({ leadId: true, lines: true, status: true }).partial().parse(patch);
  const [row] = await db.update(quotes).set({ ...data, ...(quoteDate ? { quoteDate } : {}) }).where(eq(quotes.id, id)).returning();
  if (!row) throw new Error("Offerte niet gevonden");
  return row;
}

async function editableQuote(quoteId: string) {
  const [q] = await db.select().from(quotes).where(eq(quotes.id, quoteId));
  if (!q) throw new Error("Offerte niet gevonden");
  if (q.status === "accepted") throw new Error("Deze offerte is al akkoord; wijzig de afspraken in plaats van de offerte.");
  return q;
}

export async function addQuoteLine(quoteId: string, input: QuoteLineInput) {
  await editableQuote(quoteId);
  const parsed = quoteLineInput.parse(input);
  const data = normalizeLine(parsed, parsed.kind);
  if (data.amountCents === undefined) throw new Error("Bedrag ontbreekt");
  if (data.sortOrder === undefined) {
    const [m] = await db.select({ n: sql<number>`coalesce(max(${quoteLines.sortOrder}), 0)::int` }).from(quoteLines).where(eq(quoteLines.quoteId, quoteId));
    data.sortOrder = m.n + 1;
  }
  const [row] = await db
    .insert(quoteLines)
    .values({ ...data, quoteId, amountCents: data.amountCents, pricing: data.pricing!, kind: data.kind })
    .returning();
  return row;
}

export async function updateQuoteLine(id: string, patch: Partial<QuoteLineInput>) {
  const [current] = await db.select().from(quoteLines).where(eq(quoteLines.id, id));
  if (!current) throw new Error("Offerteregel niet gevonden");
  await editableQuote(current.quoteId);
  const parsed = quoteLineInput.partial().parse(patch);
  const kind = parsed.kind ?? current.kind;
  const data = parsed.kind || parsed.pricing
    ? normalizeLine({ pricing: parsed.pricing ?? (parsed.kind ? undefined : current.pricing), ...parsed }, kind)
    : { ...parsed, ...(parsed.domain ? { domain: cleanDomain(parsed.domain) } : {}) };
  const [row] = await db.update(quoteLines).set(data).where(eq(quoteLines.id, id)).returning();
  return row;
}

export async function deleteQuoteLine(id: string) {
  const [current] = await db.select().from(quoteLines).where(eq(quoteLines.id, id));
  if (!current) return null;
  await editableQuote(current.quoteId);
  await db.delete(quoteLines).where(eq(quoteLines.id, id));
  return current;
}

/**
 * Status van een offerte zetten (niet voor akkoord: gebruik acceptQuote).
 * - verstuurd: verstuurd op vandaag, lead naar "offerte verstuurd";
 * - afgewezen / verlopen: beslist op vandaag;
 * - terug naar concept: datums leeg.
 */
export async function setQuoteStatus(id: string, status: z.infer<typeof quoteStatusSchema>) {
  if (status === "accepted") return (await acceptQuote(id)).quote;
  const [current] = await db.select().from(quotes).where(eq(quotes.id, id));
  if (!current) throw new Error("Offerte niet gevonden");
  if (current.status === "accepted") throw new Error("Deze offerte is al akkoord; de afspraken zijn aangemaakt.");
  const t = today();
  const set: Partial<Quote> = { status };
  if (status === "sent") {
    set.sentAt = current.sentAt ?? t;
    set.decidedAt = null;
    // Opnieuw versturen na verlopen: geldigheid opnieuw vanaf vandaag
    if (current.validUntil && current.validUntil < t) set.validUntil = addDaysIso(t, QUOTE_VALID_DAYS);
  }
  if (status === "rejected" || status === "expired") set.decidedAt = t;
  if (status === "draft") Object.assign(set, { sentAt: null, decidedAt: null });
  const [row] = await db.update(quotes).set(set).where(eq(quotes.id, id)).returning();

  if (status === "sent") {
    const [lead] = await db.select().from(leads).where(eq(leads.id, row.leadId));
    if (lead && (lead.status === "new" || lead.status === "contact")) await updateLead(lead.id, { status: "quoted" });
  }
  return row;
}

export async function deleteQuote(id: string) {
  const q = await editableQuote(id);
  await db.delete(quotes).where(eq(quotes.id, q.id));
  return q;
}

/** Kopie van een offerte als nieuw concept (bijv. een aangepaste versie na een gesprek). */
export async function duplicateQuote(id: string) {
  const q = await getQuote(id);
  if (!q) throw new Error("Offerte niet gevonden");
  return createQuote({
    leadId: q.leadId,
    title: q.title,
    notes: q.notes,
    lines: q.lines.map((l) => ({
      kind: l.kind, description: l.description, amountCents: l.amountCents, pricing: l.pricing, period: l.period,
      budgetCents: l.budgetCents, sessionsPerMonth: l.sessionsPerMonth, domain: l.domain, startDate: l.startDate, sortOrder: l.sortOrder,
    })),
  });
}

/* ------------------------------------------------------------------ */
/* Akkoord: met één klik van offerte naar klant, afspraken en termijn  */
/* ------------------------------------------------------------------ */

export type AcceptResult = {
  quote: Quote;
  clientId: string;
  clientCreated: boolean;
  agreements: { id: string; label: string }[];
  websitesCreated: string[];
  projectIds: string[];
};

/**
 * Offerte akkoord:
 * 1. Klant: de klant van de lead, of een nieuwe klant (actief, klant sinds vandaag, bron en primaire contactpersoon uit de lead).
 *    Een bestaande klant met status lead, on hold of oud-klant wordt actief.
 * 2. Websites: per domein op de offerte de bestaande website van de klant, anders een nieuwe.
 * 3. Elke offerteregel wordt een actieve afspraak. Een eenmalige website maakt (via de afspraak) een websiteproject
 *    en twee termijnen van 50%; de eerste ("bij akkoord") staat direct op klaar om te factureren.
 * 4. Offerte op akkoord, lead op gewonnen; andere openstaande offertes van de lead worden afgewezen.
 * 5. Een link naar het offertedocument komt bij de documenten van de klant.
 */
export async function acceptQuote(id: string, opts: { startDate?: string | null } = {}): Promise<AcceptResult> {
  const q = await getQuote(id);
  if (!q) throw new Error("Offerte niet gevonden");
  if (q.status === "accepted") throw new Error("Deze offerte is al akkoord.");
  if (q.lines.length === 0) throw new Error("De offerte heeft nog geen regels.");
  const t = today();
  const start = opts.startDate ?? t;

  // Eerst de offerte vastzetten, zodat een dubbele klik niet twee keer afspraken maakt
  const [locked] = await db
    .update(quotes)
    .set({ status: "accepted", decidedAt: t, sentAt: q.sentAt ?? t })
    .where(and(eq(quotes.id, id), ne(quotes.status, "accepted")))
    .returning();
  if (!locked) throw new Error("Deze offerte is al akkoord.");

  try {
    // 1. Klant
    const lead = q.lead;
    let clientId = lead.clientId;
    let clientCreated = false;
    if (clientId) {
      const c = await getClient(clientId);
      if (c && c.status !== "active") await updateClient(clientId, { status: "active", clientSince: c.clientSince ?? t });
      else if (c && !c.clientSince) await updateClient(clientId, { clientSince: t });
    } else {
      // Bestaat er al een klant met precies deze naam? Dan die gebruiken in plaats van een dubbele aan te maken
      const [same] = await db.select().from(clients).where(sql`lower(trim(${clients.name})) = lower(trim(${lead.companyName}))`).limit(1);
      if (same) {
        clientId = same.id;
        if (same.status !== "active") await updateClient(same.id, { status: "active", clientSince: same.clientSince ?? t });
      }
    }
    if (!clientId) {
      const c = await createClient(
        { name: lead.companyName, status: "active", clientSince: t, source: lead.source },
        { name: lead.contactName, email: lead.contactEmail, phone: lead.contactPhone },
      );
      clientId = c.id;
      clientCreated = true;
    }

    // 2. Websites per domein
    const siteIds = new Map<string, string>();
    const websitesCreated: string[] = [];
    const domains = [...new Set(q.lines.map((l) => l.domain).filter((d): d is string => !!d))];
    if (domains.length) {
      const existing = await db.select().from(websites).where(eq(websites.clientId, clientId));
      for (const d of domains) {
        const found = existing.find((w) => w.domain === d);
        if (found) siteIds.set(d, found.id);
        else {
          const w = await createWebsite({ clientId, domain: d });
          siteIds.set(d, w.id);
          websitesCreated.push(w.domain);
        }
      }
    }

    // 3. Afspraken
    const made: AcceptResult["agreements"] = [];
    const projectIds: string[] = [];
    for (const l of q.lines) {
      const a = await createAgreement({
        clientId,
        kind: l.kind,
        title: l.description,
        websiteId: l.domain ? (siteIds.get(l.domain) ?? null) : null,
        amountCents: l.amountCents,
        pricing: l.pricing,
        period: l.period,
        budgetCents: l.budgetCents,
        sessionsPerMonth: l.sessionsPerMonth,
        startDate: l.startDate ?? start,
        status: "active",
        notes: `Uit offerte ${q.number}`,
      });
      await db.update(quoteLines).set({ agreementId: a.id }).where(eq(quoteLines.id, l.id));
      made.push({ id: a.id, label: agreementLabel(a, l.domain) });
      if (a.projectId) projectIds.push(a.projectId);
    }

    // 4. Offerte en lead
    await db.update(quotes).set({ clientId }).where(eq(quotes.id, id));
    await db
      .update(quotes)
      .set({ status: "rejected", decidedAt: t })
      .where(and(eq(quotes.leadId, lead.id), ne(quotes.id, id), inArray(quotes.status, ["draft", "sent"])));
    await db
      .update(leads)
      .set({ clientId, status: "won", probabilityPct: 100, closedAt: t, nextStep: null, nextStepDate: null })
      .where(eq(leads.id, lead.id));

    // 5. Document
    if (q.url) await createDocument({ clientId, kind: "quote", title: `Offerte ${q.number}${q.title ? ` · ${q.title}` : ""}`, url: q.url, docDate: q.quoteDate });

    const [final] = await db.select().from(quotes).where(eq(quotes.id, id));
    return { quote: final, clientId, clientCreated, agreements: made, websitesCreated, projectIds };
  } catch (e) {
    // Mislukt vóór er afspraken zijn: offerte terug naar de vorige status, zodat je het opnieuw kunt proberen
    const [anyLinked] = await db.select({ id: quoteLines.id }).from(quoteLines).where(and(eq(quoteLines.quoteId, id), isNotNull(quoteLines.agreementId)));
    if (!anyLinked) await db.update(quotes).set({ status: q.status, decidedAt: q.decidedAt, sentAt: q.sentAt }).where(eq(quotes.id, id));
    throw e;
  }
}

/* ------------------------------------------------------------------ */
/* Overzicht en signalen                                               */
/* ------------------------------------------------------------------ */

export type PipelineOverview = {
  openLeads: number;
  pipelineCents: number; // waarde van open leads
  weightedCents: number; // gewogen met de kans
  openQuotes: { count: number; cents: number; monthlyCents: number }; // verstuurd, nog geen besluit
  draftQuotes: number;
  wonThisYear: { count: number; cents: number };
  lostThisYear: number;
  winRatePct: number | null; // gewonnen / (gewonnen + verloren) dit jaar
  byStatus: { status: LeadStatus; count: number; cents: number }[];
};

export async function pipelineOverview(): Promise<PipelineOverview> {
  const all = await listLeads();
  const year = today().slice(0, 4);
  const open = all.filter((l) => l.open);
  const quotesSent = all.flatMap((l) => l.quotes).filter((q) => q.status === "sent");
  const won = all.filter((l) => l.status === "won" && l.closedAt?.startsWith(year));
  const lost = all.filter((l) => l.status === "lost" && l.closedAt?.startsWith(year));
  const decided = won.length + lost.length;
  return {
    openLeads: open.length,
    pipelineCents: open.reduce((s, l) => s + l.valueCents, 0),
    weightedCents: open.reduce((s, l) => s + l.weightedCents, 0),
    openQuotes: {
      count: quotesSent.length,
      cents: quotesSent.reduce((s, q) => s + q.totals.firstYearCents, 0),
      monthlyCents: quotesSent.reduce((s, q) => s + q.totals.monthlyCents, 0),
    },
    draftQuotes: all.flatMap((l) => l.quotes).filter((q) => q.status === "draft").length,
    wonThisYear: { count: won.length, cents: won.reduce((s, l) => s + l.valueCents, 0) },
    lostThisYear: lost.length,
    winRatePct: decided ? Math.round((won.length / decided) * 100) : null,
    byStatus: (["new", "contact", "quoted", "won", "lost"] as const).map((status) => {
      const rows = all.filter((l) => l.status === status && (isOpenLead(status) || l.closedAt?.startsWith(year)));
      return { status, count: rows.length, cents: rows.reduce((s, l) => s + l.valueCents, 0) };
    }),
  };
}

/** Signalen voor Vandaag: volgende stappen die nu aan de beurt zijn en verstuurde offertes die bijna verlopen. */
export async function pipelineSignals() {
  await settleQuotes();
  const t = today();
  const [due, expiring, openQuotes] = await Promise.all([
    db
      .select({ l: leads, clientName: clients.name })
      .from(leads)
      .leftJoin(clients, eq(leads.clientId, clients.id))
      .where(and(inArray(leads.status, [...OPEN_LEAD_STATUSES]), isNotNull(leads.nextStepDate), lte(leads.nextStepDate, t)))
      .orderBy(asc(leads.nextStepDate)),
    db
      .select({ q: quotes, companyName: leads.companyName })
      .from(quotes)
      .innerJoin(leads, eq(quotes.leadId, leads.id))
      .where(and(eq(quotes.status, "sent"), isNotNull(quotes.validUntil), gte(quotes.validUntil, t), lte(quotes.validUntil, addDaysIso(t, QUOTE_WARNING_DAYS))))
      .orderBy(asc(quotes.validUntil)),
    listQuotes({ status: ["sent"] }),
  ]);
  return {
    nextSteps: due.map((r) => ({ ...r.l, clientName: r.clientName })),
    expiringQuotes: expiring.map((r) => ({ ...r.q, companyName: r.companyName })),
    openQuotes: { count: openQuotes.length, cents: openQuotes.reduce((s, q) => s + q.totals.firstYearCents, 0) },
  };
}
