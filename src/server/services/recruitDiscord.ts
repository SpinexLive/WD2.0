import { z } from "zod";
import { query, tx } from "@/lib/db";
import { editMessage, type DiscordMessagePayload } from "./discord";

export const RECRUIT_BUTTON = "wdrecruit";
export const RECRUIT_CHANNEL_ID = "1560238091543912558";
export const RECRUIT_MENTION_ROLES = ["1546188874986950758", "1547229723141345351"];

export const recruitCandidateSchema = z.object({
  steamId: z.string().regex(/^\d{17}$/),
  name: z.string().nullable(),
  matches: z.number().int().positive(),
  kd: z.number().finite().nonnegative(),
  avgCash: z.number().finite(),
});
export type RecruitEmbedCandidate = z.infer<typeof recruitCandidateSchema>;

export function recruitAlertPayload(
  candidate: RecruitEmbedCandidate,
  state: { status?: "contacted" | "dismissed" | null; inviteStatus?: string } = {},
): DiscordMessagePayload {
  const dismissed = state.status === "dismissed";
  const inviteDisabled = Boolean(state.status) || (state.inviteStatus !== undefined && state.inviteStatus !== "ready");
  const footer = dismissed ? "Dismissed on the Recruit dashboard."
    : state.status === "contacted" ? "Marked contacted on the Recruit dashboard."
      : state.inviteStatus === "sending" ? "An invitation is being sent."
        : state.inviteStatus === "unknown" ? "Invitation delivery is unknown; check before retrying."
          : state.inviteStatus === "sent" ? "An invitation has already been sent."
            : "Send an in-game invitation when the player is online.";
  return {
    content: RECRUIT_MENTION_ROLES.map((id) => `<@&${id}>`).join(" "),
    embeds: [{
      title: "Potential REMNANT recruit",
      color: 0xa31919,
      fields: [
        { name: "Player", value: candidate.name || "Unknown", inline: true },
        { name: "K/D", value: candidate.kd.toFixed(2), inline: true },
        { name: "Steam ID", value: candidate.steamId, inline: false },
        { name: "Qualifying matches", value: String(candidate.matches), inline: true },
        { name: "Average cash", value: candidate.avgCash.toLocaleString("en-GB"), inline: true },
      ],
      footer: { text: footer },
    }],
    components: [{ type: 1, components: [
      { type: 2, style: 4, label: "Send in-game invitation", custom_id: `${RECRUIT_BUTTON}:invite:${candidate.steamId}`, disabled: inviteDisabled },
      { type: 2, style: 2, label: dismissed ? "Dismissed" : "Dismiss", custom_id: `${RECRUIT_BUTTON}:dismiss:${candidate.steamId}`, disabled: dismissed },
    ] }],
    allowed_mentions: { parse: [], roles: RECRUIT_MENTION_ROLES },
  };
}

/** Serialize message edits with status changes so a stale edit cannot overwrite a newer status. */
export async function syncRecruitEmbed(steamId: string): Promise<void> {
  try {
    await tx(async (c) => {
      const result = await c.query<{
        candidate: unknown; discord_message_id: string | null; post_status: string;
        invite_status: string; embed_revision: number; embed_synced_revision: number;
      }>(
        `SELECT candidate, discord_message_id, post_status, invite_status, embed_revision, embed_synced_revision
           FROM recruit_alerts WHERE steam_id = $1 FOR UPDATE`,
        [steamId],
      );
      const row = result.rows[0];
      if (!row || row.post_status !== "posted" || row.embed_revision === row.embed_synced_revision) return;
      if (!row.discord_message_id) throw new Error("Recruit Discord message ID is missing.");
      const candidate = recruitCandidateSchema.parse(row.candidate);
      if (candidate.steamId !== steamId) throw new Error("Recruit alert identity does not match the candidate.");
      const current = await c.query<{ status: "contacted" | "dismissed" }>("SELECT status FROM recruit_status WHERE steam_id = $1", [steamId]);
      const payload = recruitAlertPayload(candidate, { status: current.rows[0]?.status ?? null, inviteStatus: row.invite_status });
      payload.allowed_mentions = { parse: [] };
      await editMessage(RECRUIT_CHANNEL_ID, row.discord_message_id, payload);
      await c.query("UPDATE recruit_alerts SET embed_synced_revision = $2, embed_error = NULL WHERE steam_id = $1", [steamId, row.embed_revision]);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Discord error";
    await query("UPDATE recruit_alerts SET embed_retry_at = now() + interval '5 minutes', embed_error = $2 WHERE steam_id = $1", [steamId, message.slice(0, 500)])
      .catch((recordError: Error) => console.error("Could not record recruit embed update failure:", recordError.message));
    throw error;
  }
}

/** Bring older embeds up to date and retry failed edits without re-pinging roles. */
export async function syncPendingRecruitEmbeds(): Promise<void> {
  const rows = await query<{ steam_id: string }>(
    `SELECT steam_id FROM recruit_alerts
      WHERE post_status = 'posted' AND embed_revision <> embed_synced_revision AND embed_retry_at <= now()
      ORDER BY discovered_at, steam_id LIMIT 10`,
  );
  const errors: string[] = [];
  for (const row of rows) {
    try {
      await syncRecruitEmbed(row.steam_id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Discord error";
      console.error(`Recruit embed update failed for ${row.steam_id}:`, message);
      errors.push(message);
    }
  }
  if (errors.length) throw new Error(`Could not update ${errors.length} recruit embed(s): ${errors[0]}`);
}
