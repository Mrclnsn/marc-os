"use client";

import { useState } from "react";
import { PERIOD, PRICING, SERVICE_DEFAULTS, SERVICE_KIND, AGREEMENT_STATUS, type Pricing, type ServiceKind } from "@/lib/labels";
import { centsToInput } from "@/lib/money";

type Opt = { id: string; name: string };

export type AgreementValues = {
  kind?: ServiceKind;
  title?: string | null;
  amountCents?: number | null;
  pricing?: Pricing;
  period?: string | null;
  websiteId?: string | null;
  projectId?: string | null;
  budgetCents?: number | null;
  sessionsPerMonth?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  noticeMonths?: number | null;
  indexationPct?: number | null;
  status?: string;
  notes?: string | null;
};

const lbl = "label";

/**
 * Velden van een afspraak. Kiest bij een nieuwe afspraak de standaard prijsvorm en periode bij de soort,
 * en toont alleen de velden die bij de prijsvorm horen.
 */
export function AgreementFields({ value = {}, websites, projects, clients, isNew = false }: { value?: AgreementValues; websites: Opt[]; projects: Opt[]; clients?: Opt[]; isNew?: boolean }) {
  const [kind, setKind] = useState<ServiceKind>(value.kind ?? "bookkeeping");
  const [pricing, setPricing] = useState<Pricing>(value.pricing ?? SERVICE_DEFAULTS[value.kind ?? "bookkeeping"].pricing);
  const [period, setPeriod] = useState<string>(value.period ?? SERVICE_DEFAULTS[value.kind ?? "bookkeeping"].period ?? "month");
  const [amount, setAmount] = useState<string>(centsToInput(value.amountCents ?? SERVICE_DEFAULTS[value.kind ?? "bookkeeping"].amountCents));

  function changeKind(k: ServiceKind) {
    setKind(k);
    if (!isNew) return;
    const def = SERVICE_DEFAULTS[k];
    setPricing(def.pricing);
    if (def.period) setPeriod(def.period);
    if (def.amountCents !== undefined && amount === "") setAmount(centsToInput(def.amountCents));
  }

  const amountLabel = pricing === "hourly" ? "Uurtarief (excl. btw)" : pricing === "one_off" ? "Bedrag (excl. btw)" : "Bedrag per periode (excl. btw)";
  const showWebsite = kind === "hosting" || kind === "maintenance" || kind === "website";

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-3">
        {clients && (
          <label className="block">
            <span className={lbl}>Klant</span>
            <select name="clientId" required defaultValue="" className="input w-full">
              <option value="" disabled>Kies een klant</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
        <label className="block">
          <span className={lbl}>Soort dienst</span>
          <select name="kind" value={kind} onChange={(e) => changeKind(e.target.value as ServiceKind)} className="input w-full">
            {Object.entries(SERVICE_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={lbl}>Omschrijving (optioneel)</span>
          <input name="title" defaultValue={value.title ?? ""} placeholder="Bijv. Boekhouding en btw-aangiftes" className="input w-full" />
        </label>
        <label className="block">
          <span className={lbl}>Status</span>
          <select name="status" defaultValue={value.status ?? "active"} className="input w-full">
            {Object.entries(AGREEMENT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <label className="block">
          <span className={lbl}>Prijsvorm</span>
          <select name="pricing" value={pricing} onChange={(e) => setPricing(e.target.value as Pricing)} className="input w-full">
            {Object.entries(PRICING).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={lbl}>{amountLabel}</span>
          <input name="amount" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="€" className="input w-full" />
        </label>
        {pricing === "recurring" && (
          <label className="block">
            <span className={lbl}>Periode</span>
            <select name="period" value={period} onChange={(e) => setPeriod(e.target.value)} className="input w-full">
              {Object.entries(PERIOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        )}
        {pricing === "hourly" && (
          <label className="block">
            <span className={lbl}>Budget / plafond (optioneel)</span>
            <input name="budget" inputMode="decimal" defaultValue={centsToInput(value.budgetCents)} placeholder="€" className="input w-full" />
          </label>
        )}
        {kind === "sparring" && (
          <label className="block">
            <span className={lbl}>Sessies per maand (optioneel)</span>
            <input name="sessionsPerMonth" type="number" min={0} defaultValue={value.sessionsPerMonth ?? ""} className="input w-full" />
          </label>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {showWebsite && (
          <label className="block">
            <span className={lbl}>Website</span>
            <select name="websiteId" defaultValue={value.websiteId ?? ""} className="input w-full">
              <option value="">Geen website</option>
              {websites.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
        )}
        <label className="block">
          <span className={lbl}>Project</span>
          <select name="projectId" defaultValue={value.projectId ?? ""} className="input w-full">
            <option value="">{isNew && kind === "website" && pricing === "one_off" ? "Nieuw websiteproject aanmaken" : "Geen project"}</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <label className="block">
          <span className={lbl}>Startdatum</span>
          <input type="date" name="startDate" defaultValue={value.startDate ?? ""} className="input w-full" />
        </label>
        <label className="block">
          <span className={lbl}>Einddatum</span>
          <input type="date" name="endDate" defaultValue={value.endDate ?? ""} className="input w-full" />
        </label>
        {pricing !== "one_off" && (
          <>
            <label className="block">
              <span className={lbl}>Opzegtermijn (maanden)</span>
              <input type="number" name="noticeMonths" min={0} max={36} defaultValue={value.noticeMonths ?? ""} className="input w-full" />
            </label>
            <label className="block">
              <span className={lbl}>Jaarlijkse indexatie (%)</span>
              <input name="indexationPct" inputMode="decimal" defaultValue={value.indexationPct != null ? String(value.indexationPct).replace(".", ",") : ""} className="input w-full" />
            </label>
          </>
        )}
      </div>

      <textarea name="notes" rows={2} defaultValue={value.notes ?? ""} placeholder="Notitie (wat valt erbinnen, bijzonderheden)" className="input w-full" />
      {isNew && pricing === "one_off" && (
        <p className="text-xs text-steen">
          {kind === "website"
            ? "Maakt automatisch 2 termijnen van 50%: bij akkoord en bij oplevering."
            : "Maakt automatisch 1 termijn bij oplevering. Zelf splitsen kan daarna."}
        </p>
      )}
    </div>
  );
}
