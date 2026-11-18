/**
 * Embeddings voor semantisch zoeken. Instelbaar via .env:
 *
 *   EMBEDDING_PROVIDER=voyage | openai     (leeg = semantisch zoeken uit, zoeken op trefwoord blijft werken)
 *   EMBEDDING_API_KEY=...
 *   EMBEDDING_MODEL=voyage-4                (optioneel; standaard voyage-4 of text-embedding-3-small)
 *
 * Voyage (aanbevolen door Anthropic, meertalig) en OpenAI werken via hun HTTP-API, zonder extra pakketten.
 * Let op (ISO 27001): de provider krijgt de tekst van notities en bronnen te zien. Opnemen in het leveranciersregister.
 *
 * "local-test" is alleen voor tests: een woordhash zonder betekenis, zodat de hele keten zonder sleutel te testen is.
 */
import { createHash } from "node:crypto";

export type EmbeddingProvider = "voyage" | "openai" | "local-test";

export type EmbeddingConfig = { provider: EmbeddingProvider; model: string; apiKey: string | null };

const DEFAULT_MODEL: Record<EmbeddingProvider, string> = {
  voyage: "voyage-4",
  openai: "text-embedding-3-small",
  "local-test": "local-test-256",
};

export const PROVIDER_LABEL: Record<EmbeddingProvider, string> = {
  voyage: "Voyage AI",
  openai: "OpenAI",
  "local-test": "Testmodus (geen echte betekenis)",
};

export function embeddingConfig(): EmbeddingConfig | null {
  const p = (process.env.EMBEDDING_PROVIDER ?? "").trim().toLowerCase();
  if (p !== "voyage" && p !== "openai" && p !== "local-test") return null;
  const apiKey = process.env.EMBEDDING_API_KEY?.trim() || null;
  if (p !== "local-test" && !apiKey) return null;
  return { provider: p, model: process.env.EMBEDDING_MODEL?.trim() || DEFAULT_MODEL[p], apiKey };
}

/** Waarom semantisch zoeken (nog) uit staat, in gewone taal. */
export function embeddingProblem(): string | null {
  const p = (process.env.EMBEDDING_PROVIDER ?? "").trim().toLowerCase();
  if (!p) return "Geen embedding-provider ingesteld (EMBEDDING_PROVIDER in .env).";
  if (!["voyage", "openai", "local-test"].includes(p)) return `Onbekende embedding-provider "${p}". Gebruik voyage of openai.`;
  if (p !== "local-test" && !process.env.EMBEDDING_API_KEY?.trim()) return "EMBEDDING_API_KEY ontbreekt in .env.";
  return null;
}

/**
 * Zet teksten om in vectoren. inputType helpt Voyage onderscheid te maken tussen opgeslagen tekst en een zoekvraag.
 * Gooit een fout als de provider niet antwoordt; de aanroeper vangt die op en valt terug op trefwoorden.
 */
export async function embed(cfg: EmbeddingConfig, texts: string[], inputType: "document" | "query"): Promise<number[][]> {
  if (!texts.length) return [];
  if (cfg.provider === "local-test") return texts.map(hashEmbedding);

  const out: number[][] = [];
  const batch = 64;
  for (let i = 0; i < texts.length; i += batch) {
    const part = texts.slice(i, i + batch);
    const res =
      cfg.provider === "voyage"
        ? await fetch("https://api.voyageai.com/v1/embeddings", {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
            body: JSON.stringify({ input: part, model: cfg.model, input_type: inputType, truncation: true }),
            signal: AbortSignal.timeout(30_000),
          })
        : await fetch("https://api.openai.com/v1/embeddings", {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
            body: JSON.stringify({ input: part, model: cfg.model }),
            signal: AbortSignal.timeout(30_000),
          });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`${PROVIDER_LABEL[cfg.provider]} gaf ${res.status}: ${text.slice(0, 200)}`);
    }
    const body = (await res.json()) as { data: { embedding: number[]; index: number }[] };
    const sorted = [...body.data].sort((a, b) => a.index - b.index);
    out.push(...sorted.map((d) => d.embedding));
  }
  return out;
}

/** Testvector: woorden (en woorddelen) gehasht in 256 vakjes. Alleen om de keten te testen. */
function hashEmbedding(text: string): number[] {
  const v = new Array(256).fill(0);
  const words = text.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 2);
  for (const w of words) {
    for (const part of [w, w.slice(0, 5)]) {
      const h = createHash("md5").update(part).digest();
      v[h[0]] += h[1] & 1 ? 1 : -1;
    }
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

/** Vector als tekst voor pgvector: '[0.1,0.2,...]'. */
export function vectorLiteral(v: number[]): string {
  return `[${v.map((x) => (Number.isFinite(x) ? Number(x.toFixed(7)) : 0)).join(",")}]`;
}
