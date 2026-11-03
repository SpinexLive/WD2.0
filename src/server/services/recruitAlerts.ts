import { query, tx } from "@/lib/db";
import { env } from "@/lib/env";
import { HttpError, ProviderError } from "@/lib/http";
import { GAME_MESSAGE_LIMIT, gameMessageSize, isInvalidGameMessage } from "@/lib/gameMessage";
import { hasAuthorisedRole, postMessage } from "./discord";
import { gamePlayers, messageGamePlayer } from "./seedingRcon";
import { matchSyncStatus } from "./matchHistory";
import { buildRecruitReport } from "./recruit";
import { publish } from "./bus";
import {
  RECRUIT_BUTTON, RECRUIT_CHANNEL_ID, RECRUIT_MENTION_ROLES, recruitAlertPayload, recruitCandidateSchema,
  syncPendingRecruitEmbeds, syncRecruitEmbed, type RecruitEmbedCandidate,
} from "./recruitDiscord";

export { RECRUIT_BUTTON, RECRUIT_CHANNEL_ID, RECRUIT_MENTION_ROLES, recruitAlertPayload } from "./recruitDiscord";
export const RECRUIT_SCAN_LOCK = 824029;

export function recruitInvitation(candidate: RecruitEmbedCandidate, playerName: string): string {
  const stats = `${candidate.matches} matches, ${candidate.kd.toFixed(2)} K/D and ${candidate.avgCash.toLocaleString("en-GB")}`;
  const original = `Hey ${playerName}, Spinex here leader of Remnant! Your ${stats} average cash caught our eye. Your stats stack up well against our top players, and we'd love you on the team. If youre interested in comp matches come say Hi: discord.gg/rmntgg`;
  if (gameMessageSize(original) <= GAME_MESSAGE_LIMIT) return original;

  const shorter = `Hey ${playerName}, Spinex here, Remnant's leader! Your ${stats} avg cash caught our eye. You compare well with our top players! Interested in comp matches? Join us: discord.gg/rmntgg`;
  if (gameMessageSize(shorter) <= GAME_MESSAGE_LIMIT) return shorter;

  const prefix = "Hey ";
  const suffix = `, Spinex, Remnant's leader! Your ${stats} avg cash caught our eye. You compare well with our top players! Join us for comp: discord.gg/rmntgg`;
  const budget = GAME_MESSAGE_LIMIT - gameMessageSize(prefix + suffix);
  if (budget <= 3) throw new HttpError(400, "The player's stats cannot fit in a 256-character invitation.", "game_message_too_long");
  if (gameMessageSize(playerName) <= budget) return prefix + playerName + suffix;
  let shortened = "";
  const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(playerName);
  for (const { segment } of segments) {
    if (gameMessageSize(shortened + segment + "...") > budget) break;
    shortened += segment;
  }
  if (!shortened) throw new HttpError(400, "The player's name cannot fit in a 256-character invitation.", "game_message_too_long");
  return prefix + shortened + "..." + suffix;
}

/** Snapshot all current candidates on first run; only subsequent new players are queued for Discord. */
export async function scanRecruitCandidates(): Promise<void> {
  const sync = matchSyncStatus();
  if (!sync.lastRunAt || sync.syncing || sync.pending > 0 || sync.failed) return;
  await tx(async (c) => {
    const lock = await c.query<{ acquired: boolean }>("SELECT pg_try_advisory_xact_lock($1) AS acquired", [RECRUIT_SCAN_LOCK]);
    if (!lock.rows[0]?.acquired) return;
    const state = await c.query<{ initialized_at: Date | null }>("SELECT initialized_at FROM recruit_alert_state WHERE id = 1 FOR UPDATE");
    if (!state.rows[0]) throw new Error("Recruit alerts migration has not been applied.");
    const report = await buildRecruitReport({ strictSources: true });
    const baseline = state.rows[0].initialized_at === null;
    const candidates = baseline ? report.candidates : report.candidates.filter((candidate) => candidate.status === "new");
    if (candidates.length) {
      await c.query(
        `INSERT INTO recruit_alerts (steam_id, candidate, post_status)
         SELECT item->>'steamId', item, $2 FROM jsonb_array_elements($1::jsonb) item
         ON CONFLICT (steam_id) DO NOTHING`,
        [JSON.stringify(candidates), baseline ? "baseline" : "pending"],
      );
    }
    await c.query("UPDATE recruit_alert_state SET initialized_at = COALESCE(initialized_at, now()), last_scan_at = now(), last_error = NULL WHERE id = 1");
  });
}

