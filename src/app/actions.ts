"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { requireSession } from "@/lib/auth";
import * as data from "@/lib/data";
import { SESSION_COOKIE } from "@/lib/session";
import { parseEuro } from "@/lib/money";
import { parseDuration } from "@/lib/duration";
import { today } from "@/lib/dates";

/* Hulpjes om FormData om te zetten */
function s(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  if (v == null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}
function n(fd: FormData, key: string): number | null {
  const v = s(fd, key);
  return v == null ? null : Number(v);
}
function has(fd: FormData, key: string) {
  return fd.has(key);
}

function refresh() {
  revalidatePath("/", "layout");
}

/* ---------------- Taken ---------------- */

function taskFromForm(fd: FormData) {
  const out: Partial<data.TaskInput> = {};
  if (has(fd, "title")) out.title = s(fd, "title") ?? "";
  if (has(fd, "area")) out.area = (s(fd, "area") ?? "zakelijk") as "zakelijk" | "prive";
  if (has(fd, "clientId")) out.clientId = s(fd, "clientId");
  if (has(fd, "projectId")) out.projectId = s(fd, "projectId");
  if (has(fd, "status")) out.status = (s(fd, "status") ?? "todo") as data.TaskInput["status"];
  if (has(fd, "planDate")) out.planDate = s(fd, "planDate");
  if (has(fd, "dueDate")) out.dueDate = s(fd, "dueDate");
  if (has(fd, "priority")) out.priority = n(fd, "priority") ?? 2;
  if (has(fd, "estimateMin")) out.estimateMin = n(fd, "estimateMin");
  if (has(fd, "recurrence")) out.recurrence = (s(fd, "recurrence") ?? "none") as data.TaskInput["recurrence"];
  if (has(fd, "notes")) out.notes = s(fd, "notes");
  return out;
}

export async function createTaskAction(fd: FormData) {
  await requireSession();
  const input = taskFromForm(fd);
  if (!input.title) return;
  await data.createTask(input as data.TaskInput);
  refresh();
}

export async function updateTaskAction(id: string, fd: FormData) {
  await requireSession();
  await data.updateTask(id, taskFromForm(fd));
  refresh();
  const back = s(fd, "back");
  if (back) redirect(back);
}

export async function toggleTaskAction(id: string, done: boolean) {
  await requireSession();
  if (done) await data.completeTask(id);
  else await data.reopenTask(id);
  refresh();
}

export async function planTaskAction(id: string, planDate: string | null) {
  await requireSession();
  await data.updateTask(id, { planDate });
  refresh();
}

export async function deleteTaskAction(id: string, back?: string) {
  await requireSession();
  await data.deleteTask(id);
  refresh();
  if (back) redirect(back);
}

/* ---------------- Inbox ---------------- */

export async function captureAction(fd: FormData) {
  await requireSession();
  const text = s(fd, "text");
  if (text) await data.capture(text);
  refresh();
}

export async function inboxToTaskAction(noteId: string, fd: FormData) {
  await requireSession();
  await data.inboxToTask(noteId, taskFromForm(fd));
  refresh();
}

export async function inboxToNoteAction(noteId: string, fd: FormData) {
  await requireSession();
  await data.updateNote(noteId, {
    type: (s(fd, "type") ?? "note") as data.NoteInput["type"],
    area: (s(fd, "area") as "zakelijk" | "prive" | null) ?? null,
    clientId: s(fd, "clientId"),
    projectId: s(fd, "projectId"),
  });
  refresh();
}

/* ---------------- Notities ---------------- */

function noteFromForm(fd: FormData) {
  const out: Partial<data.NoteInput> = {};
  if (has(fd, "title")) out.title = s(fd, "title") ?? "";
  if (has(fd, "body")) out.body = s(fd, "body");
  if (has(fd, "type")) out.type = (s(fd, "type") ?? "note") as data.NoteInput["type"];
  if (has(fd, "area")) out.area = s(fd, "area") as "zakelijk" | "prive" | null;
  if (has(fd, "clientId")) out.clientId = s(fd, "clientId");
  if (has(fd, "projectId")) out.projectId = s(fd, "projectId");
  if (has(fd, "noteDate")) out.noteDate = s(fd, "noteDate");
  return out;
}

export async function createNoteAction(fd: FormData) {
  await requireSession();
  const input = noteFromForm(fd);
  if (!input.title) return;
  const note = await data.createNote(input as data.NoteInput);
  refresh();
  if (s(fd, "open")) redirect(`/notities/${note.id}`);
}

export async function updateNoteAction(id: string, fd: FormData) {
  await requireSession();
  await data.updateNote(id, noteFromForm(fd));
  refresh();
}

export async function deleteNoteAction(id: string, back = "/notities") {
  await requireSession();
  await data.deleteNote(id);
  refresh();
  redirect(back);
}

/* ---------------- Projecten ---------------- */

function projectFromForm(fd: FormData) {
  const out: Partial<data.ProjectInput> = {};
  if (has(fd, "name")) out.name = s(fd, "name") ?? "";
  if (has(fd, "area")) out.area = (s(fd, "area") ?? "zakelijk") as "zakelijk" | "prive";
  if (has(fd, "clientId")) out.clientId = s(fd, "clientId");
  if (has(fd, "status")) out.status = (s(fd, "status") ?? "planned") as data.ProjectInput["status"];
  if (has(fd, "startDate")) out.startDate = s(fd, "startDate");
  if (has(fd, "dueDate")) out.dueDate = s(fd, "dueDate");
  if (has(fd, "description")) out.description = s(fd, "description");
  return out;
}

export async function createProjectAction(fd: FormData) {
  await requireSession();
  const input = projectFromForm(fd);
  if (!input.name) return;
  const p = await data.createProject(input as data.ProjectInput);
  refresh();
  redirect(`/projecten/${p.id}`);
}

export async function updateProjectAction(id: string, fd: FormData) {
  await requireSession();
  await data.updateProject(id, projectFromForm(fd));
  refresh();
}

export async function deleteProjectAction(id: string) {
  await requireSession();
  await data.deleteProject(id);
  refresh();
  redirect("/projecten");
}

/* ---------------- Klanten ---------------- */

function b(fd: FormData, key: string): boolean {
  const v = fd.get(key);
  return v === "on" || v === "1" || v === "true";
}

function clientFromForm(fd: FormData) {
  const out: Partial<data.ClientInput> = {};
  const text = ["legalForm", "source", "kvkNumber", "vatNumber", "address", "postcode", "city", "invoiceAddress", "invoicePostcode", "invoiceCity", "invoiceCountry", "invoiceEmail", "moneybirdContactId", "personalData", "vaultRef", "info"] as const;
  const dates = ["clientSince", "dpaDate"] as const;
  if (has(fd, "name")) out.name = s(fd, "name") ?? "";
  for (const k of text) if (has(fd, k)) out[k] = s(fd, k);
  for (const k of dates) if (has(fd, k)) out[k] = s(fd, k);
  if (has(fd, "status")) out.status = (s(fd, "status") ?? "active") as data.ClientInput["status"];
  if (has(fd, "country")) out.country = (s(fd, "country") ?? "NL").toUpperCase();
  if (has(fd, "paymentTermDays")) out.paymentTermDays = n(fd, "paymentTermDays") ?? 14;
  if (has(fd, "dpaStatus")) out.dpaStatus = (s(fd, "dpaStatus") ?? "not_applicable") as data.ClientInput["dpaStatus"];
  if (has(fd, "tags")) out.tags = data.cleanTags(s(fd, "tags"));
  return out;
}

export async function createClientAction(fd: FormData) {
  await requireSession();
  const input = clientFromForm(fd);
  if (!input.name) return;
  const c = await data.createClient(input as data.ClientInput, { name: s(fd, "contactPerson"), email: s(fd, "contactEmail"), phone: s(fd, "contactPhone") });
  refresh();
  redirect(`/klanten/${c.id}`);
}

export async function updateClientAction(id: string, fd: FormData) {
  await requireSession();
  await data.updateClient(id, clientFromForm(fd));
  refresh();
}

export async function deleteClientAction(id: string) {
  await requireSession();
  await data.deleteClient(id);
  refresh();
  redirect("/klanten");
}

/* ---------------- Contactpersonen ---------------- */

function contactFromForm(fd: FormData) {
  const out: Partial<data.ContactInput> = {};
  if (has(fd, "name")) out.name = s(fd, "name") ?? "";
  if (has(fd, "role")) out.role = s(fd, "role");
  if (has(fd, "email")) out.email = s(fd, "email");
  if (has(fd, "phone")) out.phone = s(fd, "phone");
  if (has(fd, "notes")) out.notes = s(fd, "notes");
  // Checkbox: alleen aanwezig als aangevinkt; het verborgen veld "isPrimaryField" geeft aan dat het formulier hem toont
  if (has(fd, "isPrimaryField")) out.isPrimary = b(fd, "isPrimary");
  return out;
}

export async function createContactAction(clientId: string, fd: FormData) {
  await requireSession();
  const input = contactFromForm(fd);
  if (!input.name) return;
  await data.createContact({ ...input, clientId } as data.ContactInput);
  refresh();
}

export async function updateContactAction(id: string, fd: FormData) {
  await requireSession();
  await data.updateContact(id, contactFromForm(fd));
  refresh();
}

export async function makePrimaryContactAction(id: string) {
  await requireSession();
  await data.updateContact(id, { isPrimary: true });
  refresh();
}

export async function deleteContactAction(id: string) {
  await requireSession();
  await data.deleteContact(id);
  refresh();
}

/* ---------------- Websites ---------------- */

function websiteFromForm(fd: FormData) {
  const out: Partial<data.WebsiteInput> = {};
  if (has(fd, "domain")) out.domain = s(fd, "domain") ?? "";
  for (const k of ["registrar", "hostingLocation", "cms", "notes"] as const) if (has(fd, k)) out[k] = s(fd, k);
  for (const k of ["domainExpiresAt", "liveDate"] as const) if (has(fd, k)) out[k] = s(fd, k);
  if (has(fd, "servicesField")) {
    out.hostingByUs = b(fd, "hostingByUs");
    out.maintenanceByUs = b(fd, "maintenanceByUs");
  }
  return out;
}

export async function createWebsiteAction(clientId: string, fd: FormData) {
  await requireSession();
  const input = websiteFromForm(fd);
  if (!input.domain) return;
  await data.createWebsite({ ...input, clientId } as data.WebsiteInput);
  refresh();
}

export async function updateWebsiteAction(id: string, fd: FormData) {
  await requireSession();
  await data.updateWebsite(id, websiteFromForm(fd));
  refresh();
}

export async function deleteWebsiteAction(id: string) {
  await requireSession();
  await data.deleteWebsite(id);
  refresh();
}

/* ---------------- Documenten ---------------- */

export async function createDocumentAction(clientId: string, fd: FormData) {
  await requireSession();
  const title = s(fd, "title");
  if (!title) return;
  await data.createDocument({
    clientId,
    title,
    kind: (s(fd, "kind") ?? "other") as data.DocumentInput["kind"],
    url: s(fd, "url"),
    docDate: s(fd, "docDate"),
  });
  refresh();
}

export async function deleteDocumentAction(id: string) {
  await requireSession();
  await data.deleteDocument(id);
  refresh();
}

/* ---------------- Afspraken ---------------- */

function agreementFromForm(fd: FormData) {
  const out: Partial<data.AgreementInput> = {};
  if (has(fd, "kind")) out.kind = s(fd, "kind") as data.AgreementInput["kind"];
  if (has(fd, "title")) out.title = s(fd, "title");
  if (has(fd, "status")) out.status = (s(fd, "status") ?? "active") as data.AgreementInput["status"];
  if (has(fd, "pricing")) out.pricing = s(fd, "pricing") as data.AgreementInput["pricing"];
  if (has(fd, "period")) out.period = s(fd, "period") as data.AgreementInput["period"];
  if (has(fd, "amount")) {
    const c = parseEuro(s(fd, "amount"));
    if (c != null) out.amountCents = c;
  }
  if (has(fd, "budget")) out.budgetCents = parseEuro(s(fd, "budget"));
  if (has(fd, "sessionsPerMonth")) out.sessionsPerMonth = n(fd, "sessionsPerMonth");
  if (has(fd, "websiteId")) out.websiteId = s(fd, "websiteId");
  if (has(fd, "projectId")) out.projectId = s(fd, "projectId");
  for (const k of ["startDate", "endDate"] as const) if (has(fd, k)) out[k] = s(fd, k);
  if (has(fd, "noticeMonths")) out.noticeMonths = n(fd, "noticeMonths");
  if (has(fd, "indexationPct")) {
    const v = s(fd, "indexationPct");
    out.indexationPct = v == null ? null : Number(v.replace(",", "."));
  }
  if (has(fd, "notes")) out.notes = s(fd, "notes");
  return out;
}

export async function createAgreementAction(clientId: string | null, fd: FormData) {
  await requireSession();
  const input = agreementFromForm(fd);
  const cid = clientId ?? s(fd, "clientId");
  if (!cid || !input.kind || input.amountCents == null) return;
  await data.createAgreement({ ...input, clientId: cid } as data.AgreementInput);
  refresh();
}

export async function updateAgreementAction(id: string, fd: FormData) {
  await requireSession();
  await data.updateAgreement(id, agreementFromForm(fd));
  refresh();
}

export async function setAgreementStatusAction(id: string, status: data.AgreementInput["status"]) {
  await requireSession();
  await data.updateAgreement(id, { status });
  refresh();
}

export async function deliverAgreementAction(id: string) {
  await requireSession();
  await data.deliverAgreement(id);
  refresh();
}

export async function deleteAgreementAction(id: string) {
  await requireSession();
  await data.deleteAgreement(id);
  refresh();
}

/* ---------------- Termijnen ---------------- */

function installmentFromForm(fd: FormData) {
  const out: Partial<data.InstallmentInput> & { invoicedAt?: string | null; paidAt?: string | null } = {};
  if (has(fd, "description")) out.description = s(fd, "description") ?? "";
  if (has(fd, "amount")) {
    const c = parseEuro(s(fd, "amount"));
    if (c != null) out.amountCents = c;
  }
  if (has(fd, "trigger")) out.trigger = (s(fd, "trigger") ?? "date") as data.InstallmentInput["trigger"];
  if (has(fd, "dueDate")) out.dueDate = s(fd, "dueDate");
  if (has(fd, "status")) out.status = s(fd, "status") as data.InstallmentInput["status"];
  if (has(fd, "agreementId")) out.agreementId = s(fd, "agreementId");
  if (has(fd, "moneybirdInvoiceId")) out.moneybirdInvoiceId = s(fd, "moneybirdInvoiceId");
  if (has(fd, "invoicedAt")) out.invoicedAt = s(fd, "invoicedAt");
  if (has(fd, "paidAt")) out.paidAt = s(fd, "paidAt");
  if (has(fd, "notes")) out.notes = s(fd, "notes");
  return out;
}

export async function createInstallmentAction(clientId: string, fd: FormData) {
  await requireSession();
  const { invoicedAt: _i, paidAt: _p, ...input } = installmentFromForm(fd);
  void _i;
  void _p;
  if (!input.description || input.amountCents == null) return;
  await data.createInstallment({ ...input, clientId } as data.InstallmentInput);
  refresh();
}

export async function updateInstallmentAction(id: string, fd: FormData) {
  await requireSession();
  await data.updateInstallment(id, installmentFromForm(fd));
  refresh();
}

export async function setInstallmentStatusAction(id: string, status: data.InstallmentInput["status"]) {
  await requireSession();
  await data.updateInstallment(id, { status });
  refresh();
}

export async function deleteInstallmentAction(id: string) {
  await requireSession();
  await data.deleteInstallment(id);
  refresh();
}

/* ---------------- Uren ---------------- */

function timeFromForm(fd: FormData) {
  const out: data.TimeEntryInput = {};
  if (has(fd, "area")) out.area = (s(fd, "area") ?? "zakelijk") as "zakelijk" | "prive";
  if (has(fd, "clientId")) out.clientId = s(fd, "clientId");
  if (has(fd, "projectId")) out.projectId = s(fd, "projectId");
  if (has(fd, "taskId")) out.taskId = s(fd, "taskId");
  if (has(fd, "category")) out.category = s(fd, "category");
  if (has(fd, "description")) out.description = s(fd, "description");
  if (has(fd, "entryDate")) out.entryDate = s(fd, "entryDate") ?? undefined;
  if (has(fd, "duration")) out.durationMin = parseDuration(s(fd, "duration"));
  if (has(fd, "startTime")) out.startTime = s(fd, "startTime");
  if (has(fd, "endTime")) out.endTime = s(fd, "endTime");
  if (has(fd, "billable")) {
    const v = s(fd, "billable"); // "auto" | "ja" | "nee"
    out.billable = v === "ja" ? true : v === "nee" ? false : null;
  }
  if (has(fd, "invoiced")) out.invoiced = s(fd, "invoiced") === "ja";
  // Privé zonder klant: geen klant, project of afspraak afleiden
  if (out.area === "prive" && !out.clientId) out.clientId = null;
  return out;
}

export async function startTimerAction(fd: FormData) {
  await requireSession();
  const { durationMin: _d, startTime: _s, endTime: _e, entryDate: _date, ...input } = timeFromForm(fd);
  void _d; void _s; void _e; void _date;
  await data.startTimer(input);
  refresh();
}

export async function startTaskTimerAction(taskId: string) {
  await requireSession();
  await data.startTimer({ taskId });
  refresh();
}

export async function startProjectTimerAction(projectId: string) {
  await requireSession();
  await data.startTimer({ projectId });
  refresh();
}

export async function stopTimerAction(fd?: FormData) {
  await requireSession();
  const description = fd ? s(fd, "description") : null;
  await data.stopTimer(description ? { description } : {});
  refresh();
}

export async function continueTimeEntryAction(id: string) {
  await requireSession();
  await data.continueEntry(id);
  refresh();
}

export async function logTimeAction(fd: FormData) {
  await requireSession();
  const input = timeFromForm(fd);
  if (!input.durationMin && !(input.startTime && input.endTime)) return;
  if (input.startTime && input.endTime) input.durationMin = undefined;
  await data.logTime(input);
  refresh();
}

export async function updateTimeEntryAction(id: string, fd: FormData) {
  await requireSession();
  const input = timeFromForm(fd);
  // Alleen wat is aangepast: begin-/eindtijd, of anders de duur (begintijd blijft dan staan)
  const timesChanged = (s(fd, "startTime") ?? "") !== (s(fd, "origStart") ?? "") || (s(fd, "endTime") ?? "") !== (s(fd, "origEnd") ?? "");
  const durationChanged = (s(fd, "duration") ?? "") !== (s(fd, "origDuration") ?? "");
  if (timesChanged && input.startTime && input.endTime) {
    delete input.durationMin;
  } else {
    if (!durationChanged || input.durationMin == null) delete input.durationMin;
    if (!timesChanged || !input.startTime) delete input.startTime;
    delete input.endTime;
  }
  await data.updateTimeEntry(id, input);
  refresh();
}

export async function deleteTimeEntryAction(id: string) {
  await requireSession();
  await data.deleteTimeEntry(id);
  refresh();
}

export async function invoiceHoursAction(agreementId: string) {
  await requireSession();
  await data.invoiceHours(agreementId);
  refresh();
}

export async function setHoursInvoicedAction(ids: string[], invoiced: boolean) {
  await requireSession();
  await data.setInvoiced(ids, invoiced);
  refresh();
}

/* ---------------- Sessie ---------------- */

/* ---------------- Pipeline: leads en offertes ---------------- */

function leadFromForm(fd: FormData) {
  const out: Partial<data.LeadInput> = {};
  for (const k of ["companyName", "contactName", "contactEmail", "contactPhone", "source", "nextStep", "lostReason", "notes"] as const) {
    if (has(fd, k)) out[k] = s(fd, k);
  }
  if (has(fd, "title")) out.title = s(fd, "title") ?? "";
  if (has(fd, "clientId")) out.clientId = s(fd, "clientId");
  if (has(fd, "nextStepDate")) out.nextStepDate = s(fd, "nextStepDate");
  if (has(fd, "status")) out.status = (s(fd, "status") ?? "new") as data.LeadInput["status"];
  if (has(fd, "estimatedValue")) out.estimatedValueCents = parseEuro(s(fd, "estimatedValue"));
  if (has(fd, "probabilityPct")) {
    const p = n(fd, "probabilityPct");
    if (p != null && Number.isFinite(p)) out.probabilityPct = Math.max(0, Math.min(100, Math.round(p)));
  }
  // Checkboxen: het verborgen veld "interestsField" geeft aan dat het formulier ze toont
  if (has(fd, "interestsField")) out.interests = fd.getAll("interests").map(String) as data.LeadInput["interests"];
  return out;
}

export async function createLeadAction(fd: FormData) {
  await requireSession();
  const input = leadFromForm(fd);
  if (!input.title || (!input.companyName && !input.clientId)) return;
  const lead = await data.createLead(input as data.LeadInput);
  refresh();
  if (s(fd, "stay") !== "1") redirect(`/pipeline/${lead.id}`);
}

export async function updateLeadAction(id: string, fd: FormData) {
  await requireSession();
  await data.updateLead(id, leadFromForm(fd));
  refresh();
}

export async function setLeadStatusAction(id: string, status: data.LeadInput["status"], fd?: FormData) {
  await requireSession();
  await data.updateLead(id, { status, ...(fd && has(fd, "lostReason") ? { lostReason: s(fd, "lostReason") } : {}) });
  refresh();
}

export async function deleteLeadAction(id: string) {
  await requireSession();
  await data.deleteLead(id);
  refresh();
  redirect("/pipeline");
}

function quoteFromForm(fd: FormData) {
  const out: Partial<Omit<data.QuoteInput, "leadId" | "lines" | "status">> = {};
  for (const k of ["title", "url", "notes"] as const) if (has(fd, k)) out[k] = s(fd, k);
  for (const k of ["quoteDate", "validUntil"] as const) if (has(fd, k)) out[k] = s(fd, k);
  return out;
}

export async function createQuoteAction(leadId: string) {
  await requireSession();
  const q = await data.createQuote({ leadId });
  refresh();
  redirect(`/pipeline/offertes/${q!.id}`);
}

export async function updateQuoteAction(id: string, fd: FormData) {
  await requireSession();
  await data.updateQuote(id, quoteFromForm(fd));
  refresh();
}

function quoteLineFromForm(fd: FormData) {
  const out: Partial<data.QuoteLineInput> = {};
  if (has(fd, "kind")) out.kind = s(fd, "kind") as data.QuoteLineInput["kind"];
  if (has(fd, "description")) out.description = s(fd, "description");
  if (has(fd, "pricing")) out.pricing = s(fd, "pricing") as data.QuoteLineInput["pricing"];
  if (has(fd, "period")) out.period = s(fd, "period") as data.QuoteLineInput["period"];
  if (has(fd, "amount")) {
    const c = parseEuro(s(fd, "amount"));
    if (c != null) out.amountCents = c;
  }
  if (has(fd, "budget")) out.budgetCents = parseEuro(s(fd, "budget"));
  if (has(fd, "sessionsPerMonth")) out.sessionsPerMonth = n(fd, "sessionsPerMonth");
  if (has(fd, "domain")) out.domain = s(fd, "domain");
  if (has(fd, "startDate")) out.startDate = s(fd, "startDate");
  return out;
}

export async function addQuoteLineAction(quoteId: string, fd: FormData) {
  await requireSession();
  const input = quoteLineFromForm(fd);
  if (!input.kind) return;
  await data.addQuoteLine(quoteId, input as data.QuoteLineInput);
  refresh();
}

export async function updateQuoteLineAction(id: string, fd: FormData) {
  await requireSession();
  await data.updateQuoteLine(id, quoteLineFromForm(fd));
  refresh();
}

export async function deleteQuoteLineAction(id: string) {
  await requireSession();
  await data.deleteQuoteLine(id);
  refresh();
}

export async function setQuoteStatusAction(id: string, status: data.QuoteInput["status"]) {
  await requireSession();
  if (!status) return;
  await data.setQuoteStatus(id, status);
  refresh();
}

export async function acceptQuoteAction(id: string, fd: FormData) {
  await requireSession();
  await data.acceptQuote(id, { startDate: s(fd, "startDate") });
  refresh();
  redirect(`/pipeline/offertes/${id}`);
}

export async function duplicateQuoteAction(id: string) {
  await requireSession();
  const q = await data.duplicateQuote(id);
  refresh();
  redirect(`/pipeline/offertes/${q!.id}`);
}

export async function deleteQuoteAction(id: string, leadId: string) {
  await requireSession();
  await data.deleteQuote(id);
  refresh();
  redirect(`/pipeline/${leadId}`);
}

/* ---------------- Aangiftecyclus ---------------- */

function scheduleFromForm(fd: FormData) {
  const out: Partial<data.ScheduleInput> = {};
  if (has(fd, "kind")) out.kind = s(fd, "kind") as data.ScheduleInput["kind"];
  if (has(fd, "label")) out.label = s(fd, "label");
  if (has(fd, "frequency")) out.frequency = (s(fd, "frequency") ?? undefined) as data.ScheduleInput["frequency"];
  if (has(fd, "extension")) out.extension = (s(fd, "extension") ?? "none") as data.ScheduleInput["extension"];
  if (has(fd, "startDate")) out.startDate = s(fd, "startDate") ?? undefined;
  if (has(fd, "endDate")) out.endDate = s(fd, "endDate");
  if (has(fd, "docsDueDays")) out.docsDueDays = n(fd, "docsDueDays");
  if (has(fd, "agreementId")) out.agreementId = s(fd, "agreementId");
  if (has(fd, "notes")) out.notes = s(fd, "notes");
  // Selectievakjes: alleen meenemen als het formulier ze toont
  if (has(fd, "_flags")) {
    out.createTasks = has(fd, "createTasks");
    out.active = has(fd, "active");
  }
  return out;
}

export async function createScheduleAction(clientId: string, fd: FormData) {
  await requireSession();
  const input = scheduleFromForm(fd);
  if (!input.kind) return;
  await data.createSchedule({ ...input, clientId } as data.ScheduleInput);
  refresh();
}

export async function updateScheduleAction(id: string, fd: FormData) {
  await requireSession();
  await data.updateSchedule(id, scheduleFromForm(fd));
  refresh();
}

export async function deleteScheduleAction(id: string) {
  await requireSession();
  await data.deleteSchedule(id);
  refresh();
}

function filingFromForm(fd: FormData) {
  const out: data.FilingPatch = {};
  if (has(fd, "status")) out.status = s(fd, "status") as data.FilingPatch["status"];
  if (has(fd, "deadline") && s(fd, "deadline")) out.deadline = s(fd, "deadline")!;
  for (const k of ["docsDueDate", "docsRequestedAt", "docsReceivedAt", "filedAt", "doneAt"] as const) if (has(fd, k)) out[k] = s(fd, k);
  if (has(fd, "amount")) {
    const raw = s(fd, "amount");
    const c = parseEuro(raw?.replace(/^\+/, "") ?? null);
    // "terug" of een minteken = terug te ontvangen
    out.amountCents = c == null ? null : has(fd, "refund") ? -Math.abs(c) : c;
  }
  if (has(fd, "reference")) out.reference = s(fd, "reference");
  if (has(fd, "notes")) out.notes = s(fd, "notes");
  return out;
}

export async function updateFilingAction(id: string, fd: FormData) {
  await requireSession();
  const patch = filingFromForm(fd);
  // Deadline alleen als hij echt anders is (anders telt hij als met de hand aangepast)
  const current = await data.getFiling(id);
  if (current && patch.deadline === current.deadline) delete patch.deadline;
  await data.updateFiling(id, patch);
  refresh();
}

export async function setFilingStatusAction(id: string, status: data.FilingPatch["status"]) {
  await requireSession();
  await data.updateFiling(id, { status });
  refresh();
}

export async function filingDocsRequestedAction(id: string) {
  await requireSession();
  await data.updateFiling(id, { docsRequestedAt: today() });
  refresh();
}

export async function filingDocsReceivedAction(id: string) {
  await requireSession();
  await data.updateFiling(id, { docsReceivedAt: today() });
  refresh();
}

export async function createFilingAction(fd: FormData) {
  await requireSession();
  const clientId = s(fd, "clientId");
  const kind = s(fd, "kind") as data.ScheduleInput["kind"] | null;
  const periodStart = s(fd, "periodStart");
  if (!clientId || !kind || !periodStart) return;
  const row = await data.createFiling({
    clientId,
    kind,
    label: s(fd, "label"),
    periodStart,
    frequency: (s(fd, "frequency") ?? undefined) as data.ScheduleInput["frequency"],
    deadline: s(fd, "deadline"),
    notes: s(fd, "notes"),
  });
  refresh();
  redirect(`/aangiftes/${row.id}`);
}

export async function deleteFilingAction(id: string, back: string) {
  await requireSession();
  await data.deleteFiling(id);
  refresh();
  redirect(back);
}

export async function logoutAction() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/login");
}
