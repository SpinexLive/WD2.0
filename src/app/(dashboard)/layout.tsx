import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { getActualSession, getSession } from "@/lib/session";
import { isOwner } from "@/lib/admin";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const actual = session.viewingAs ? await getActualSession() : session;
  return (
    <Shell user={{ id: session.discordId, displayName: session.displayName, username: session.username, avatarUrl: session.avatarUrl }} csrfToken={session.csrfToken} isAdmin={session.isAdmin} isReviewer={session.isReviewer} isOwner={session.isAdmin && isOwner(session)} canViewAs={!!actual?.isAdmin} viewingAs={session.viewingAs?.adminName ?? null}>
      {children}
    </Shell>
  );
}
