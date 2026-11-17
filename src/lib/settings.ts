import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { DEFAULT_MODULES, KPI_KEYS, MODULE_KEYS, type KpiKey, type ModuleKey, type Modules } from "./modules";

export * from "./modules";

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

/** Welke modules aan staan. Onbekende of ontbrekende modules krijgen de MVP-stand (uit). */
export async function getModules(): Promise<Modules> {
  const stored = (await readSetting<Partial<Modules>>("modules")) ?? {};
  const out = { ...DEFAULT_MODULES };
  for (const k of MODULE_KEYS) if (typeof stored[k] === "boolean") out[k] = stored[k]!;
  return out;
}

export async function isModuleOn(key: ModuleKey): Promise<boolean> {
  return (await getModules())[key];
}

/** Eén module aan- of uitzetten. In één SQL-opdracht, zodat snel na elkaar schakelen niets overschrijft. */
export async function setModule(key: ModuleKey, on: boolean): Promise<Modules> {
  const patch = { [key]: on };
  await db
    .insert(settings)
    .values({ key: "modules", value: patch })
    .onConflictDoUpdate({ target: settings.key, set: { value: sql`${settings.value} || ${JSON.stringify(patch)}::jsonb`, updatedAt: new Date() } });
  return getModules();
}

/** KPI-tegels die Marc op Vandaag heeft verborgen (nieuwe tegels verschijnen dus vanzelf). */
export async function getHiddenKpis(): Promise<KpiKey[]> {
  const stored = (await readSetting<string[]>("hidden_kpis")) ?? [];
  return stored.filter((k): k is KpiKey => (KPI_KEYS as readonly string[]).includes(k));
}

export async function setHiddenKpis(keys: KpiKey[]) {
  await writeSetting("hidden_kpis", [...new Set(keys)]);
}
