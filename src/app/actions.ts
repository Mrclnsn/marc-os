"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { requireSession } from "@/lib/auth";
import * as data from "@/lib/data";
import { SESSION_COOKIE } from "@/lib/session";

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

function clientFromForm(fd: FormData) {
  const out: Partial<data.ClientInput> = {};
  if (has(fd, "name")) out.name = s(fd, "name") ?? "";
  if (has(fd, "contactPerson")) out.contactPerson = s(fd, "contactPerson");
  if (has(fd, "email")) out.email = s(fd, "email");
  if (has(fd, "phone")) out.phone = s(fd, "phone");
  if (has(fd, "status")) out.status = (s(fd, "status") ?? "active") as data.ClientInput["status"];
  if (has(fd, "info")) out.info = s(fd, "info");
  return out;
}

export async function createClientAction(fd: FormData) {
  await requireSession();
  const input = clientFromForm(fd);
  if (!input.name) return;
  const c = await data.createClient(input as data.ClientInput);
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

/* ---------------- Sessie ---------------- */

export async function logoutAction() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/login");
}
