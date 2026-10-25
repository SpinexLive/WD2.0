import { query } from "./db";
import type { Session } from "./session";

export async function audit(
  actor: Pick<Session, "discordId" | "displayName">,
  action: string,
  targetType: string | null,
  targetId: string | null,
  details: Record<string, unknown> = {},
): Promise<void> {
  try {
    await query("INSERT INTO audit_logs (actor_id, actor_name, action, target_type, target_id, details) VALUES ($1,$2,$3,$4,$5,$6)", [
      actor.discordId,
      actor.displayName,
      action,
      targetType,
      targetId,
      JSON.stringify(details),
    ]);
  } catch (err) {
    console.error("audit log write failed:", (err as Error).message);
  }
}
