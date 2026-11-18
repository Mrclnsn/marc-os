import { cookies } from "next/headers";
import { tokenOk } from "@/lib/mcp";
import { buildVault } from "@/lib/obsidian";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import { makeZip } from "@/lib/zip";

export const dynamic = "force-dynamic";

/**
 * Obsidian-export als zip. Toegang met de app-sessie (knop op Instellingen)
 * of met de MCP-token als Bearer, voor een nachtelijke download naar de Mac (scripts/obsidian-mac.sh).
 */
export async function GET(req: Request) {
  const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!(bearer ? tokenOk(bearer) : await verifySessionToken(session))) return new Response("Niet ingelogd", { status: 401 });

  const files = await buildVault();
  const zip = makeZip(files.map((f) => ({ path: `Marc OS/${f.path}`, content: f.content })));
  const day = new Date().toISOString().slice(0, 10);
  return new Response(new Uint8Array(zip), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="marc-os-obsidian-${day}.zip"`,
      "cache-control": "no-store",
    },
  });
}
