import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = { title: "REMNANT | Hell Let Loose Clan", description: "Official site of REMNANT, a mature EU Hell Let Loose clan. Events, matches and news." };
export const viewport: Viewport = { themeColor: "#0c0c0e" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