/** Claims are committed before posting; uncertain deliveries are never retried automatically. */
export async function postPendingRecruitAlerts(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    const rows = await query<{ steam_id: string; candidate: unknown }>(
      `UPDATE recruit_alerts SET post_status = 'posting', post_error = NULL, post_started_at = now()
        WHERE steam_id = (
          SELECT steam_id FROM recruit_alerts WHERE post_status = 'pending'
          ORDER BY discovered_at, steam_id FOR UPDATE SKIP LOCKED LIMIT 1
        ) RETURNING steam_id, candidate`,
    );
    const row = rows[0];
    if (!row) return;
    try {
      const candidate = recruitCandidateSchema.parse(row.candidate);
      if (candidate.steamId !== row.steam_id) throw new Error("Recruit alert identity does not match the candidate.");
      const messageId = await postMessage(RECRUIT_CHANNEL_ID, recruitAlertPayload(candidate));
      if (!/^\d{15,22}$/.test(messageId)) throw new Error("Discord did not return a valid message ID.");
      await query("UPDATE recruit_alerts SET post_status = 'posted', discord_message_id = $2 WHERE steam_id = $1 AND post_status = 'posting'", [row.steam_id, messageId]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Discord posting error";
      const rejected = error instanceof ProviderError && error.status !== undefined && error.status >= 400 && error.status < 500;
      await query("UPDATE recruit_alerts SET post_status = $2, post_error = $3 WHERE steam_id = $1 AND post_status = 'posting'",
        [row.steam_id, rejected ? "pending" : "unknown", message.slice(0, 500)]);
      throw new Error(`Recruit notification could not be posted: ${message}`);
    }
  }
}

interface RecruitButton {
  guildId?: string | null;
  channelId?: string | null;
  messageId?: string | null;
  userId?: string;
  actorName?: string;
  roles: string[];
  customId: string;
}

async function dismissRecruit(input: RecruitButton, steamId: string): Promise<string> {
  const result = await tx(async (c) => {
    const alert = await c.query<{ invite_status: string }>(
      `SELECT invite_status FROM recruit_alerts
        WHERE steam_id = $1 AND post_status = 'posted' AND discord_message_id = $2 FOR UPDATE`,
      [steamId, input.messageId],
    );
    if (!alert.rows[0]) return "This recruitment message is no longer active.";
    if (alert.rows[0].invite_status === "sending") return "An invitation is being sent. Wait for it to finish before dismissing this recruit.";
    const status = await c.query<{ status: string }>("SELECT status FROM recruit_status WHERE steam_id = $1", [steamId]);
    if (status.rows[0]?.status === "dismissed") return "This recruit is already dismissed.";
    await c.query(
      `INSERT INTO recruit_status (steam_id, status, updated_by_id, updated_by_name) VALUES ($1, 'dismissed', $2, $3)
       ON CONFLICT (steam_id) DO UPDATE SET status = 'dismissed', updated_by_id = $2, updated_by_name = $3, updated_at = now()`,
      [steamId, input.userId, input.actorName || input.userId],
    );
    await c.query("UPDATE recruit_alerts SET embed_revision = embed_revision + 1, embed_retry_at = now() WHERE steam_id = $1", [steamId]);
    await c.query(
      "INSERT INTO audit_logs (actor_id, actor_name, action, target_type, target_id, details) VALUES ($1, $2, 'recruit.dismissed', 'steam', $3, $4)",
      [input.userId, input.actorName || input.userId, steamId, JSON.stringify({ source: "discord", messageId: input.messageId })],
    );
    return null;
  });
  if (result) return result;
  publish("recruit");
  try {
    await syncRecruitEmbed(steamId);
  } catch (error) {
    console.error("Dismissed recruit embed update failed:", error instanceof Error ? error.message : "unknown");
    return "Recruit dismissed on the dashboard, but the Discord message could not be updated. The dashboard will retry.";
  }
  return "Recruit dismissed and moved to Dismissed on the dashboard.";
}

