"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Vandaag", icon: "☀" },
  { href: "/inbox", label: "Inbox", icon: "✎" },
  { href: "/taken", label: "Taken", icon: "✓" },
  { href: "/projecten", label: "Projecten", icon: "◫" },
  { href: "/klanten", label: "Klanten", icon: "◎" },
  { href: "/notities", label: "Notities", icon: "≡" },
  { href: "/reviews", label: "Reviews", icon: "↺" },
];

export function Nav({ inbox }: { inbox: number }) {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <>
      {/* Desktop: zijbalk */}
      <nav className="hidden md:flex fixed inset-y-0 left-0 w-52 flex-col gap-1 border-r border-line bg-surface p-3">
        <div className="px-2 py-3 text-base font-semibold">Marc OS</div>
        {items.map((i) => (
          <Link
            key={i.href}
            href={i.href}
            className={`flex items-center justify-between rounded-md px-2 py-1.5 text-sm ${
              active(i.href) ? "bg-accent-soft text-accent font-medium" : "text-fg hover:bg-bg"
            }`}
          >
            <span className="flex items-center gap-2">
              <span className="w-4 text-center text-muted">{i.icon}</span>
              {i.label}
            </span>
            {i.href === "/inbox" && inbox > 0 && <span className="chip">{inbox}</span>}
          </Link>
        ))}
      </nav>
      {/* Mobiel: onderbalk */}
      <nav className="md:hidden fixed inset-x-0 bottom-0 z-10 grid grid-cols-5 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]">
        {items.slice(0, 5).map((i) => (
          <Link
            key={i.href}
            href={i.href}
            className={`flex flex-col items-center py-2 text-[11px] ${active(i.href) ? "text-accent" : "text-muted"}`}
          >
            <span className="text-base leading-none">{i.icon}</span>
            {i.label}
            {i.href === "/inbox" && inbox > 0 ? ` (${inbox})` : ""}
          </Link>
        ))}
      </nav>
    </>
  );
}
