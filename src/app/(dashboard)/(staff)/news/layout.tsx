import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

export default async function NewsLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session?.canManageNews) redirect("/today");
  return <>{children}</>;
}
