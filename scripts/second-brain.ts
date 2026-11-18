/**
 * Second brain bijhouden buiten de app om.
 *
 *   npx tsx scripts/second-brain.ts export <map>    Obsidian-export naar een map (bijv. ~/Obsidian/Marc OS)
 *   npx tsx scripts/second-brain.ts reindex         [[links]] opnieuw opbouwen en de zoekindex bijwerken
 *   npx tsx scripts/second-brain.ts nightly <map>   beide (de nachtelijke taak op de VPS)
 *
 * Lokaal: laat `npm run local` draaien en gebruik `npm run obsidian -- <map>` in een tweede venster.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

// Lokaal: instellingen uit .env.local (DATABASE_URL naar de PGlite-server, embedding-sleutel)
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

async function main() {
  const [cmd, dirArg] = process.argv.slice(2);
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL ontbreekt (lokaal: laat npm run local draaien).");
  if (!cmd || !["export", "reindex", "nightly"].includes(cmd)) throw new Error("Gebruik: export <map> | reindex | nightly <map>");

  if (cmd === "reindex" || cmd === "nightly") {
    const { reindexAllLinks } = await import("../src/lib/brain");
    const { syncEmbeddings } = await import("../src/lib/search");
    const l = await reindexAllLinks();
    console.log(`Links opnieuw opgebouwd: ${l.notes} notities, ${l.sources} bronnen`);
    const e = await syncEmbeddings(5000);
    console.log(e.ok ? `Zoekindex: ${e.indexed} bijgewerkt, ${e.unchanged} ongewijzigd, ${e.removed} opgeruimd` : `Zoekindex niet bijgewerkt: ${e.reason}`);
  }
  if (cmd === "export" || cmd === "nightly") {
    if (!dirArg) throw new Error("Geef de map op, bijv. ~/Obsidian/Marc OS");
    const dir = resolve(dirArg.replace(/^~(?=$|\/)/, homedir()));
    const { buildVault } = await import("../src/lib/obsidian");
    const { writeVault } = await import("../src/lib/obsidian-write");
    const r = writeVault(dir, await buildVault());
    console.log(`Obsidian-export in ${dir}: ${r.files} bestanden, ${r.written} geschreven, ${r.removed} verwijderd`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
