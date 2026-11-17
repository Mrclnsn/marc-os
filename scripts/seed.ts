/**
 * Importeert scripts/notion-export.json. Veilig om vaker te draaien:
 * bestaande klanten (op naam) en taken (titel + klant) worden overgeslagen.
 *
 * Draaien: npm run seed
 */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { readFileSync } from "node:fs";
import { and, eq, ilike } from "drizzle-orm";
import { connect } from "../src/db/connect";
import * as schema from "../src/db/schema";

type Export = {
  clients: { name: string; contactPerson?: string; email?: string; phone?: string; status?: "lead" | "active" | "on_hold" | "past"; info?: string }[];
  projects: { name: string; client?: string; area?: "zakelijk" | "prive"; status?: "idea" | "planned" | "active" | "waiting" | "done" | "archived"; dueDate?: string; description?: string }[];
  tasks: { title: string; client?: string; project?: string; area?: "zakelijk" | "prive"; status?: "todo" | "doing" | "waiting" | "done"; planDate?: string; dueDate?: string; notes?: string; recurrence?: "none" | "daily" | "weekdays" | "weekly" | "monthly" | "quarterly" | "yearly" }[];
};

async function main() {
  const { db, close } = connect();
  const file = process.argv[2] ?? "scripts/notion-export.json";
  const data: Export = JSON.parse(readFileSync(file, "utf8"));
  const { clients, projects, tasks } = schema;

  const clientIds = new Map<string, string>();
  for (const c of data.clients) {
    const [existing] = await db.select().from(clients).where(ilike(clients.name, c.name));
    if (existing) {
      clientIds.set(c.name, existing.id);
      continue;
    }
    const [row] = await db.insert(clients).values(c).returning();
    clientIds.set(c.name, row.id);
    console.log("Klant:", c.name);
  }

  const projectIds = new Map<string, string>();
  for (const p of data.projects) {
    const clientId = p.client ? clientIds.get(p.client) ?? null : null;
    const [existing] = await db.select().from(projects).where(eq(projects.name, p.name));
    if (existing) {
      projectIds.set(p.name, existing.id);
      continue;
    }
    const { client: _c, ...rest } = p;
    const [row] = await db.insert(projects).values({ ...rest, clientId }).returning();
    projectIds.set(p.name, row.id);
    console.log("Project:", p.name);
  }

  for (const t of data.tasks) {
    const clientId = t.client ? clientIds.get(t.client) ?? null : null;
    const projectId = t.project ? projectIds.get(t.project) ?? null : null;
    const [existing] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.title, t.title), clientId ? eq(tasks.clientId, clientId) : undefined));
    if (existing) continue;
    const { client: _c, project: _p, ...rest } = t;
    await db.insert(tasks).values({ ...rest, clientId, projectId });
    console.log("Taak:", t.title);
  }

  await close();
  console.log("Import klaar");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
