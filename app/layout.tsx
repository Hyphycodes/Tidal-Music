import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "Crate",
  description: "An owned, enriched, queryable database of my musical taste.",
};

export const viewport: Viewport = {
  themeColor: "#100c0a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">
        <Nav />
        <main className="mx-auto max-w-shell px-5 py-8">{children}</main>
      </body>
    </html>
  );
}
