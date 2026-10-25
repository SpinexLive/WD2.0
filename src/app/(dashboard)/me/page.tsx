import type { Metadata } from "next";
import MemberProfile from "@/components/MemberProfile";

export const metadata: Metadata = { title: "My stats | REMNANT" };

export default function MyStatsPage() {
  return <MemberProfile endpoint="/api/me" />;
}
