import { createHash } from "node:crypto";
import { z } from "zod";
import { independentQuery, query, tx } from "@/lib/db";
import { env } from "@/lib/env";
import { HttpError } from "@/lib/http";
import { audit } from "@/lib/audit";
import type { Session } from "@/lib/session";
import { getClanMembers, postMessage, type DiscordMessagePayload } from "./discord";
import { getConfig } from "./loadout";

export const LOADOUT_REMINDER_CHANNEL_ID = "1566382614519218286";
const LOCK = 824032;
const MAX_CONTENT = 2000;
const MAX_MENTIONS = 100;

export const loadoutReminderSchema = z.object({
  previewDigest: z.string().regex(/^[a-f0-9]{64}$/),
  requestId: z.string().uuid(),
}).strict();

interface ReminderSnapshot {
  ids: string[];
  trackerUrl: string | null;
  digest: string;
}
type ReminderPayload = DiscordMessagePayload & { allowed_mentions: { parse: never[]; users: string[] } };

async function reminderSnapshot(): Promise<ReminderSnapshot> {
  const [members, unlocks, config] = await Promise.all([
    getClanMembers(true),
    query<{ discord_id: string }>("SELECT DISTINCT discord_id FROM loadout_unlocks"),
    getConfig(),
  ]);
  if (members.stale) throw new HttpError(503, "Discord members could not be refreshed. No reminder was sent.", "stale_members");
  const unlocked = new Set(unlocks.map((row) => row.discord_id));
  const ids = members.data.filter((member) => !member.bot && !unlocked.has(member.id)).map((member) => member.id);
  if (ids.some((id) => !/^\d{15,22}$/.test(id)) || new Set(ids).size !== ids.length) {
    throw new HttpError(503, "Discord returned an invalid or duplicate member ID. No reminder was sent.", "invalid_members");
  }
  ids.sort();
  if (config && (!/^\d{15,22}$/.test(config.channelId) || !/^\d{15,22}$/.test(config.messageId))) {
    throw new HttpError(503, "The configured unlock tracker link is invalid. No reminder was sent.", "invalid_tracker");
  }
  const trackerUrl = config ? `https://discord.com/channels/${env().DISCORD_GUILD_ID}/${config.channelId}/${config.messageId}` : null;
  const digest = createHash("sha256").update(JSON.stringify({ ids, trackerUrl })).digest("hex");
  return { ids, trackerUrl, digest };
}

export async function previewLoadoutReminder() {
  const snapshot = await reminderSnapshot();
  return { count: snapshot.ids.length, previewDigest: snapshot.digest, trackerUrl: snapshot.trackerUrl };
}

function reminderMessages(snapshot: ReminderSnapshot): ReminderPayload[] {
  const intro = "**Loadout unlock reminder**\nPlease mark any items you have unlocked using the loadout tracker.";
  const link = snapshot.trackerUrl ? `\nTracker: ${snapshot.trackerUrl}` : "\nAsk staff where the loadout tracker is posted.";
  const header = `${intro}${link}\n\n`;
  const batches: string[][] = [];
  let batch: string[] = [];
  let length = header.length;
  for (const id of snapshot.ids) {
    const mentionLength = `<@${id}>`.length + (batch.length ? 1 : 0);
    if (batch.length && (batch.length >= MAX_MENTIONS || length + mentionLength > MAX_CONTENT)) {
      batches.push(batch);
      batch = [];
      length = header.length;
    }
    batch.push(id);
    length += `<@${id}>`.length + (batch.length > 1 ? 1 : 0);
  }
  if (batch.length) batches.push(batch);
  return batches.map((users) => ({
    content: header + users.map((id) => `<@${id}>`).join(" "),
    embeds: [],
    allowed_mentions: { parse: [], users },
  }));
}

