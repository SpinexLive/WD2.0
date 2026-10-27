import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import ScoutingClient from "./ScoutingClient";

export const metadata: Metadata = { title: "Scouting | REMNANT" };
export const dynamic = "force-dynamic";

export default async function ScoutingPage() {
  const session = await getSession();
  if (!session || (!session.isReviewer && !session.isAdmin)) redirect("/today");
  return <ScoutingClient canDelete={session.isAdmin} />;
}
