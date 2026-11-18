/** Obsidian-export naar schijf schrijven. Alleen voor het script (niet in de app, zodat de build niets extra meeneemt). */
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { VAULT_FOLDERS, type VaultFile } from "./obsidian";

/**
 * Schrijft de map weg. Alleen de map-onderdelen van Marc OS worden beheerd: oude bestanden daarin worden verwijderd,
 * ongewijzigde bestanden niet opnieuw geschreven. Andere mappen (zoals .obsidian of eigen notities) blijven staan.
 */
export function writeVault(dir: string, files: VaultFile[]) {
  mkdirSync(dir, { recursive: true });
  const wanted = new Set(files.map((f) => f.path));
  let written = 0;
  let removed = 0;
  for (const f of files) {
    const full = join(dir, f.path);
    mkdirSync(dirname(full), { recursive: true });
    if (existsSync(full) && readFileSync(full, "utf8") === f.content) continue;
    writeFileSync(full, f.content);
    written++;
  }
  for (const folder of VAULT_FOLDERS) {
    const d = join(dir, folder);
    if (!existsSync(d)) continue;
    for (const name of readdirSync(d)) {
      const rel = `${folder}/${name}`;
      if (name.endsWith(".md") && !wanted.has(rel) && statSync(join(d, name)).isFile()) {
        rmSync(join(d, name));
        removed++;
      }
    }
  }
  return { files: files.length, written, removed };
}
