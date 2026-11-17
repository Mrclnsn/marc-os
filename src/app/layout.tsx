import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Marc OS",
  description: "Taken, projecten, klanten en notities op één plek",
  appleWebApp: { capable: true, title: "Marc OS", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#1f4e79",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
