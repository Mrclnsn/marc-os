import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import * as agent from "./agent";
import { hermesConfig } from "./hermes";

/*
 * WhatsApp via Hermes (gesprek 13).
 *
 * In: Marc praat met Hermes op een apart WhatsApp-nummer (Hermes-gateway, ingebouwde koppeling in bot-modus).
 *     Alleen Marc's eigen nummer staat in de allowlist van Hermes. "ja"/"nee" over voorstellen vangt een kleine
 *     Hermes-plugin af (hermes/plugins/marcos-akkoord) vóórdat het model het ziet, en stuurt het naar
 *     /api/whatsapp/akkoord met een eigen sleutel. Hermes zelf kan dus nog steeds niets goedkeuren.
 * Uit: Marc OS stuurt tekst naar WhatsApp via de webhook van Hermes (route marcos-bericht, deliver_only:
 *      geen model, alleen afleveren), ondertekend met HERMES_WEBHOOK_SECRET.
 */

export function whatsappConfig() {
  const enabled = (process.env.HERMES_WHATSAPP ?? "").toLowerCase() === "true";
  const url = (process.env.HERMES_WEBHOOK_URL ?? (enabled ? "http://hermes:8644" : "")).replace(/\/+$/, "");
  const secret = process.env.HERMES_WEBHOOK_SECRET ?? "";
  const number = (process.env.WHATSAPP_NUMBER ?? "").replace(/\D/g, "");
  return { enabled, url, secret, number, configured: enabled && !!url && secret.length >= 24 };
}

/** Nummer half verborgen voor de weergave: +31 6 •••• 5678 */
export function maskedNumber(n = whatsappConfig().number) {
  if (!n) return "";
  return `+${n.slice(0, 2)} ${n.slice(2, 3)} •••• ${n.slice(-4)}`;
}

