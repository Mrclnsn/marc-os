import { createReadStream } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { cookies } from "next/headers";
import { tokenOk } from "@/lib/mcp";
import { BACKUP_DIR, isBackupName, listBackups, recordBackupPull } from "@/lib/push";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Versleutelde database-back-ups van de VPS, voor opslag buiten de VPS.
 * Toegang met de app-sessie of de MCP-token als Bearer (scripts/mac-daily.sh).
 *   ?list=1         lijst als JSON
 *   ?latest=1       alleen de naam van de nieuwste (platte tekst, voor het Mac-script)
 *   ?file=<naam>    één bestand; zonder file de nieuwste
 * Een download met de token geldt als "opgehaald door de Mac" (systeemmelding na 3 dagen zonder).
 */
export async function GET(req: Request) {
  const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!(bearer ? tokenOk(bearer) : await verifySessionToken(session))) return new Response("Niet ingelogd", { status: 401 });

  const url = new URL(req.url);
  const backups = listBackups();
  if (url.searchParams.get("list")) return Response.json(backups, { headers: { "cache-control": "no-store" } });
  if (url.searchParams.get("latest")) {
    if (!backups.length) return new Response("Geen back-up gevonden", { status: 404 });
    return new Response(backups[0].name, { headers: { "content-type": "text/plain", "cache-control": "no-store" } });
  }

  const name = url.searchParams.get("file") ?? backups[0]?.name;
  if (!name || !isBackupName(name) || !backups.some((b) => b.name === name)) return new Response("Geen back-up gevonden", { status: 404 });
  const file = backups.find((b) => b.name === name)!;
  if (bearer) await recordBackupPull(name);

  const stream = Readable.toWeb(createReadStream(join(BACKUP_DIR, name))) as ReadableStream;
  return new Response(stream, {
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(file.bytes),
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
    },
  });
}
