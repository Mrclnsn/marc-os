import { migrate } from "drizzle-orm/postgres-js/migrator";
import { connect } from "../src/db/connect";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL ontbreekt");
  const { db, close } = connect(undefined, 1);
  await migrate(db, { migrationsFolder: "./drizzle" });
  await close();
  console.log("Migraties uitgevoerd");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
