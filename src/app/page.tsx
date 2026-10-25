import type { Metadata } from "next";
import { Landing } from "@/components/Landing";
import { getSession } from "@/lib/session";
import { getLandingData } from "@/server/services/landing";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "REMNANT", description: "REMNANT – a Hell Let Loose clan. Upcoming events, news and who is online." };

export default async function Home() {
  const [data, session] = await Promise.all([getLandingData(), getSession().catch(() => null)]);
  return <Landing initial={data} signedIn={!!session} dashboardHref={session?.isAdmin ? "/members" : "/me"} />;
}
