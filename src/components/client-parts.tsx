import Link from "next/link";
import type { Client, ClientContact, ClientDocument, Website } from "@/db/schema";
import { daysBetween, formatDate, today } from "@/lib/dates";
import { CLIENT_SOURCES, DOCUMENT_KIND, DOMAIN_WARNING_DAYS, DPA_STATUS, LEGAL_FORMS } from "@/lib/labels";
import {
  createContactAction,
  createDocumentAction,
  createWebsiteAction,
  deleteContactAction,
  deleteDocumentAction,
  deleteWebsiteAction,
  makePrimaryContactAction,
  updateClientAction,
  updateContactAction,
  updateWebsiteAction,
} from "@/app/actions";
import { Checkbox, ClientStatusSelect, DocumentKindSelect, DpaStatusSelect, Field, SuggestInput } from "./forms";

/* ---------------- Hulpjes ---------------- */

/** Eén rij label + waarde; lege waarden tonen een streepje. */
function Row({ label, children }: { label: string; children?: React.ReactNode }) {
  const empty = children == null || children === "" || children === false;
  return (
    <div className="grid grid-cols-[130px_1fr] gap-3 py-1.5 text-sm">
      <dt className="text-steen">{label}</dt>
      <dd className={empty ? "text-steen" : "break-words text-grafiet"}>{empty ? "–" : children}</dd>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="label mb-1">{title}</p>
      <dl className="divide-y divide-lijn">{children}</dl>
    </div>
  );
}

function addressLines(street: string | null, postcode: string | null, city: string | null, country: string | null) {
  const place = [postcode, city].filter(Boolean).join("  ");
  const lines = [street, place, country && country !== "NL" ? country : null].filter(Boolean);
  return lines.length ? lines.join("\n") : null;
}

/** Status van een domein ten opzichte van vandaag. */
export function domainState(expires: string | null): { label: string; warn: boolean } | null {
  if (!expires) return null;
  const days = daysBetween(today(), expires);
  if (days < 0) return { label: `verlopen op ${formatDate(expires)}`, warn: true };
  if (days === 0) return { label: "verloopt vandaag", warn: true };
  if (days <= DOMAIN_WARNING_DAYS) return { label: `verloopt over ${days} ${days === 1 ? "dag" : "dagen"}`, warn: true };
  return { label: `verloopt ${formatDate(expires)}`, warn: false };
}

const trash = "btn-ghost text-xs";

/* ---------------- Klantgegevens ---------------- */

export function ClientDetails({ client }: { client: Client }) {
  const visit = addressLines(client.address, client.postcode, client.city, client.country);
  const invoice = addressLines(client.invoiceAddress, client.invoicePostcode, client.invoiceCity, client.invoiceCountry);
  return (
    <div className="card grid gap-6 p-4 md:grid-cols-2">
      <Group title="Basis">
        <Row label="Rechtsvorm">{client.legalForm}</Row>
        <Row label="Klant sinds">{formatDate(client.clientSince)}</Row>
        <Row label="Bron">{client.source}</Row>
      </Group>
      <Group title="Registratie">
        <Row label="KvK-nummer">{client.kvkNumber}</Row>
        <Row label="Btw-nummer">{client.vatNumber}</Row>
      </Group>
      <Group title="Adres">
        <Row label="Bezoekadres">{visit && <span className="whitespace-pre-line">{visit}</span>}</Row>
        <Row label="Factuuradres">{invoice ? <span className="whitespace-pre-line">{invoice}</span> : visit ? "Zelfde als bezoekadres" : null}</Row>
      </Group>
      <Group title="Facturatie">
        <Row label="Factuur-e-mail">{client.invoiceEmail && <a href={`mailto:${client.invoiceEmail}`} className="underline decoration-lijn underline-offset-2 hover:decoration-nacht">{client.invoiceEmail}</a>}</Row>
        <Row label="Betaaltermijn">{`${client.paymentTermDays} dagen`}</Row>
        <Row label="Moneybird-ID">{client.moneybirdContactId}</Row>
      </Group>
      <Group title="Compliance">
        <Row label="Verwerkersovk.">
          {DPA_STATUS[client.dpaStatus]}
          {client.dpaDate ? ` · ${formatDate(client.dpaDate)}` : ""}
        </Row>
        <Row label="Persoonsgegevens">{client.personalData && <span className="whitespace-pre-line">{client.personalData}</span>}</Row>
      </Group>
      <Group title="Overig">
        <Row label="Wachtwoorden">{client.vaultRef}</Row>
        <Row label="Tags">{client.tags.length > 0 && client.tags.join(", ")}</Row>
      </Group>
    </div>
  );
}

