import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { getSession } from "@/lib/session";
import { isOwner } from "@/lib/admin";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  return (
    <Shell user={{ id: session.discordId, displayName: session.displayName, username: session.username, avatarUrl: session.avatarUrl }} csrfToken={session.csrfToken} isAdmin={session.isAdmin} isOwner={session.isAdmin && isOwner(session)}>
      {children}
    </Shell>
  );
}
