import Link from "next/link";

/** Tabbladen van Planning: Dag, Week, Dagritme, Gewoontes. */
export function PlanningTabs({ active, date }: { active: "dag" | "week" | "dagritme" | "gewoontes"; date?: string }) {
  const q = date ? `&datum=${date}` : "";
  const tabs = [
    { key: "dag", label: "Dag", href: `/planning?weergave=dag${q}` },
    { key: "week", label: "Week", href: `/planning?weergave=week${q}` },
    { key: "dagritme", label: "Dagritme", href: "/planning/dagritme" },
    { key: "gewoontes", label: "Gewoontes", href: "/planning/gewoontes" },
  ] as const;
  return (
    <nav className="flex gap-4" aria-label="Planning">
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} className={active === t.key ? "tab-active" : "tab"}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
