import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import ScoutingClient from "./ScoutingClient";

export const metadata: Metadata = { title: "Scouting | REMNANT" };
export const dynamic = "force-dynamic";

export default async function ScoutingPage({ searchParams }: { searchParams: Promise<{ team?: string }> }) {
  const session = await getSession();
  if (!session || (!session.isReviewer && !session.isAdmin)) redirect("/today");
  const { team } = await searchParams;
  return <ScoutingClient isStaff={session.isAdmin} initialSearch={typeof team === "string" ? team.slice(0, 100) : ""} />;
}
