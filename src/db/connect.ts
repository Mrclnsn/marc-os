import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Verbindt met Postgres via DATABASE_URL.
 * Lokaal (npm run local) is dat een ingebouwde PGlite-server die als apart proces draait,
 * zodat er altijd maar één proces de databasebestanden open heeft.
 */
export function connect(url = process.env.DATABASE_URL ?? "", max = Number(process.env.DATABASE_POOL ?? 10)) {
  // postgres() verbindt pas bij de eerste query, dus dit faalt niet tijdens de build
  // Lokale PGlite-server: geen type-ophaalquery en geen named prepared statements
  const local = process.env.DATABASE_LOCAL === "1";
  const sql = postgres(url, local ? { max: 1, fetch_types: false, prepare: false, onnotice: () => {} } : { max });
  const db: Db = drizzle({ client: sql, schema });
  return { db, close: () => sql.end() };
}
