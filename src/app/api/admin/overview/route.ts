import { protectedRoute } from "@/lib/apiGuard";
import { requireOwner } from "@/lib/admin";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export const GET = protectedRoute(async ({ session }) => {
  requireOwner(session);
  const logs = await query<{ id: string; actor_name: string | null; action: string; target_type: string | null; target_id: string | null; details: unknown; created_at: Date }>(
    "SELECT id, actor_name, action, target_type, target_id, details, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 100",
  );
  return {
    audit: logs.map((l) => ({ id: l.id, actor: l.actor_name, action: l.action, targetType: l.target_type, targetId: l.target_id, details: l.details, at: l.created_at })),
  };
});
