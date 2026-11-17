import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
  sql?: ReturnType<typeof postgres>;
};

function getSql() {
  if (!globalForDb.sql) {
    // postgres() verbindt pas bij de eerste query, dus dit faalt niet tijdens de build
    globalForDb.sql = postgres(process.env.DATABASE_URL ?? "", { max: 10 });
  }
  return globalForDb.sql;
}

export const db = drizzle({ client: getSql(), schema });
export { schema };
