import type { Metadata, Viewport } from "next";
import "@fontsource/carlito/latin-400.css";
import "@fontsource/carlito/latin-700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Marc OS",
  description: "Taken, projecten, klanten en notities op één plek",
  appleWebApp: { capable: true, title: "Marc OS", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#16112b",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: browserextensies (vertalen, lezen) passen attributen op html/body aan
    // vóór React laadt. Dit onderdrukt alleen die attribuutverschillen op deze twee elementen.
    <html lang="nl" className="h-full" suppressHydrationWarning>
      <body className="min-h-full" suppressHydrationWarning>{children}</body>
    </html>
  );
}