export async function recruitButton(input: RecruitButton): Promise<string> {
  if (input.guildId !== env().DISCORD_GUILD_ID || input.channelId !== RECRUIT_CHANNEL_ID || !input.userId) return "This recruitment button is not valid here.";
  if (!hasAuthorisedRole(input.roles) && !input.roles.some((role) => RECRUIT_MENTION_ROLES.includes(role))) return "Only authorised recruitment staff can manage recruits.";
  const match = /^wdrecruit:(invite|dismiss):(\d{17})$/.exec(input.customId);
  if (!match) return "This recruitment button is invalid.";
  const steamId = match[2]!;
  if (match[1] === "dismiss") return dismissRecruit(input, steamId);
  const [record] = await query<{ invite_status: string }>(
    "SELECT invite_status FROM recruit_alerts WHERE steam_id = $1 AND post_status = 'posted' AND discord_message_id = $2",
    [steamId, input.messageId],
  );
  if (!record) return "This recruitment message is no longer active.";
  if (record.invite_status !== "ready") {
    return record.invite_status === "sent" ? "This player has already received an invitation." : "An invitation is already being sent or its outcome is unknown. Do not retry until it has been checked.";
  }
  const report = await buildRecruitReport({ strictSources: true });
  const candidate = report.candidates.find((c) => c.steamId === steamId && c.status === "new");
  if (!candidate) return "This player is no longer a new, suitable recruit. No invitation was sent.";
  const online = (await gamePlayers()).players.find((player) => player.steamId === steamId);
  if (!online) return "This player is not currently on the game server. No invitation was sent; try again when they are online.";
  const name = online.name.trim();
  if (!name) return "The game server did not provide the player's name. No invitation was sent.";
  const checked = recruitCandidateSchema.parse(candidate);
  let invitation: string;
  try {
    invitation = recruitInvitation(checked, name);
  } catch (error) {
    if (isInvalidGameMessage(error)) return `${error.message} No invitation was sent.`;
    throw error;
  }
  const claimed = await tx(async (c) => {
    const alert = await c.query<{ invite_status: string }>(
      `SELECT invite_status FROM recruit_alerts WHERE steam_id = $1 AND discord_message_id = $2 AND post_status = 'posted' FOR UPDATE`,
      [steamId, input.messageId],
    );
    if (alert.rows[0]?.invite_status !== "ready") return false;
    const status = await c.query("SELECT status FROM recruit_status WHERE steam_id = $1", [steamId]);
    if (status.rowCount) return false;
    await c.query(
      "UPDATE recruit_alerts SET invite_status = 'sending', invited_by = $2, invite_error = NULL, invite_started_at = now() WHERE steam_id = $1",
      [steamId, input.userId],
    );
    return true;
  });
  if (!claimed) return "An invitation was already sent, is being processed, or the recruit is no longer new.";
  try {
    await messageGamePlayer(steamId, invitation);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown game-server error";
    const invalidMessage = isInvalidGameMessage(error);
    const rejected = invalidMessage || (error instanceof ProviderError && error.status !== undefined && error.status >= 400 && error.status < 500);
    await query("UPDATE recruit_alerts SET invite_status = $2, invite_error = $3, embed_revision = embed_revision + 1, embed_retry_at = now() WHERE steam_id = $1 AND invite_status = 'sending'",
      [steamId, rejected ? "ready" : "unknown", message.slice(0, 500)]);
    if (rejected) return invalidMessage ? `The invitation was not sent: ${message}` : `The game server rejected the invitation: ${message}. Nothing was sent.`;
    publish("recruit");
    try {
      await syncRecruitEmbed(steamId);
    } catch (syncError) {
      console.error("Uncertain recruit invitation embed update failed:", syncError instanceof Error ? syncError.message : "unknown");
      return "Could not confirm whether the invitation was delivered. It is locked to prevent a duplicate; the Discord message update will be retried.";
    }
    return "Could not confirm whether the invitation was delivered. It has been locked to prevent sending a duplicate.";
  }
  try {
    await tx(async (c) => {
      await c.query("UPDATE recruit_alerts SET invite_status = 'sent', invited_at = now(), embed_revision = embed_revision + 1, embed_retry_at = now() WHERE steam_id = $1 AND invite_status = 'sending'", [steamId]);
      await c.query(
        `INSERT INTO recruit_status (steam_id, status, updated_by_id, updated_by_name) VALUES ($1, 'contacted', $2, $3)
         ON CONFLICT (steam_id) DO UPDATE SET status = 'contacted', updated_by_id = $2, updated_by_name = $3, updated_at = now()
         WHERE recruit_status.status <> 'dismissed'`,
        [steamId, input.userId, input.actorName || input.userId],
      );
      await c.query(
        "INSERT INTO audit_logs (actor_id, actor_name, action, target_type, target_id, details) VALUES ($1, $2, 'recruit.invited', 'steam', $3, $4)",
        [input.userId, input.actorName || input.userId, steamId, JSON.stringify({ playerName: name })],
      );
    });
  } catch (error) {
    console.error("Recruit invitation was sent but could not be recorded:", error instanceof Error ? error.message : "unknown");
    return "The invitation was sent, but recording it failed. It remains locked to prevent a duplicate; contact an administrator.";
  }
  publish("recruit");
  try {
    await syncRecruitEmbed(steamId);
  } catch (error) {
    console.error("Invited recruit embed update failed:", error instanceof Error ? error.message : "unknown");
    return `Invitation sent to ${name} and marked contacted, but the Discord message could not be updated. The dashboard will retry.`;
  }
  return `Invitation sent to ${name}. They have been marked as contacted.`;
}

