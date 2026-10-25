import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = { title: "Remnant Dashboard", description: "Remnant Clan Management" };
export const viewport: Viewport = { themeColor: "#0c0c0e" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