export function ClientEditForm({ client }: { client: Client }) {
  return (
    <form action={updateClientAction.bind(null, client.id)} className="mt-4 space-y-6">
      <fieldset className="grid gap-3 md:grid-cols-3">
        <legend className="h2 mb-2">Basis</legend>
        <Field label="Bedrijfsnaam"><input name="name" defaultValue={client.name} required className="input w-full" /></Field>
        <Field label="Rechtsvorm"><SuggestInput name="legalForm" value={client.legalForm} options={LEGAL_FORMS} listId="legal-forms" /></Field>
        <Field label="Status"><ClientStatusSelect value={client.status} /></Field>
        <Field label="Klant sinds"><input type="date" name="clientSince" defaultValue={client.clientSince ?? ""} className="input w-full" /></Field>
        <Field label="Bron (hoe binnengekomen)"><SuggestInput name="source" value={client.source} options={CLIENT_SOURCES} listId="client-sources" /></Field>
        <Field label="Tags (komma's)"><input name="tags" defaultValue={client.tags.join(", ")} placeholder="boekhouding, website" className="input w-full" /></Field>
      </fieldset>

      <fieldset className="grid gap-3 md:grid-cols-3">
        <legend className="h2 mb-2">Registratie</legend>
        <Field label="KvK-nummer"><input name="kvkNumber" defaultValue={client.kvkNumber ?? ""} inputMode="numeric" className="input w-full" /></Field>
        <Field label="Btw-nummer"><input name="vatNumber" defaultValue={client.vatNumber ?? ""} placeholder="NL000000000B01" className="input w-full" /></Field>
      </fieldset>

      <fieldset className="grid gap-3 md:grid-cols-[2fr_1fr_1.5fr_0.7fr]">
        <legend className="h2 mb-2">Bezoekadres</legend>
        <Field label="Straat en huisnummer"><input name="address" defaultValue={client.address ?? ""} className="input w-full" /></Field>
        <Field label="Postcode"><input name="postcode" defaultValue={client.postcode ?? ""} className="input w-full" /></Field>
        <Field label="Plaats"><input name="city" defaultValue={client.city ?? ""} className="input w-full" /></Field>
        <Field label="Land"><input name="country" defaultValue={client.country} maxLength={2} className="input w-full uppercase" /></Field>
      </fieldset>

      <fieldset className="grid gap-3 md:grid-cols-[2fr_1fr_1.5fr_0.7fr]">
        <legend className="h2 mb-2">Factuuradres <span className="text-sm font-normal text-steen">alleen als het afwijkt</span></legend>
        <Field label="Straat en huisnummer"><input name="invoiceAddress" defaultValue={client.invoiceAddress ?? ""} className="input w-full" /></Field>
        <Field label="Postcode"><input name="invoicePostcode" defaultValue={client.invoicePostcode ?? ""} className="input w-full" /></Field>
        <Field label="Plaats"><input name="invoiceCity" defaultValue={client.invoiceCity ?? ""} className="input w-full" /></Field>
        <Field label="Land"><input name="invoiceCountry" defaultValue={client.invoiceCountry ?? ""} maxLength={2} className="input w-full uppercase" /></Field>
      </fieldset>

      <fieldset className="grid gap-3 md:grid-cols-3">
        <legend className="h2 mb-2">Facturatie</legend>
        <Field label="Factuur-e-mail"><input type="email" name="invoiceEmail" defaultValue={client.invoiceEmail ?? ""} className="input w-full" /></Field>
        <Field label="Betaaltermijn (dagen)"><input type="number" min={0} max={365} name="paymentTermDays" defaultValue={client.paymentTermDays} className="input w-full" /></Field>
        <Field label="Moneybird-contact-ID"><input name="moneybirdContactId" defaultValue={client.moneybirdContactId ?? ""} className="input w-full" /></Field>
      </fieldset>

      <fieldset className="grid gap-3 md:grid-cols-3">
        <legend className="h2 mb-2">Compliance</legend>
        <Field label="Verwerkersovereenkomst"><DpaStatusSelect value={client.dpaStatus} /></Field>
        <Field label="Datum (verstuurd of getekend)"><input type="date" name="dpaDate" defaultValue={client.dpaDate ?? ""} className="input w-full" /></Field>
        <Field label="Verwerkte persoonsgegevens" className="md:col-span-3">
          <textarea name="personalData" rows={2} defaultValue={client.personalData ?? ""} placeholder="Bijv. NAW en e-mail van leden, contactformulieren website" className="input w-full" />
        </Field>
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="h2 mb-2">Overig</legend>
        <Field label="Verwijzing wachtwoordmanager (geen wachtwoorden hier)">
          <input name="vaultRef" defaultValue={client.vaultRef ?? ""} placeholder="Bijv. 1Password, kluis Klanten, item SVWW" className="input w-full" />
        </Field>
        <Field label="Vaste informatie (pakket, afspraken, bijzonderheden)">
          <textarea name="info" rows={5} defaultValue={client.info ?? ""} className="input w-full" />
        </Field>
      </fieldset>

      <button className="btn-primary">Opslaan</button>
    </form>
  );
}

