import Link from "next/link";
import type { AgreementRow, InstallmentRow } from "@/lib/agreements";
import { formatDate } from "@/lib/dates";
import { AGREEMENT_STATUS, INSTALLMENT_STATUS, INSTALLMENT_TRIGGER, PERIOD_SHORT, type InstallmentStatus } from "@/lib/labels";
import { centsToInput, formatEuro } from "@/lib/money";
import {
  createAgreementAction,
  createInstallmentAction,
  deleteAgreementAction,
  deleteInstallmentAction,
  deliverAgreementAction,
  setAgreementStatusAction,
  setInstallmentStatusAction,
  updateAgreementAction,
  updateInstallmentAction,
} from "@/app/actions";
import { AgreementFields } from "./agreement-fields";

type Opt = { id: string; name: string };

const trash = "btn-ghost text-xs";

/** "€ 125,00 / mnd", "€ 85,00 / uur", "€ 2.400,00 eenmalig" */
export function priceText(a: Pick<AgreementRow, "pricing" | "amountCents" | "period">) {
  if (a.pricing === "hourly") return `${formatEuro(a.amountCents)} / uur`;
  if (a.pricing === "one_off") return `${formatEuro(a.amountCents)} eenmalig`;
  return `${formatEuro(a.amountCents)} / ${PERIOD_SHORT[a.period ?? "month"]}`;
}

function periodText(a: AgreementRow) {
  const parts = [];
  if (a.startDate) parts.push(`vanaf ${formatDate(a.startDate)}`);
  if (a.endDate) parts.push(`tot ${formatDate(a.endDate)}`);
  if (a.noticeMonths) parts.push(`opzegtermijn ${a.noticeMonths} mnd`);
  if (a.indexationPct) parts.push(`indexatie ${String(a.indexationPct).replace(".", ",")}%`);
  if (a.sessionsPerMonth) parts.push(`${a.sessionsPerMonth} sessies/mnd`);
  if (a.budgetCents) parts.push(`budget ${formatEuro(a.budgetCents)}`);
  return parts.join(" · ");
}

/* ---------------- Termijnen ---------------- */

/** De logische volgende stap voor een termijn. */
const NEXT: Partial<Record<InstallmentStatus, { to: InstallmentStatus; label: string }>> = {
  planned: { to: "ready", label: "Klaar om te factureren" },
  ready: { to: "sent", label: "Gefactureerd" },
  draft: { to: "sent", label: "Verzonden" },
  sent: { to: "paid", label: "Betaald" },
};

function statusDate(i: InstallmentRow) {
  if (i.status === "paid" && i.paidAt) return `betaald ${formatDate(i.paidAt)}`;
  if ((i.status === "sent" || i.status === "draft") && i.invoicedAt) return `gefactureerd ${formatDate(i.invoicedAt)}`;
  if (i.status === "ready" && i.readyAt) return `klaar sinds ${formatDate(i.readyAt)}`;
  if (i.dueDate) return formatDate(i.dueDate);
  return INSTALLMENT_TRIGGER[i.trigger].toLowerCase();
}

