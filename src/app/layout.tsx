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
    <html lang="nl" className="h-full">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
