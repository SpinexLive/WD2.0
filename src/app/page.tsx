import type { Metadata } from "next";
import { Landing } from "@/components/Landing";
import { getSession } from "@/lib/session";
import { getLandingData } from "@/server/services/landing";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "REMNANT | EU Competitive Gaming Community",
  description: "REMNANT is a mature EU competitive gaming community. New members welcome.",
  openGraph: { title: "REMNANT | EU Competitive Gaming Community", description: "REMNANT is a mature EU competitive gaming community. New members welcome.", siteName: "REMNANT" },
};

export default async function Home() {
  const [data, session] = await Promise.all([getLandingData(), getSession().catch(() => null)]);
  return <Landing initial={data} signedIn={!!session} dashboardHref={session?.isAdmin ? "/members" : "/me"} />;
}
