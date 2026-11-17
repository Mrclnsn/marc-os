/**
 * Lokaal proberen zonder Postgres of Docker: npm run local
 *
 * `npm run local` start eerst een ingebouwde Postgres-server (PGlite, data in ./.local-pg)
 * en draait daarna dit script met DATABASE_URL naar die server. Dit script:
 *  1. maakt bij de eerste keer .env.local aan (wachtwoord: marc-os)
 *  2. voert migraties uit en importeert eenmalig de Notion-data
 *  3. start `next dev`
 * Stoppen met Ctrl+C sluit de database netjes af.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { execSync, spawn } from "node:child_process";
import { hashPassword } from "../src/lib/password";

const ENV = ".env.local";
const LOCAL_PASSWORD = "marc-os";
const SEEDED = ".local-pg-seeded";

const dbUrl = process.env.DATABASE_URL;
// De lokale PGlite-server verwerkt één verbinding tegelijk: houd elk proces op één verbinding
process.env.DATABASE_POOL = "1";
process.env.DATABASE_LOCAL = "1";
if (!dbUrl) {
  console.error("Start dit via `npm run local` (dan draait de lokale database mee).");
  process.exit(1);
}

if (!existsSync(ENV)) {
  writeFileSync(
    ENV,
    [
      `DATABASE_URL=${dbUrl}`,
      "DATABASE_POOL=1",
      "DATABASE_LOCAL=1",
      `SESSION_SECRET=${randomBytes(32).toString("hex")}`,
      `APP_PASSWORD_HASH=${hashPassword(LOCAL_PASSWORD)}`,
      `MCP_TOKEN=${randomBytes(32).toString("hex")}`,
      "CALENDAR_ICS_URLS=",
      "APP_TIMEZONE=Europe/Amsterdam",
      "",
    ].join("\n"),
  );
  console.log(`\n${ENV} aangemaakt. Lokaal wachtwoord: ${LOCAL_PASSWORD}`);
} else {
  // Oudere versie gebruikte een in-proces database; zet de URL om naar de lokale server
  const env = readFileSync(ENV, "utf8");
  const fixed = env
    .replace(/^DATABASE_URL=pglite:.*$/m, `DATABASE_URL=${dbUrl}`)
    .replace(/^DATABASE_POOL=.*\n?/gm, "")
    .replace(/^DATABASE_LOCAL=.*\n?/gm, "")
    .replace(/^(DATABASE_URL=.*)$/m, "$1\nDATABASE_POOL=1\nDATABASE_LOCAL=1");
  if (fixed !== env) writeFileSync(ENV, fixed);
}

// Overige instellingen uit .env.local voor de stappen hieronder
for (const line of readFileSync(ENV, "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const run = (cmd: string) => execSync(cmd, { stdio: "inherit", env: process.env });
run("npx tsx scripts/migrate.ts");
if (!existsSync(SEEDED)) {
  run("npx tsx scripts/seed.ts");
  writeFileSync(SEEDED, new Date().toISOString());
}

console.log("\nOpen http://localhost:3000");
console.log(`Wachtwoord: ${LOCAL_PASSWORD} (tenzij je .env.local hebt aangepast)\n`);

const next = spawn("npx", ["next", "dev"], { stdio: "inherit", env: process.env });
const stop = () => next.kill("SIGINT");
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
next.on("exit", (code) => process.exit(code ?? 0));
