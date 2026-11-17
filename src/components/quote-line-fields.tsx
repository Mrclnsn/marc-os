"use client";

import { useState } from "react";
import { PERIOD, PRICING, SERVICE_DEFAULTS, SERVICE_KIND, type Pricing, type ServiceKind } from "@/lib/labels";
import { centsToInput } from "@/lib/money";

export type QuoteLineValues = {
  kind?: ServiceKind;
  description?: string | null;
  amountCents?: number | null;
  pricing?: Pricing;
  period?: string | null;
  budgetCents?: number | null;
  sessionsPerMonth?: number | null;
  domain?: string | null;
  startDate?: string | null;
};

const lbl = "label";

/**
 * Velden van een offerteregel. Zelfde logica als bij een afspraak: bij een nieuwe regel
 * volgen prijsvorm, periode en (bij sparringpartner) bedrag de soort dienst.
 */
export function QuoteLineFields({ value = {}, isNew = false, domains = [] }: { value?: QuoteLineValues; isNew?: boolean; domains?: string[] }) {
  const start = value.kind ?? "website";
  const [kind, setKind] = useState<ServiceKind>(start);
  const [pricing, setPricing] = useState<Pricing>(value.pricing ?? SERVICE_DEFAULTS[start].pricing);
  const [period, setPeriod] = useState<string>(value.period ?? SERVICE_DEFAULTS[start].period ?? "month");
  const [amount, setAmount] = useState<string>(centsToInput(value.amountCents ?? SERVICE_DEFAULTS[start].amountCents));

  function changeKind(k: ServiceKind) {
    setKind(k);
    if (!isNew) return;
    const def = SERVICE_DEFAULTS[k];
    setPricing(def.pricing);
    if (def.period) setPeriod(def.period);
    if (def.amountCents !== undefined && amount === "") setAmount(centsToInput(def.amountCents));
  }

  const amountLabel = pricing === "hourly" ? "Uurtarief (excl. btw)" : pricing === "one_off" ? "Bedrag (excl. btw)" : "Bedrag per periode (excl. btw)";
  const showDomain = kind === "website" || kind === "hosting" || kind === "maintenance";
  const listId = `domains-${isNew ? "new" : "edit"}-${value.domain ?? ""}`;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-4">
        <label className="block">
          <span className={lbl}>Soort dienst</span>
          <select name="kind" value={kind} onChange={(e) => changeKind(e.target.value as ServiceKind)} className="input w-full">
            {Object.entries(SERVICE_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="block md:col-span-3">
          <span className={lbl}>Omschrijving (optioneel)</span>
          <input name="description" defaultValue={value.description ?? ""} placeholder="Bijv. Website met webshop, 5 pagina's" className="input w-full" />
        </label>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
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
            <span className={lbl}>Sessies per maand</span>
            <input name="sessionsPerMonth" type="number" min={0} defaultValue={value.sessionsPerMonth ?? ""} className="input w-full" />
          </label>
        )}
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        {showDomain ? (
          <label className="block md:col-span-2">
            <span className={lbl}>Domein (optioneel)</span>
            <input name="domain" defaultValue={value.domain ?? ""} list={listId} placeholder="bijv. voorbeeld.nl" className="input w-full" />
            <datalist id={listId}>{domains.map((d) => <option key={d} value={d} />)}</datalist>
          </label>
        ) : (
          <input type="hidden" name="domain" value="" />
        )}
        <label className="block">
          <span className={lbl}>Start (leeg = bij akkoord)</span>
          <input type="date" name="startDate" defaultValue={value.startDate ?? ""} className="input w-full" />
        </label>
      </div>
      {isNew && pricing === "one_off" && kind === "website" && (
        <p className="text-xs text-steen">Bij akkoord: websiteproject en 2 termijnen van 50% (de eerste direct klaar om te factureren).</p>
      )}
    </div>
  );
}
