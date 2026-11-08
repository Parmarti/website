import type { Metadata } from "next";
import "./globals.css";
import { brand } from "@/lib/brand";
import { appUrl } from "@/lib/env";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl()),
  title: { default: `${brand.name}: unified social media API`, template: `%s · ${brand.name}` },
  description: brand.description,
  openGraph: { title: `${brand.name}: ${brand.tagline}`, description: brand.description, type: "website" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
