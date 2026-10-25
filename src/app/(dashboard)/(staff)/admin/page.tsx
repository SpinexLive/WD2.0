import { notFound } from "next/navigation";
import { getSession } from "@/lib/session";
import { isOwner } from "@/lib/admin";
import AdminClient from "./AdminClient";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await getSession();
  if (!session || !isOwner(session)) notFound();
  return <AdminClient />;
}
