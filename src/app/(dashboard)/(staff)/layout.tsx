import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Staff-only pages. Clan members without an authorised role are sent to their own stats. */
export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.isAdmin) redirect("/me");
  return <>{children}</>;
}
