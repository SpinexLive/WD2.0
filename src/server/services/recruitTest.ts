import { createHash } from "node:crypto";
import { z } from "zod";
import { query, tx } from "@/lib/db";
import { HttpError, ProviderError } from "@/lib/http";
import type { Session } from "@/lib/session";
import { matchSyncStatus } from "./matchHistory";
import { buildRecruitReport, recruitPlayerStats, type RecruitCandidate } from "./recruit";
import { recruitInvitation, RECRUIT_SCAN_LOCK } from "./recruitAlerts";
import { gamePlayers, messageGamePlayer } from "./seedingRcon";

export const recruitTestSchema = z.object({
  steamId: z.string().regex(/^\d{17}$/),
  requestId: z.string().uuid(),
  previewDigest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
type RecruitTestInput = z.infer<typeof recruitTestSchema>;

type TestPlayer = {
  steamId: string;
  name: string;
  faction: string;
  stats: { matches: number; kd: number; avgCash: number } | null;
  message: string | null;
  previewDigest: string | null;
  willCount: boolean;
  unavailable: string | null;
};

function digest(steamId: string, message: string, willCount: boolean): string {
  return createHash("sha256").update(JSON.stringify({ steamId, message, willCount })).digest("hex");
}

async function candidatesForTest(): Promise<RecruitCandidate[]> {
  try {
    return (await buildRecruitReport({ strictSources: true })).candidates;
  } catch (error) {
    if (error instanceof HttpError && error.code === "no_benchmark") return [];
    throw error;
  }
}

export async function recruitTestPlayers(): Promise<{ players: TestPlayer[] }> {
  const sync = matchSyncStatus();
  if (!sync.lastRunAt || sync.syncing || sync.pending > 0 || sync.failed) {
    throw new HttpError(409, "Wait for the match history sync to finish before testing recruitment messages.", "match_sync_incomplete");
  }
  const live = await gamePlayers();
  const ids = live.players.map((player) => player.steamId);
  if (!ids.length) return { players: [] };
  const [stats, candidates, alerts, statuses, activeTests] = await Promise.all([
    recruitPlayerStats(ids),
    candidatesForTest(),
    query<{ steam_id: string; invite_status: string }>("SELECT steam_id, invite_status FROM recruit_alerts WHERE steam_id = ANY($1::text[])", [ids]),
    query<{ steam_id: string; status: string }>("SELECT steam_id, status FROM recruit_status WHERE steam_id = ANY($1::text[])", [ids]),
    query<{ steam_id: string; status: string }>(
      "SELECT steam_id, status FROM recruit_test_attempts WHERE steam_id = ANY($1::text[]) AND status IN ('sending', 'unknown')",
      [ids],
    ),
  ]);
  const candidateById = new Map(candidates.map((candidate) => [candidate.steamId, candidate]));
  const alertById = new Map(alerts.map((alert) => [alert.steam_id, alert]));
  const statusById = new Map(statuses.map((status) => [status.steam_id, status.status]));
  const activeById = new Map(activeTests.map((test) => [test.steam_id, test.status]));
  return {
    players: live.players.map((player) => {
      const actual = stats.get(player.steamId);
      const candidate = candidateById.get(player.steamId);
      const alert = alertById.get(player.steamId);
      const status = statusById.get(player.steamId);
      const willCount = Boolean(candidate || alert);
      let unavailable: string | null = null;
      if (!player.name.trim()) unavailable = "The game server did not provide a player name.";
      else if (!actual || actual.avgCash === null || !Number.isFinite(actual.kd) || !Number.isFinite(actual.avgCash)) unavailable = "Stored match count, K/D and average cash are not all available.";
      else if (activeById.has(player.steamId)) unavailable = "A test is in progress or its delivery is unknown; check before retrying.";
      else if (alert && alert.invite_status !== "ready") unavailable = alert.invite_status === "sent" ? "This recruit has already been invited." : "An invitation is in progress or its delivery is unknown.";
      else if (status) unavailable = `This player is already marked ${status}.`;
      const values = actual && actual.avgCash !== null && Number.isFinite(actual.kd) && Number.isFinite(actual.avgCash)
        ? { matches: actual.matches, kd: Math.round(actual.kd * 100) / 100, avgCash: Math.round(actual.avgCash) }
        : null;
      const message = values && player.name.trim()
        ? recruitInvitation({ steamId: player.steamId, name: player.name, ...values }, player.name.trim())
        : null;
      return {
        steamId: player.steamId, name: player.name, faction: player.faction, stats: values, message,
        previewDigest: message ? digest(player.steamId, message, willCount) : null,
        willCount, unavailable,
      };
    }).sort((a, b) => a.name.localeCompare(b.name) || a.steamId.localeCompare(b.steamId)),
  };
}
export type RecruitTestPlayers = Awaited<ReturnType<typeof recruitTestPlayers>>;

export async function sendRecruitTest(input: RecruitTestInput, actor: Pick<Session, "discordId" | "displayName">) {
  const { players } = await recruitTestPlayers();
  const player = players.find((item) => item.steamId === input.steamId);
  if (!player) throw new HttpError(409, "That player is no longer online. Refresh the player list.", "player_offline");
  if (player.unavailable || !player.message || !player.previewDigest) throw new HttpError(409, player.unavailable ?? "The message is unavailable.", "test_unavailable");
  if (player.previewDigest !== input.previewDigest) throw new HttpError(409, "The player or their stats changed. Refresh and review the new message.", "preview_changed");

  const createdAlert = await tx(async (c) => {
    const lock = await c.query<{ acquired: boolean }>("SELECT pg_try_advisory_xact_lock($1) AS acquired", [RECRUIT_SCAN_LOCK]);
    if (!lock.rows[0]?.acquired) throw new HttpError(409, "A recruit scan is running. Please try again shortly.", "scan_running");
    const existing = await c.query<{ invite_status: string }>("SELECT invite_status FROM recruit_alerts WHERE steam_id = $1 FOR UPDATE", [input.steamId]);
    if (!player.willCount && existing.rows.length) throw new HttpError(409, "Recruit status changed. Refresh and review the message.", "preview_changed");
    const status = await c.query("SELECT status FROM recruit_status WHERE steam_id = $1", [input.steamId]);
    if (status.rowCount) throw new HttpError(409, "This player is already marked contacted or dismissed.", "invite_unavailable");
    const attempt = await c.query(
      `INSERT INTO recruit_test_attempts (request_id, steam_id, actor_id, tracked_recruit, status)
       VALUES ($1, $2, $3, $4, 'sending') ON CONFLICT DO NOTHING RETURNING request_id`,
      [input.requestId, input.steamId, actor.discordId, player.willCount],
    );
    if (!attempt.rowCount) throw new HttpError(409, "This test was already sent or another test is in progress. Refresh before trying again.", "test_duplicate");
    if (!player.willCount) return false;
    const inserted = await c.query(
      `INSERT INTO recruit_alerts (steam_id, candidate, post_status)
       VALUES ($1, $2, 'baseline') ON CONFLICT (steam_id) DO NOTHING RETURNING steam_id`,
      [input.steamId, JSON.stringify({ steamId: input.steamId, name: player.name, ...player.stats })],
    );
    const claim = await c.query(
      `UPDATE recruit_alerts SET invite_status = 'sending', invited_by = $2, invite_error = NULL, invite_started_at = now()
        WHERE steam_id = $1 AND invite_status = 'ready'
          AND NOT EXISTS (SELECT 1 FROM recruit_status WHERE recruit_status.steam_id = recruit_alerts.steam_id)
        RETURNING steam_id`,
      [input.steamId, actor.discordId],
    );
    if (!claim.rowCount) throw new HttpError(409, "This recruit has already been contacted or another invitation is in progress.", "invite_unavailable");
    return Boolean(inserted.rowCount);
  });

  try {
    await messageGamePlayer(input.steamId, player.message);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown game-server error";
    const rejected = error instanceof ProviderError && error.status !== undefined && error.status >= 400 && error.status < 500;
    try {
      await tx(async (c) => {
        await c.query("UPDATE recruit_test_attempts SET status = $2, error = $3, completed_at = now() WHERE request_id = $1", [input.requestId, rejected ? "failed" : "unknown", message.slice(0, 500)]);
        if (player.willCount && rejected && createdAlert) {
          await c.query("DELETE FROM recruit_alerts WHERE steam_id = $1 AND invite_status = 'sending' AND post_status = 'baseline'", [input.steamId]);
        } else if (player.willCount) {
          await c.query("UPDATE recruit_alerts SET invite_status = $2, invite_error = $3 WHERE steam_id = $1 AND invite_status = 'sending'", [input.steamId, rejected ? "ready" : "unknown", message.slice(0, 500)]);
        }
      });
    } catch (recordError) {
      console.error("Could not record recruit test failure:", recordError instanceof Error ? recordError.message : "unknown");
      throw new HttpError(503, "Could not record the test result. Delivery may be uncertain; check before retrying.", "test_outcome_unknown");
    }
    if (rejected) throw new HttpError(502, `The game server rejected the test message: ${message}`, "test_rejected");
    throw new HttpError(503, "Could not confirm whether the test message was delivered. It is locked to prevent a duplicate.", "test_outcome_unknown");
  }

  try {
    await tx(async (c) => {
      await c.query("UPDATE recruit_test_attempts SET status = 'sent', completed_at = now() WHERE request_id = $1", [input.requestId]);
      if (player.willCount) {
        await c.query(
          `UPDATE recruit_alerts SET invite_status = 'sent', invited_at = now(),
             post_status = CASE WHEN post_status = 'pending' THEN 'baseline' ELSE post_status END
           WHERE steam_id = $1 AND invite_status = 'sending'`,
          [input.steamId],
        );
        const status = await c.query(
          `INSERT INTO recruit_status (steam_id, status, updated_by_id, updated_by_name) VALUES ($1, 'contacted', $2, $3)
           ON CONFLICT (steam_id) DO UPDATE SET status = 'contacted', updated_by_id = $2, updated_by_name = $3, updated_at = now()
           WHERE recruit_status.status <> 'dismissed' RETURNING status`,
          [input.steamId, actor.discordId, actor.displayName],
        );
        if (!status.rowCount) throw new Error("Recruit status changed while the test was being sent.");
      }
      await c.query(
        "INSERT INTO audit_logs (actor_id, actor_name, action, target_type, target_id, details) VALUES ($1, $2, 'recruit.test_invited', 'steam', $3, $4)",
        [actor.discordId, actor.displayName, input.steamId, JSON.stringify({ playerName: player.name, countedAsInvitation: player.willCount })],
      );
    });
  } catch (error) {
    console.error("Recruit test was sent but could not be recorded:", error instanceof Error ? error.message : "unknown");
    throw new HttpError(503, "The test message was sent, but recording it failed. It remains locked; do not retry.", "test_recording_failed");
  }
  return { ok: true, playerName: player.name, countedAsInvitation: player.willCount };
}