export async function sendLoadoutReminder(
  input: z.infer<typeof loadoutReminderSchema>,
  actor: Pick<Session, "discordId" | "displayName">,
) {
  let claimedForSend = false;
  let confirmedSent = 0;
  let total = 0;
  let outcome: { sent: number; total: number; error: string | null };
  try {
    outcome = await tx(async (client) => {
      const lock = await client.query<{ acquired: boolean }>("SELECT pg_try_advisory_xact_lock($1) AS acquired", [LOCK]);
      if (!lock.rows[0]?.acquired) throw new HttpError(409, "A reminder is already being sent.", "reminder_in_progress");
      const snapshot = await reminderSnapshot();
      if (snapshot.digest !== input.previewDigest) throw new HttpError(409, "The reminder recipients or tracker changed. Review the updated preview before sending.", "reminder_changed");
      if (!snapshot.ids.length) throw new HttpError(409, "No members need a reminder.", "no_recipients");
      const claimed = await independentQuery(
        `INSERT INTO loadout_reminder_requests (request_id, actor_id, recipient_count, status)
         VALUES ($1, $2, $3, 'sending') ON CONFLICT DO NOTHING RETURNING request_id`,
        [input.requestId, actor.discordId, snapshot.ids.length],
      );
      if (!claimed.length) throw new HttpError(409, "This reminder request was already submitted. Check the Discord channel before trying again.", "duplicate_reminder");
      claimedForSend = true;
      total = snapshot.ids.length;
      try {
        for (const payload of reminderMessages(snapshot)) {
          const messageId = await postMessage(LOADOUT_REMINDER_CHANNEL_ID, payload);
          if (!/^\d{15,22}$/.test(messageId)) throw new Error("Discord did not return a valid reminder message ID.");
          confirmedSent += payload.allowed_mentions.users.length;
          await independentQuery("UPDATE loadout_reminder_requests SET sent_count = $2 WHERE request_id = $1", [input.requestId, confirmedSent]);
        }
        await independentQuery("UPDATE loadout_reminder_requests SET status = 'sent', completed_at = now() WHERE request_id = $1", [input.requestId]);
        return { sent: confirmedSent, total, error: null };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown Discord error";
        await independentQuery(
          "UPDATE loadout_reminder_requests SET status = 'failed', error = $2, completed_at = now() WHERE request_id = $1",
          [input.requestId, message.slice(0, 500)],
        ).catch((err: Error) => console.error("Could not record loadout reminder failure:", err.message));
        console.error("Loadout reminder failed:", message);
        return { sent: confirmedSent, total, error: message };
      }
    });
  } catch (error) {
    if (!claimedForSend) throw error;
    const message = error instanceof Error ? error.message : "Unknown reminder error";
    await independentQuery(
      "UPDATE loadout_reminder_requests SET status = 'failed', error = $2, completed_at = now() WHERE request_id = $1",
      [input.requestId, message.slice(0, 500)],
    ).catch((err: Error) => console.error("Could not record loadout reminder failure:", err.message));
    await audit(actor, "loadout.reminder_failed", "channel", LOADOUT_REMINDER_CHANNEL_ID, {
      requestId: input.requestId, recipients: total, confirmedSent, error: message,
    });
    throw new HttpError(503, `The reminder outcome could not be confirmed. ${confirmedSent} of ${total} recipients were confirmed sent. Check the Discord channel before retrying.`, "reminder_outcome_unknown");
  }
  await audit(actor, outcome.error ? "loadout.reminder_failed" : "loadout.reminder_sent", "channel", LOADOUT_REMINDER_CHANNEL_ID, {
    requestId: input.requestId, recipients: outcome.total, confirmedSent: outcome.sent, ...(outcome.error ? { error: outcome.error } : {}),
  });
  if (outcome.error) {
    throw new HttpError(502, `The reminder could not be completed. ${outcome.sent} of ${outcome.total} recipients were confirmed sent. Check the Discord channel before retrying; the last message may also have been delivered. ${outcome.error}`, "reminder_failed");
  }
  return { ok: true, reminded: outcome.sent };
}
