import { protectedRoute } from "@/lib/apiGuard";

export const dynamic = "force-dynamic";

export const GET = protectedRoute(async ({ session }) => ({
  user: { id: session.discordId, username: session.username, displayName: session.displayName, avatarUrl: session.avatarUrl },
  csrfToken: session.csrfToken,
  isAdmin: session.isAdmin,
}), { allowMember: true });