export function InstallmentRows({ rows, showClient = false, empty = "Geen termijnen." }: { rows: InstallmentRow[]; showClient?: boolean; empty?: string }) {
  if (rows.length === 0) return <p className="px-3 py-3 text-sm text-steen">{empty}</p>;
  return (
    <ul className="divide-y divide-lijn">
      {rows.map((i) => {
        const next = NEXT[i.status];
        return (
          <li key={i.id} className={`px-3 py-2 text-sm ${i.status === "ready" ? "border-l-[3px] border-l-nacht" : ""}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className={i.status === "paid" ? "text-steen" : "font-medium text-grafiet"}>{i.description}</p>
                <p className="text-xs text-steen">
                  {showClient && <><Link href={`/klanten/${i.clientId}`} className="hover:text-nacht">{i.clientName}</Link> · </>}
                  {INSTALLMENT_STATUS[i.status]} · {statusDate(i)}
                  {i.moneybirdInvoiceId ? ` · factuur ${i.moneybirdInvoiceId}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="tabular-nums font-bold text-nacht">{formatEuro(i.amountCents)}</span>
                {next && (
                  <form action={setInstallmentStatusAction.bind(null, i.id, next.to)}>
                    <button className="btn text-xs">{next.label}</button>
                  </form>
                )}
              </div>
            </div>
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-steen hover:text-nacht">Bewerken</summary>
              <form action={updateInstallmentAction.bind(null, i.id)} className="mt-2 grid gap-2 md:grid-cols-4">
                <input name="description" required defaultValue={i.description} className="input md:col-span-2" />
                <input name="amount" required inputMode="decimal" defaultValue={centsToInput(i.amountCents)} className="input" aria-label="Bedrag" />
                <select name="status" defaultValue={i.status} className="input">
                  {Object.entries(INSTALLMENT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <select name="trigger" defaultValue={i.trigger} className="input">
                  {Object.entries(INSTALLMENT_TRIGGER).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <label className="block"><span className="label">Datum</span><input type="date" name="dueDate" defaultValue={i.dueDate ?? ""} className="input w-full" /></label>
                <label className="block"><span className="label">Gefactureerd op</span><input type="date" name="invoicedAt" defaultValue={i.invoicedAt ?? ""} className="input w-full" /></label>
                <label className="block"><span className="label">Betaald op</span><input type="date" name="paidAt" defaultValue={i.paidAt ?? ""} className="input w-full" /></label>
                <input name="moneybirdInvoiceId" defaultValue={i.moneybirdInvoiceId ?? ""} placeholder="Moneybird-factuurnummer" className="input md:col-span-2" />
                <div className="md:col-span-2"><button className="btn">Opslaan</button></div>
              </form>
              <form action={deleteInstallmentAction.bind(null, i.id)} className="mt-1">
                <button className={trash}>Termijn verwijderen</button>
              </form>
            </details>
          </li>
        );
      })}
    </ul>
  );
}

export function AddInstallmentForm({ clientId, agreements }: { clientId: string; agreements: Opt[] }) {
  return (
    <details className="card p-4">
      <summary className="cursor-pointer text-sm font-medium">Termijn toevoegen</summary>
      <form action={createInstallmentAction.bind(null, clientId)} className="mt-3 grid gap-2 md:grid-cols-4">
        <input name="description" required placeholder="Omschrijving, bijv. Extra werk huisstijl" className="input md:col-span-2" />
        <input name="amount" required inputMode="decimal" placeholder="Bedrag excl. btw" className="input" />
        <select name="agreementId" defaultValue="" className="input">
          <option value="">Geen afspraak</option>
          {agreements.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select name="trigger" defaultValue="date" className="input">
          {Object.entries(INSTALLMENT_TRIGGER).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input type="date" name="dueDate" className="input" aria-label="Datum" />
        <div><button className="btn">Toevoegen</button></div>
      </form>
    </details>
  );
}

/* ---------------- Afspraken ---------------- */

export function AgreementCard({ a, installments, websites, projects, showClient = false }: { a: AgreementRow; installments: InstallmentRow[]; websites: Opt[]; projects: Opt[]; showClient?: boolean }) {
  const deliverable = a.pricing === "one_off" && a.status === "active" && installments.some((i) => i.trigger === "delivery" && i.status === "planned");
  const inactive = a.status === "ended" || a.status === "draft";
  return (
    <div className={`card p-4 ${a.running ? "border-l-[3px] border-l-nacht" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`font-bold ${inactive ? "text-steen" : "text-nacht"}`}>{a.label}</p>
          {showClient && <Link href={`/klanten/${a.clientId}`} className="block text-sm text-steen hover:text-nacht">{a.clientName}</Link>}
          <p className="text-sm text-grafiet tabular-nums">
            {priceText(a)}
            {a.pricing === "recurring" && a.period !== "month" && <span className="text-steen"> · {formatEuro(Math.round(a.monthlyCents))} / mnd</span>}
          </p>
          {periodText(a) && <p className="text-xs text-steen">{periodText(a)}</p>}
          {((a.title && a.domain) || a.projectName) && (
            <p className="text-xs text-steen">
              {[a.title ? a.domain : null, a.projectName && (a.projectId ? <Link key="p" href={`/projecten/${a.projectId}`} className="hover:text-nacht">project: {a.projectName}</Link> : null)]
                .filter(Boolean)
                .map((x, n) => <span key={n}>{n > 0 ? " · " : ""}{x}</span>)}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="chip">{AGREEMENT_STATUS[a.status]}</span>
          {a.status === "draft" && (
            <form action={setAgreementStatusAction.bind(null, a.id, "active")}><button className="btn text-xs">Akkoord</button></form>
          )}
          {deliverable && (
            <form action={deliverAgreementAction.bind(null, a.id)}><button className="btn text-xs">Opgeleverd</button></form>
          )}
        </div>
      </div>
      {a.notes && <p className="mt-2 whitespace-pre-line text-sm text-steen">{a.notes}</p>}

      {installments.length > 0 && (
        <div className="mt-3 rounded-sm border border-lijn">
          <InstallmentRows rows={installments} />
        </div>
      )}

      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-steen hover:text-nacht">Bewerken</summary>
        <form action={updateAgreementAction.bind(null, a.id)} className="mt-2 space-y-2">
          <AgreementFields value={a} websites={websites} projects={projects} />
          <button className="btn">Opslaan</button>
        </form>
        <div className="mt-2 flex flex-wrap gap-2">
          {a.status === "active" && a.pricing !== "one_off" && (
            <form action={setAgreementStatusAction.bind(null, a.id, "cancelled")}>
              <button className={trash}>Opzeggen (einddatum volgt uit de opzegtermijn als die leeg is)</button>
            </form>
          )}
          {a.status !== "ended" && (
            <form action={setAgreementStatusAction.bind(null, a.id, "ended")}><button className={trash}>Beëindigen</button></form>
          )}
          <form action={deleteAgreementAction.bind(null, a.id)}>
            <button className={trash}>Afspraak verwijderen (gefactureerde termijnen blijven bewaard)</button>
          </form>
        </div>
      </details>
    </div>
  );
}

export function NewAgreementForm({ clientId, websites, projects, clients }: { clientId?: string; websites: Opt[]; projects: Opt[]; clients?: Opt[] }) {
  return (
    <details className="card p-4">
      <summary className="cursor-pointer text-sm font-medium">Afspraak toevoegen</summary>
      <form action={createAgreementAction.bind(null, clientId ?? null)} className="mt-3 space-y-3">
        <AgreementFields isNew websites={websites} projects={projects} clients={clients} />
        <button className="btn-primary">Toevoegen</button>
      </form>
    </details>
  );
}

/** Afspraken en termijnen in het klantdossier. */
export function ClientAgreements({ clientId, agreements, installments, mrrCents, websites, projects }: {
  clientId: string;
  agreements: AgreementRow[];
  installments: InstallmentRow[];
  mrrCents: number;
  websites: Opt[];
  projects: Opt[];
}) {
  const loose = installments.filter((i) => !i.agreementId);
  const open = installments.filter((i) => i.status !== "paid");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-6 text-sm">
        <p><span className="text-steen">MRR </span><span className="font-bold tabular-nums text-nacht">{formatEuro(mrrCents)}</span></p>
        <p><span className="text-steen">Jaaromzet vast </span><span className="font-bold tabular-nums text-nacht">{formatEuro(mrrCents * 12)}</span></p>
        <p><span className="text-steen">Openstaande termijnen </span><span className="font-bold tabular-nums text-nacht">{formatEuro(open.reduce((s, i) => s + i.amountCents, 0))}</span></p>
      </div>
      {agreements.length === 0 && <p className="text-sm text-steen">Nog geen afspraken.</p>}
      <div className="grid gap-3">
        {agreements.map((a) => (
          <AgreementCard key={a.id} a={a} installments={installments.filter((i) => i.agreementId === a.id)} websites={websites} projects={projects} />
        ))}
      </div>
      {loose.length > 0 && (
        <div className="card">
          <p className="label px-3 pt-3">Losse termijnen</p>
          <InstallmentRows rows={loose} />
        </div>
      )}
      <NewAgreementForm clientId={clientId} websites={websites} projects={projects} />
      <AddInstallmentForm clientId={clientId} agreements={agreements.map((a) => ({ id: a.id, name: a.label }))} />
    </div>
  );
}