/* ---------------- Contactpersonen ---------------- */

function ContactFields({ contact }: { contact?: ClientContact }) {
  return (
    <div className="grid gap-2 md:grid-cols-4">
      <input name="name" required defaultValue={contact?.name ?? ""} placeholder="Naam" className="input" />
      <input name="role" defaultValue={contact?.role ?? ""} placeholder="Rol (eigenaar, penningmeester...)" className="input" />
      <input name="email" type="email" defaultValue={contact?.email ?? ""} placeholder="E-mail" className="input" />
      <input name="phone" type="tel" defaultValue={contact?.phone ?? ""} placeholder="Telefoon" className="input" />
    </div>
  );
}

export function ContactList({ clientId, contacts }: { clientId: string; contacts: ClientContact[] }) {
  return (
    <div className="space-y-3">
      {contacts.length === 0 && <p className="text-sm text-steen">Nog geen contactpersonen.</p>}
      <div className="grid gap-3 md:grid-cols-2">
        {contacts.map((c) => (
          <div key={c.id} className={`card p-4 ${c.isPrimary ? "border-l-[3px] border-l-nacht" : ""}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-bold text-nacht">{c.name}</p>
                {c.role && <p className="text-sm text-steen">{c.role}</p>}
              </div>
              {c.isPrimary ? (
                <span className="chip">Primair</span>
              ) : (
                <form action={makePrimaryContactAction.bind(null, c.id)}>
                  <button className="btn-ghost text-xs">Maak primair</button>
                </form>
              )}
            </div>
            <div className="mt-2 space-y-0.5 text-sm">
              {c.email && <a href={`mailto:${c.email}`} className="block truncate hover:text-nacht">{c.email}</a>}
              {c.phone && <a href={`tel:${c.phone.replace(/\s/g, "")}`} className="block hover:text-nacht">{c.phone}</a>}
              {c.notes && <p className="whitespace-pre-line pt-1 text-steen">{c.notes}</p>}
            </div>
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-steen hover:text-nacht">Bewerken</summary>
              <form action={updateContactAction.bind(null, c.id)} className="mt-2 space-y-2">
                <ContactFields contact={c} />
                <textarea name="notes" rows={2} defaultValue={c.notes ?? ""} placeholder="Notitie (bereikbaarheid, voorkeur...)" className="input w-full" />
                <div className="flex justify-between">
                  <button className="btn">Opslaan</button>
                </div>
              </form>
              <form action={deleteContactAction.bind(null, c.id)} className="mt-1">
                <button className={trash}>Contactpersoon verwijderen</button>
              </form>
            </details>
          </div>
        ))}
      </div>
      <form action={createContactAction.bind(null, clientId)} className="space-y-2">
        <ContactFields />
        <div className="flex items-center gap-4">
          <input type="hidden" name="isPrimaryField" value="1" />
          <Checkbox name="isPrimary" label="Primaire contactpersoon" checked={contacts.length === 0} />
          <button className="btn">Contactpersoon toevoegen</button>
        </div>
      </form>
    </div>
  );
}

/* ---------------- Websites ---------------- */

function WebsiteFields({ site }: { site?: Website }) {
  return (
    <div className="space-y-2">
      <div className="grid gap-2 md:grid-cols-3">
        <Field label="Domein"><input name="domain" required defaultValue={site?.domain ?? ""} placeholder="voorbeeld.nl" className="input w-full" /></Field>
        <Field label="Registrar"><input name="registrar" defaultValue={site?.registrar ?? ""} placeholder="Hostinger, TransIP..." className="input w-full" /></Field>
        <Field label="Domein verloopt"><input type="date" name="domainExpiresAt" defaultValue={site?.domainExpiresAt ?? ""} className="input w-full" /></Field>
        <Field label="Hostinglocatie"><input name="hostingLocation" defaultValue={site?.hostingLocation ?? ""} placeholder="Hostinger, VPS, klant zelf..." className="input w-full" /></Field>
        <Field label="CMS"><input name="cms" defaultValue={site?.cms ?? ""} placeholder="WordPress, Shopify..." className="input w-full" /></Field>
        <Field label="Livegang"><input type="date" name="liveDate" defaultValue={site?.liveDate ?? ""} className="input w-full" /></Field>
      </div>
      <div className="flex flex-wrap gap-5">
        <input type="hidden" name="servicesField" value="1" />
        <Checkbox name="hostingByUs" label="Hosting afgenomen" checked={site?.hostingByUs} />
        <Checkbox name="maintenanceByUs" label="Beheer afgenomen" checked={site?.maintenanceByUs} />
      </div>
      <textarea name="notes" rows={2} defaultValue={site?.notes ?? ""} placeholder="Notities (thema, plug-ins, bijzonderheden)" className="input w-full" />
    </div>
  );
}

export function WebsiteCard({ site, clientName }: { site: Website; clientName?: string }) {
  const state = domainState(site.domainExpiresAt);
  const meta = [site.cms, site.hostingLocation && `hosting: ${site.hostingLocation}`, site.registrar && `registrar: ${site.registrar}`].filter(Boolean);
  return (
    <div className={`card p-4 ${state?.warn ? "border-l-[3px] border-l-nacht" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <a href={`https://${site.domain}`} target="_blank" rel="noreferrer" className="font-bold text-nacht hover:underline">{site.domain}</a>
          {clientName && <Link href={`/klanten/${site.clientId}`} className="block text-sm text-steen hover:text-nacht">{clientName}</Link>}
          {meta.length > 0 && <p className="text-sm text-steen">{meta.join(" · ")}</p>}
        </div>
        <div className="flex flex-wrap gap-1">
          {site.hostingByUs && <span className="chip">Hosting</span>}
          {site.maintenanceByUs && <span className="chip">Beheer</span>}
        </div>
      </div>
      <p className="mt-2 text-xs text-steen">
        {state ? <span className={state.warn ? "font-bold text-nacht" : ""}>Domein {state.label}</span> : "Verloopdatum domein onbekend"}
        {site.liveDate ? ` · live sinds ${formatDate(site.liveDate)}` : ""}
      </p>
      {site.notes && <p className="mt-2 whitespace-pre-line text-sm text-steen">{site.notes}</p>}
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-steen hover:text-nacht">Bewerken</summary>
        <form action={updateWebsiteAction.bind(null, site.id)} className="mt-2 space-y-2">
          <WebsiteFields site={site} />
          <button className="btn">Opslaan</button>
        </form>
        <form action={deleteWebsiteAction.bind(null, site.id)} className="mt-1">
          <button className={trash}>Website verwijderen</button>
        </form>
      </details>
    </div>
  );
}

export function WebsiteList({ clientId, sites }: { clientId: string; sites: Website[] }) {
  return (
    <div className="space-y-3">
      {sites.length === 0 && <p className="text-sm text-steen">Nog geen websites.</p>}
      <div className="grid gap-3 md:grid-cols-2">
        {sites.map((w) => (
          <WebsiteCard key={w.id} site={w} />
        ))}
      </div>
      <details className="card p-4">
        <summary className="cursor-pointer text-sm font-medium">Website toevoegen</summary>
        <form action={createWebsiteAction.bind(null, clientId)} className="mt-3 space-y-2">
          <WebsiteFields />
          <button className="btn">Toevoegen</button>
        </form>
      </details>
    </div>
  );
}

/* ---------------- Documenten ---------------- */

export function DocumentList({ clientId, documents }: { clientId: string; documents: ClientDocument[] }) {
  return (
    <div className="space-y-2">
      <div className="card divide-y divide-lijn">
        {documents.length === 0 && <p className="px-3 py-3 text-sm text-steen">Nog geen documenten.</p>}
        {documents.map((d) => (
          <div key={d.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <div className="min-w-0">
              {d.url ? (
                <a href={d.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">{d.title}</a>
              ) : (
                <span className="font-medium">{d.title}</span>
              )}
              <span className="ml-2 text-xs text-steen">
                {DOCUMENT_KIND[d.kind]}
                {d.docDate ? ` · ${formatDate(d.docDate)}` : ""}
              </span>
            </div>
            <form action={deleteDocumentAction.bind(null, d.id)}>
              <button className={trash} aria-label={`${d.title} verwijderen`}>Verwijderen</button>
            </form>
          </div>
        ))}
      </div>
      <form action={createDocumentAction.bind(null, clientId)} className="grid gap-2 md:grid-cols-[auto_1.5fr_2fr_auto_auto]">
        <DocumentKindSelect />
        <input name="title" required placeholder="Titel, bijv. Offerte website 2026" className="input" />
        <input name="url" type="url" placeholder="Link (OneDrive, Drive, Moneybird)" className="input" />
        <input name="docDate" type="date" className="input" />
        <button className="btn">Toevoegen</button>
      </form>
    </div>
  );
}
