"use client";

import { usePathname } from "next/navigation";

/** De cockpit (Vandaag) gebruikt de volle breedte; de andere pagina's blijven leesbaar smal. */
export function MainFrame({ timer, children }: { timer: boolean; children: React.ReactNode }) {
  const wide = usePathname() === "/";
  return (
    <main className={`mx-auto px-5 pt-8 md:px-12 md:pb-16 md:pt-12 ${wide ? "max-w-[1760px]" : "max-w-6xl"} ${timer ? "pb-44" : "pb-28"}`}>
      {children}
    </main>
  );
}
