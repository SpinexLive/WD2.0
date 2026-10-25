import type { Metadata } from "next";
import { Landing } from "@/components/Landing";
import { getSession } from "@/lib/session";
import { getLandingData } from "@/server/services/landing";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "REMNANT | Hell Let Loose Clan",
  description: "A friendly, mature European gaming community built around Hell Let Loose and Wardogs. New members welcome.",
  openGraph: { title: "REMNANT | Hell Let Loose Clan", description: "A friendly, mature European gaming community built around Hell Let Loose and Wardogs. New members welcome.", siteName: "REMNANT" },
};

export default async function Home() {
  const [data, session] = await Promise.all([getLandingData(), getSession().catch(() => null)]);
  return <Landing initial={data} signedIn={!!session} dashboardHref={session?.isAdmin ? "/members" : "/me"} />;
}
