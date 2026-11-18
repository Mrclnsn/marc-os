import { healthTokenOk, importHealth } from "@/lib/health";

export const dynamic = "force-dynamic";

/** Grootste zending die we aannemen (een volledige export van een jaar per dag is ruim onder de 5 MB). */
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Apple Health via Health Auto Export (gesprek 9).
 * POST /api/health/import met header "Authorization: Bearer <sleutel>" (of "X-Health-Token: <sleutel>"),
 * body: JSON zoals Health Auto Export het stuurt ({"data":{"metrics":[...],"workouts":[...]}}).
 * De sleutel staat op Instellingen → Apple Health en is los van de MCP-token: hij kan alleen gezondheidsdata aanleveren.
 */
export async function POST(req: Request) {
  const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ?? req.headers.get("x-health-token");
  if (!(await healthTokenOk(bearer?.trim()))) return Response.json({ error: "Geen toegang" }, { status: 401 });

  const size = Number(req.headers.get("content-length") ?? 0);
  if (size > MAX_BYTES) return Response.json({ error: "Zending te groot; exporteer een kortere periode" }, { status: 413 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Geen geldige JSON. Kies in Health Auto Export het formaat JSON." }, { status: 400 });
  }
  try {
    const r = await importHealth(body);
    // "count" herkent Health Auto Export als aantal verwerkte records
    return Response.json({ ok: true, count: r.samples + r.workouts + r.sleep, ...r });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

/** Controle vanuit de browser of een script: bestaat het adres? (zonder sleutel geen gegevens) */
export async function GET() {
  return Response.json({ ok: true, hint: "Stuur gegevens met POST en de sleutel van Instellingen → Apple Health." });
}