export async function recruitAlertStatus() {
  const [state] = await query<{ initialized_at: Date | null; last_scan_at: Date | null; last_error: string | null }>(
    "SELECT initialized_at, last_scan_at, last_error FROM recruit_alert_state WHERE id = 1",
  );
  if (!state) throw new Error("Recruit alerts migration has not been applied.");
  const [summary] = await query<{ pending: number; uncertain_posts: number; uncertain_invites: number; embed_failures: number }>(
    `SELECT count(*) FILTER (WHERE post_status = 'pending')::int AS pending,
            count(*) FILTER (WHERE post_status = 'unknown' OR (post_status = 'posting' AND post_started_at < now() - interval '1 minute'))::int AS uncertain_posts,
            count(*) FILTER (WHERE invite_status = 'unknown' OR (invite_status = 'sending' AND invite_started_at < now() - interval '1 minute'))::int AS uncertain_invites,
            count(*) FILTER (WHERE post_status = 'posted' AND embed_revision <> embed_synced_revision AND embed_error IS NOT NULL)::int AS embed_failures
       FROM recruit_alerts`,
  );
  if (!summary) throw new Error("Could not read recruit notification status.");
  const uncertain = summary.uncertain_posts || summary.uncertain_invites
    ? await query<{ steam_id: string; post_uncertain: boolean; invite_uncertain: boolean }>(
      `SELECT steam_id,
              (post_status = 'unknown' OR (post_status = 'posting' AND post_started_at < now() - interval '1 minute')) AS post_uncertain,
              (invite_status = 'unknown' OR (invite_status = 'sending' AND invite_started_at < now() - interval '1 minute')) AS invite_uncertain
         FROM recruit_alerts
        WHERE post_status = 'unknown' OR (post_status = 'posting' AND post_started_at < now() - interval '1 minute')
           OR invite_status = 'unknown' OR (invite_status = 'sending' AND invite_started_at < now() - interval '1 minute')
        ORDER BY discovered_at LIMIT 100`,
    )
    : [];
  return {
    initialized: state.initialized_at !== null,
    lastScanAt: state.last_scan_at?.toISOString() ?? null,
    lastError: state.last_error,
    pending: summary.pending,
    uncertainPosts: summary.uncertain_posts,
    uncertainInvites: summary.uncertain_invites,
    embedFailures: summary.embed_failures,
    uncertain: uncertain.map((row) => ({ steamId: row.steam_id, post: row.post_uncertain, invite: row.invite_uncertain })),
  };
}
export type RecruitAlertStatus = Awaited<ReturnType<typeof recruitAlertStatus>>;

export async function recruitAlertsTick(): Promise<void> {
  const errors: string[] = [];
  try {
    await scanRecruitCandidates();
    await postPendingRecruitAlerts();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown recruitment alert error";
    console.error("Recruit alerts:", message);
    errors.push(message);
  }
  try {
    await syncPendingRecruitEmbeds();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown recruit embed update error";
    console.error("Recruit embed updates:", message);
    errors.push(message);
  }
  if (errors.length) {
    await query("UPDATE recruit_alert_state SET last_error = $1 WHERE id = 1", [errors.join("; ").slice(0, 500)])
      .catch((err: Error) => console.error("Could not record recruit alert error:", err.message));
  }
}

const g = globalThis as unknown as { __recruitAlertsTimer?: NodeJS.Timeout };
export function startRecruitAlertsScheduler(): void {
  if (process.env.NEXT_PHASE === "phase-production-build" || g.__recruitAlertsTimer) return;
  g.__recruitAlertsTimer = setInterval(() => void recruitAlertsTick(), 60_000);
  g.__recruitAlertsTimer.unref();
  setTimeout(() => void recruitAlertsTick(), 30_000).unref();
}
