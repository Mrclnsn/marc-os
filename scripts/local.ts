/**
 * Lokaal proberen zonder database of Docker: npm run local
 * Maakt bij de eerste keer .env.local aan met een ingebouwde database (PGlite in ./.local-db),
 * voert migraties uit en importeert de Notion-data. Daarna start `next dev`.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { execSync } from "node:child_process";
import { hashPassword } from "../src/lib/password";

const ENV = ".env.local";
const LOCAL_PASSWORD = "marc-os";

if (!existsSync(ENV)) {
  writeFileSync(
    ENV,
    [
      "DATABASE_URL=pglite:./.local-db",
      `SESSION_SECRET=${randomBytes(32).toString("hex")}`,
      `APP_PASSWORD_HASH=${hashPassword(LOCAL_PASSWORD)}`,
      `MCP_TOKEN=${randomBytes(32).toString("hex")}`,
      "CALENDAR_ICS_URLS=",
      "APP_TIMEZONE=Europe/Amsterdam",
      "",
    ].join("\n"),
  );
  console.log(`\n${ENV} aangemaakt. Lokaal wachtwoord: ${LOCAL_PASSWORD}\n`);
}

// .env.local inlezen voor de scripts hieronder
for (const line of readFileSync(ENV, "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const run = (cmd: string) => execSync(cmd, { stdio: "inherit", env: process.env });

run("npx tsx scripts/migrate.ts");
if (!existsSync(".local-seeded")) {
  run("npx tsx scripts/seed.ts");
  writeFileSync(".local-seeded", new Date().toISOString());
}

console.log("\nStart op http://localhost:3000");
if (process.env.DATABASE_URL?.startsWith("pglite:")) console.log(`Wachtwoord: ${LOCAL_PASSWORD} (tenzij je .env.local hebt aangepast)\n`);
