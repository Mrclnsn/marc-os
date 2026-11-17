import Link from "next/link";
import { PageHeader, SectionTitle } from "@/components/brand";
import { WebsiteCard } from "@/components/client-parts";
import { expiringDomains, listWebsites } from "@/lib/data";
import { DOMAIN_WARNING_DAYS } from "@/lib/labels";

export default async function WebsitesPage({ searchParams }: { searchParams: Promise<{ dienst?: string }> }) {
  const { dienst } = await searchParams;
  const [all, expiring] = await Promise.all([listWebsites(), expiringDomains(DOMAIN_WARNING_DAYS)]);
  const rows = all.filter(({ website: w }) =>
    dienst === "hosting" ? w.hostingByUs : dienst === "beheer" ? w.maintenanceByUs : true,
  );
  const tabs = [
    { key: undefined, label: "Alle" },
    { key: "hosting", label: "Hosting afgenomen" },
    { key: "beheer", label: "Beheer afgenomen" },
  ];

  return (
    <div className="space-y-10">
      <PageHeader eyebrow="Zakelijk" title="Websites">
        {tabs.map((t) => (
          <Link key={t.label} href={t.key ? `/websites?dienst=${t.key}` : "/websites"} className={dienst === t.key ? "tab-active" : "tab"}>
            {t.label}
          </Link>
        ))}
      </PageHeader>

      {expiring.length > 0 && (
        <section>
          <SectionTitle>Domeinen die binnen {DOMAIN_WARNING_DAYS} dagen verlopen</SectionTitle>
          <div className="grid gap-3 md:grid-cols-2">
            {expiring.map(({ website, clientName }) => (
              <WebsiteCard key={website.id} site={website} clientName={clientName} />
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionTitle aside={<span className="text-xs text-steen">{rows.length}</span>}>Overzicht</SectionTitle>
        {rows.length === 0 ? (
          <p className="text-sm text-steen">Nog geen websites. Voeg ze toe via de klantpagina.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {rows.map(({ website, clientName }) => (
              <WebsiteCard key={website.id} site={website} clientName={clientName} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