/** Klopt de sleutel van de akkoord-plugin? */
export function approveTokenOk(token: string | null | undefined) {
  const expected = process.env.WHATSAPP_APPROVE_TOKEN ?? "";
  if (expected.length < 24 || !token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type SendResult = { ok: true } | { ok: false; error: string };

/** Tekst naar Marc's WhatsApp, via de webhook van Hermes (deliver_only: het model doet niets). */
export async function sendWhatsApp(text: string): Promise<SendResult> {
  const cfg = whatsappConfig();
  if (!cfg.configured) return { ok: false, error: "WhatsApp is niet gekoppeld" };
  const body = JSON.stringify({ text: text.slice(0, 12_000) });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac("sha256", cfg.secret).update(`${ts}.${body}`).digest("hex");
  try {
    const res = await fetch(`${cfg.url}/webhooks/marcos-bericht`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-webhook-timestamp": ts,
        "x-webhook-signature-v2": sig,
        "x-request-id": randomUUID(),
      },
      body,
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) return { ok: true };
    return { ok: false, error: res.status === 404 ? "webhook niet gevonden (route of sleutel klopt niet)" : `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: `niet bereikbaar (${e instanceof Error ? e.message : String(e)})` };
  }
}

export type WhatsAppStatus = { configured: boolean; number: string; state: string | null; error?: string };

let cachedStatus: { at: number; value: WhatsAppStatus } | null = null;

/** Verbonden met WhatsApp? Uit /health/detailed van Hermes (platforms.whatsapp.state). Kort gecachet. */
export async function whatsappStatus(force = false): Promise<WhatsAppStatus> {
  const cfg = whatsappConfig();
  const base: WhatsAppStatus = { configured: cfg.configured, number: maskedNumber(cfg.number), state: null };
  if (!cfg.configured) return base;
  if (!force && cachedStatus && Date.now() - cachedStatus.at < 60_000) return cachedStatus.value;
  const h = hermesConfig();
  let value: WhatsAppStatus;
  try {
    const res = await fetch(`${h.url}/health/detailed`, { headers: { authorization: `Bearer ${h.key}` }, signal: AbortSignal.timeout(2500), cache: "no-store" });
    const body = (await res.json().catch(() => null)) as { platforms?: Record<string, { state?: string; error_message?: string }> } | null;
    const wa = body?.platforms?.whatsapp;
    value = { ...base, state: wa?.state ?? (res.ok ? "onbekend" : null), error: res.ok ? wa?.error_message : `HTTP ${res.status}` };
  } catch (e) {
    value = { ...base, error: e instanceof Error ? e.message : String(e) };
  }
  cachedStatus = { at: Date.now(), value };
  return value;
}

/* ------------------------------------------------------------------ */
/* "ja" en "nee" in WhatsApp                                           */
/* ------------------------------------------------------------------ */

export type Decision =
  | { action: "approve" | "reject"; target: "all" | "default" | number[]; note: string | null }
  | { action: "none" };

const APPROVE = new Set(["ja", "akkoord", "ok", "oké", "oke", "prima", "doen", "goedgekeurd"]);
const REJECT = new Set(["nee", "afwijzen", "afgewezen", "niet doen"]);

/**
 * Lees een kort antwoord van Marc. Alleen duidelijke vormen tellen; al het andere gaat gewoon naar Hermes.
 *   ja | ja alles | ja 12 | ja #12, #14 | akkoord 12
 *   nee | nee alles | nee 12 | nee 12: te vroeg | nee: liever morgen
 * "ja 12 maar dan om 10 uur" of "nee dank je" zijn geen besluit (dan antwoordt Hermes).
 */
export function parseDecision(raw: string): Decision {
  const text = raw
    .normalize("NFC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.!?\s]+$/u, "");
  const m = text.match(/^(niet doen|[a-zé]+)(?=$|[\s,:#])(.*)$/u);
  if (!m) return { action: "none" };
  const word = m[1];
  const action = APPROVE.has(word) ? "approve" : REJECT.has(word) ? "reject" : null;
  if (!action) return { action: "none" };

  let rest = m[2];
  let note: string | null = null;
  const sep = rest.search(/:|,(?!\s*[#\d])|\s-\s/);
  if (sep >= 0) {
    note = rest.slice(sep).replace(/^(\s*[:,]\s*|\s-\s)/, "").trim() || null;
    rest = rest.slice(0, sep);
  }
  rest = rest.trim();
  let target: "all" | "default" | number[] = "default";
  if (/^(alles|allemaal|alle|alle voorstellen)$/.test(rest)) target = "all";
  else if (rest) {
    const ids = rest.split(/[\s,]+/).map((x) => x.replace(/^#/, ""));
    if (!ids.every((x) => /^\d{1,7}$/.test(x))) return { action: "none" };
    target = [...new Set(ids.map(Number))];
  }
  // Een reden bij akkoord is geen eenvoudig "ja": dat laten we aan Hermes
  if (action === "approve" && note) return { action: "none" };
  return { action, target, note };
}

export type DecisionReply = { handled: boolean; reply?: string };

const line = (p: { nr: number; title: string }) => `#${p.nr} ${p.title}`;

/** Voer een besluit uit WhatsApp uit. Alleen voor berichten die de akkoord-plugin van Marc's eigen nummer doorstuurt. */
export async function handleWhatsAppDecision(text: string): Promise<DecisionReply> {
  const d = parseDecision(text);
  if (d.action === "none") return { handled: false };

  const open = await agent.listProposals({ status: "pending", limit: 50 });
  let chosen: typeof open;
  const missing: number[] = [];
  if (d.target === "all") chosen = open;
  else if (d.target === "default") {
    if (open.length === 0) return { handled: false }; // dan is "ja" een antwoord op iets anders: Hermes
    if (open.length > 1) {
      return {
        handled: true,
        reply: [
          `Er staan ${open.length} voorstellen open:`,
          ...open.slice(0, 10).map(line),
          open.length > 10 ? `en nog ${open.length - 10} (zie de app)` : "",
          "",
          `Antwoord met ${d.action === "approve" ? "ja" : "nee"} alles, of met de nummers (bijv. ${d.action === "approve" ? "ja" : "nee"} ${open[0].nr}).`,
        ]
          .filter((l, i, a) => l || a[i - 1])
          .join("\n"),
      };
    }
    chosen = open;
  } else {
    chosen = [];
    for (const nr of d.target) {
      const p = open.find((x) => x.nr === nr);
      if (p) chosen.push(p);
      else missing.push(nr);
    }
  }
  if (!chosen.length && !missing.length) return { handled: true, reply: "Er staat niets open om goed te keuren." };

  const out: string[] = [];
  if (d.action === "approve") {
    const { approveProposal } = await import("./mcp");
    const ok: string[] = [];
    const failed: string[] = [];
    for (const p of chosen) {
      const r = await approveProposal(p.id, "whatsapp");
      if (r.ok) ok.push(line(p));
      else failed.push(`${line(p)}: ${r.error}`);
    }
    if (ok.length) out.push(ok.length === 1 ? `Gedaan: ${ok[0]}` : `Gedaan (${ok.length}):\n${ok.join("\n")}`);
    if (failed.length) out.push(`Niet gelukt:\n${failed.join("\n")}`);
  } else {
    const done: string[] = [];
    for (const p of chosen) {
      const r = await agent.rejectProposal(p.id, "whatsapp", d.note);
      if (r) done.push(line(p));
    }
    if (done.length) out.push(`${done.length === 1 ? `Afgewezen: ${done[0]}` : `Afgewezen (${done.length}):\n${done.join("\n")}`}${d.note ? `\nReden: ${d.note}` : ""}`);
  }
  if (missing.length) out.push(`${missing.map((n) => `#${n}`).join(", ")} staat niet (meer) open.`);
  const left = await agent.pendingCount();
  if (left) out.push(`Nog ${left} open.`);
  return { handled: true, reply: out.join("\n\n") };
}

/** Voorstellen onder een bericht (routine), met hoe Marc ze in WhatsApp afhandelt. */
export function proposalsBlock(list: { nr: number; title: string }[]): string {
  if (!list.length) return "";
  const example = list[0].nr;
  return [
    `Voorstellen (${list.length}):`,
    ...list.map(line),
    "",
    list.length === 1
      ? `Antwoord ja of nee (nee: reden mag). Iets anders? pas aan ${example}: ...`
      : `Antwoord ja alles, ja ${example}, of nee ${example}: reden. Iets anders? pas aan ${example}: ...`,
  ].join("\n");
}
