import type { Metadata, Viewport } from "next";
import "@fontsource/carlito/latin-400.css";
import "@fontsource/carlito/latin-700.css";
import "./globals.css";
import { cookies } from "next/headers";
import { THEME_COOKIE, parseTheme } from "@/lib/modules";

export const metadata: Metadata = {
  title: "Marc OS",
  description: "Taken, projecten, klanten en notities op één plek",
  appleWebApp: { capable: true, title: "Marc OS", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#16112b",
  colorScheme: "light dark",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Thema (licht, donker of systeem) staat in een cookie, zodat de juiste kleuren direct bij de eerste weergave kloppen
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    // suppressHydrationWarning: browserextensies (vertalen, lezen) passen attributen op html/body aan
    // vóór React laadt. Dit onderdrukt alleen die attribuutverschillen op deze twee elementen.
    <html lang="nl" className={`h-full ${theme}`} suppressHydrationWarning>
      <body className="min-h-full" suppressHydrationWarning>{children}</body>
    </html>
  );
}
