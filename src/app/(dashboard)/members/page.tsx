import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { isOwner } from "@/lib/admin";
import MembersClient from "./MembersClient";

export const dynamic = "force-dynamic";

export default async function MembersPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.isAdmin && !session.canViewMembers) redirect("/today");
  return <MembersClient canManage={session.isAdmin} canExport={session.isAdmin && isOwner(session)} />;
}
