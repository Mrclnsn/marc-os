import { migrate as migratePg } from "drizzle-orm/postgres-js/migrator";
import { migrate as migrateLite } from "drizzle-orm/pglite/migrator";
import { connect } from "../src/db/connect";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL ontbreekt");
  const { db, close, kind } = connect();
  const migrate = (kind === "pglite" ? migrateLite : migratePg) as typeof migratePg;
  await migrate(db, { migrationsFolder: "./drizzle" });
  await close();
  console.log("Migraties uitgevoerd");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
