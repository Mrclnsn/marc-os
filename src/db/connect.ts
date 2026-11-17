import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { drizzle as drizzleLite } from "drizzle-orm/pglite";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = ReturnType<typeof drizzlePg<typeof schema>>;

/**
 * DATABASE_URL=postgres://...   → echte Postgres (productie)
 * DATABASE_URL=pglite:./.local-db → ingebouwde Postgres in een map (lokaal, niets te installeren)
 */
export function connect(url = process.env.DATABASE_URL ?? ""): { db: Db; close: () => Promise<void>; kind: "pg" | "pglite" } {
  if (url.startsWith("pglite:")) {
    const dir = url.slice("pglite:".length) || "./.local-db";
    // PGlite wordt pas geladen als het echt nodig is
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PGlite } = require("@electric-sql/pglite") as typeof import("@electric-sql/pglite");
    const client = new PGlite(dir);
    const db = drizzleLite({ client, schema }) as unknown as Db;
    return { db, close: () => client.close(), kind: "pglite" };
  }
  // postgres() verbindt pas bij de eerste query, dus dit faalt niet tijdens de build
  const sql = postgres(url, { max: 10 });
  const db = drizzlePg({ client: sql, schema });
  return { db, close: () => sql.end(), kind: "pg" };
}
