"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Beeldmerk } from "./brand";
import type { ModuleKey, Modules } from "@/lib/modules";

type Item = { href: string; label: string; module?: ModuleKey };

const items: Item[] = [
  { href: "/", label: "Vandaag" },
  { href: "/planning", label: "Planning" },
  { href: "/inbox", label: "Inbox" },
  { href: "/taken", label: "Taken" },
  { href: "/projecten", label: "Projecten" },
  { href: "/klanten", label: "Klanten" },
  { href: "/pipeline", label: "Pipeline", module: "pipeline" },
  { href: "/websites", label: "Websites", module: "websites" },
  { href: "/uren", label: "Uren", module: "uren" },
  { href: "/afspraken", label: "Afspraken", module: "afspraken" },
  { href: "/aangiftes", label: "Aangiftes", module: "aangiftes" },
  { href: "/notities", label: "Notities" },
  { href: "/reviews", label: "Reviews" },
];

/** Vijf vaste plekken in de onderbalk op de telefoon; de rest staat in de kop. */
const BOTTOM = ["/", "/planning", "/inbox", "/taken", "/projecten"];

export function Nav({ inbox, footer, modules }: { inbox: number; footer: React.ReactNode; modules: Modules }) {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const visible = items.filter((i) => !i.module || modules[i.module]);
  const top = [...visible.filter((i) => !BOTTOM.includes(i.href)), { href: "/instellingen", label: "Instellingen" }];

  return (
    <>
      {/* Desktop: Nacht-zijbalk */}
      <nav className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-white/5 bg-zijbalk text-white md:flex">
        <Link href="/" className="flex items-center gap-3 px-6 pb-8 pt-7">
          <Beeldmerk className="h-7 w-auto" color="#fff" strokeWidth={22} />
          <span className="leading-tight">
            <span className="block text-lg font-bold tracking-tight">Marc OS</span>
            <span className="block text-[10px] uppercase tracking-[0.2em] text-white/50">Marc Lonsain Consultancy</span>
          </span>
        </Link>
        <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3">
          {visible.map((i) => (
            <NavLink key={i.href} item={i} on={active(i.href)} badge={i.href === "/inbox" ? inbox : 0} />
          ))}
          <div className="mt-auto pb-2 pt-4">
            <NavLink item={{ href: "/instellingen", label: "Instellingen" }} on={active("/instellingen")} badge={0} />
          </div>
        </div>
        <div className="border-t border-white/10 px-6 py-4">{footer}</div>
      </nav>

      {/* Mobiel: compacte kop en onderbalk */}
      <div className="sticky top-0 z-10 flex items-center justify-between bg-zijbalk px-4 py-3 text-white md:hidden">
        <Link href="/" className="flex shrink-0 items-center gap-2 pr-4">
          <Beeldmerk className="h-5 w-auto" color="#fff" strokeWidth={22} />
          <span className="whitespace-nowrap font-bold">Marc OS</span>
        </Link>
        <div className="-mr-4 flex gap-4 overflow-x-auto pr-4 text-sm text-white/70">
          {top.map((i) => (
            <Link key={i.href} href={i.href} className={`whitespace-nowrap ${active(i.href) ? "font-bold text-white" : ""}`}>
              {i.label}
            </Link>
          ))}
        </div>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-5 bg-zijbalk pb-[env(safe-area-inset-bottom)] text-white md:hidden">
        {items
          .filter((i) => BOTTOM.includes(i.href))
          .map((i) => {
            const on = active(i.href);
            return (
              <Link key={i.href} href={i.href} className={`relative py-3 text-center text-[13px] ${on ? "font-bold text-white" : "text-white/60"}`}>
                {on && <span className="absolute inset-x-4 top-0 h-[3px] bg-white" />}
                {i.label}
                {i.href === "/inbox" && inbox > 0 ? <span className="ml-1 rounded-sm bg-white px-1 text-[11px] font-bold text-zijbalk">{inbox}</span> : null}
              </Link>
            );
          })}
      </nav>
    </>
  );
}

function NavLink({ item, on, badge }: { item: Item; on: boolean; badge: number }) {
  return (
    <Link
      href={item.href}
      className={`relative flex items-center justify-between rounded-sm px-3 py-2 text-[15px] transition-colors ${
        on ? "bg-white/10 font-bold text-white" : "text-white/65 hover:bg-white/5 hover:text-white"
      }`}
    >
      {on && <span className="absolute inset-y-1.5 left-0 w-[3px] bg-white" />}
      {item.label}
      {badge > 0 && <span className="min-w-5 rounded-sm bg-white px-1.5 text-center text-xs font-bold text-zijbalk">{badge}</span>}
    </Link>
  );
}
