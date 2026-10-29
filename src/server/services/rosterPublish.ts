import { z } from "zod";
import { env } from "@/lib/env";
import { query, tx } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { audit } from "@/lib/audit";
import type { Session } from "@/lib/session";
import type { Roster, RosterWarning, SignupInfo } from "@/lib/rosterTypes";
import { validateRoster } from "@/lib/rosterValidation";
import { buildRosterMessages, mentionContent, type DiscordEmbed, type RosterMessage } from "@/server/embed";
import { deleteMessage, DiscordMessageMissing, editMessage, getGuildMembers, getClanMembers, getPostableChannels, postMessage, type DiscordMessagePayload } from "./discord";
import { getEventDetail, type RaidHelperEventDetail, type RaidHelperSignup } from "./raidHelper";
import { getLeagueApplications, getLeagueMembers, registrationStatus } from "./wardogsLeague";
import { getRoster } from "./rosters";
import { publish } from "./bus";
import { resolveLinks } from "./links";
import { getPlayerStats } from "./wardogsRcon";

export const publishSchema = z
  .object({
    mode: z.enum(["publish", "update", "republish"]),
    version: z.number().int().min(1),
  })
  .strict();
export type PublishInput = z.infer<typeof publishSchema>;

export const BUTTON_PREFIX = "wdr";

export function messagePayload(m: RosterMessage, rosterId: string, index: number, ping: boolean): DiscordMessagePayload {
  return {
    content: mentionContent(m.mentions, index === 0),
    embeds: [m.embed],
    components: [
      {
        type: 1,
        components: [
          { type: 2, style: 3, label: "Confirm", emoji: { id: "1389367850082500729", name: "yes" }, custom_id: `${BUTTON_PREFIX}:${rosterId}:accept` },
          { type: 2, style: 4, label: "Decline", emoji: { id: "1389367851470553108", name: "no" }, custom_id: `${BUTTON_PREFIX}:${rosterId}:decline` },
        ],
      },
    ],
    // Everyone listed is always pinged when a message is first posted; edits never re-ping.
    allowed_mentions: ping ? { parse: [], users: m.mentions.slice(0, 100) } : { parse: [] },
  };
}

export async function renderRosterMessages(roster: Roster, event: RaidHelperEventDetail): Promise<RosterMessage[]> {
  const members = await getGuildMembers(true);
  if (members.stale) throw new HttpError(503, "Current Discord server nicknames are unavailable. Try again shortly.", "discord_unavailable");
  const names = new Map(members.data.map((m) => [m.id, m.displayName]));
  return buildRosterMessages({
    eventTitle: event.title,
    startTime: event.startTime,
    eventDescription: event.description,
    thumbnailUrl: `${env().APP_URL}/images/icon.png`,
    eventType: roster.eventType,
    eventUrl: event.discordUrl,
    squads: roster.squads.map((s) => ({
      ...s,
      slots: s.slots.map((p) => p ? { ...p, displayName: names.get(p.discordId) ?? p.displayName } : null),
    })),
    responses: roster.responses,
  });
}

/** K/D comes from the official Discord↔Steam link and the Wardogs player record; lookups still running after 6s fill the cache for the next load. */
async function statsFor(discordIds: string[], force: boolean): Promise<Map<string, { kd: number | null; deaths: number }>> {
  const out = new Map<string, { kd: number | null; deaths: number }>();
  const links = await resolveLinks().catch(() => null);
  if (!links) return out;
  const lookups = Promise.all(
    discordIds.map(async (id) => {
      const steam = links.steamIds.get(id);
      if (!steam) return;
      try {
        const s = await getPlayerStats(steam, force);
        if (!s.stale && s.data) out.set(id, { kd: s.data.kd, deaths: s.data.deaths });
      } catch {
        // K/D is optional here; the player stays listed without it.
      }
    }),
  );
  await Promise.race([lookups, new Promise((r) => setTimeout(r, 6000))]);
  return out;
}

export async function enrichSignups(raw: RaidHelperSignup[], force = false, withStats = false): Promise<{ signups: SignupInfo[]; leagueAvailable: boolean }> {
  const [members, apps, clan, stats] = await Promise.all([
    getLeagueMembers(force).then((s) => s, () => null),
    getLeagueApplications(force).then((s) => s, () => null),
    getClanMembers().then((s) => s, () => null),
    withStats ? statsFor(raw.map((s) => s.discordId), force) : Promise.resolve(new Map<string, { kd: number | null; deaths: number }>()),
  ]);
  // Stale tournament data is never treated as confirmed.
  const m = members && !members.stale ? members.data : null;
  const a = apps && !apps.stale ? apps.data : null;
  const avatars = new Map((clan?.data ?? []).map((x) => [x.id, x.avatarUrl]));
  const nicknames = new Map((clan?.data ?? []).map((x) => [x.id, x.displayName]));
  return {
    signups: raw.map((s) => ({
      ...s,
      name: nicknames.get(s.discordId) || s.name,
      registration: registrationStatus(s.discordId, m, a),
      avatarUrl: avatars.get(s.discordId) ?? null,
      kd: stats.get(s.discordId)?.kd ?? null,
      deaths: stats.get(s.discordId)?.deaths ?? null,
    })),
    leagueAvailable: m !== null && a !== null,
  };
}

export async function buildPreview(roster: Roster, event: RaidHelperEventDetail): Promise<{ embeds: DiscordEmbed[]; messages: RosterMessage[]; names: Record<string, string>; warnings: RosterWarning[] }> {
  const messages = await renderRosterMessages(roster, event);
  const { signups } = await enrichSignups(event.signups);
  const names = Object.fromEntries(roster.squads.flatMap((s) => s.slots.flatMap((p) => (p ? [[p.discordId, p.displayName] as const] : []))));
  return { embeds: messages.map((m) => m.embed), messages, names, warnings: validateRoster(roster, signups) };
}

const lastReminder = new Map<string, number>();
const REMIND_COOLDOWN_MS = 5 * 60_000;

/** Posts a reply under the published roster pinging everyone assigned who hasn't pressed Confirm or Decline. */
export async function remindPending(eventId: string, actor: Session) {
  const roster = await getRoster(eventId);
  if (!roster) throw new HttpError(404, "Roster not found", "not_found");
  const first = roster.messages[0];
  if (!first) throw new HttpError(409, "Publish this roster to Discord before sending reminders.", "not_published");

  const assigned = new Set(roster.squads.flatMap((s) => s.slots.flatMap((p) => (p ? [p.discordId] : []))));
  const pending = [...assigned].filter((id) => !roster.responses[id]);
  if (pending.length === 0) throw new HttpError(409, "Nobody is pending: everyone assigned has responded.", "nobody_pending");

  const wait = (lastReminder.get(roster.id) ?? 0) + REMIND_COOLDOWN_MS - Date.now();
  if (wait > 0) throw new HttpError(429, `A reminder was just sent. Try again in ${Math.ceil(wait / 60_000)} min.`, "cooldown");
  lastReminder.set(roster.id, Date.now());

  const link = `https://discord.com/channels/${env().DISCORD_GUILD_ID}/${first.channelId}/${first.messageId}`;
  const head = `Please confirm or decline your place on the roster: ${link}\n`;
  const chunks: string[][] = [];
  let cur: string[] = [];
  let len = head.length;
  for (const id of pending) {
    const m = `<@${id}> `;
    if (len + m.length > 1900 && cur.length) {
      chunks.push(cur);
      cur = [];
      len = head.length;
    }
    cur.push(id);
    len += m.length;
  }
  chunks.push(cur);

  try {
    for (const ids of chunks) {
      await postMessage(first.channelId, {
        content: `${head}${ids.map((id) => `<@${id}>`).join(" ")}`,
        embeds: [],
        allowed_mentions: { parse: [], users: ids },
        message_reference: { message_id: first.messageId, fail_if_not_exists: false },
      });
    }
  } catch (err) {
    lastReminder.delete(roster.id);
    throw err;
  }
  await audit(actor, "roster.remind_pending", "roster", roster.id, { count: pending.length });
  return { ok: true, reminded: pending.length };
}

export async function loadForPublish(eventId: string): Promise<{ roster: Roster; event: RaidHelperEventDetail }> {
  const roster = await getRoster(eventId);
  if (!roster) throw new HttpError(404, "Save a roster for this event before publishing", "not_found");
  const event = (await getEventDetail(eventId)).data;
  return { roster, event };
}

export async function publishRoster(eventId: string, input: PublishInput, actor: Session) {
  const { roster, event } = await loadForPublish(eventId);
  if (roster.version !== input.version) {
    throw new HttpError(409, "The roster changed since you previewed it. Reload and preview again.", "conflict", { currentVersion: roster.version });
  }
  const errors = validateRoster(roster, null).filter((w) => w.severity === "error");
  if (errors.length > 0) throw new HttpError(400, `Roster has invalid assignments: ${errors.map((e) => e.message).join("; ")}`, "invalid_roster");

  const embeds = (await buildPreview(roster, event)).messages;
  const existing = roster.messages;

  if (input.mode === "publish" && existing.length > 0) throw new HttpError(409, "This roster is already published. Use Update or Republish.", "already_published");
  if (input.mode !== "publish" && existing.length === 0) throw new HttpError(409, "This roster has not been published yet.", "not_published");

  const lock = await query(
    `UPDATE rosters SET publishing_started_at = now()
      WHERE id = $1 AND (publishing_started_at IS NULL OR publishing_started_at < now() - interval '60 seconds') RETURNING id`,
    [roster.id],
  );
  if (lock.length === 0) throw new HttpError(409, "A publish is already in progress for this roster", "duplicate");

  try {
    if (input.mode === "update") return await update(roster, embeds, actor);

    // Rosters always go to the channel Raid Helper created the event in.
    const channelId = existing[0]?.channelId ?? event.channelId;
    if (!channelId) throw new HttpError(400, "Raid Helper did not report a channel for this event, so there is nowhere to post the roster.", "no_channel");
    return await postFresh(roster, embeds, channelId, actor, input.mode === "republish");
  } finally {
    await query("UPDATE rosters SET publishing_started_at = NULL WHERE id = $1", [roster.id]).catch(() => undefined);
    publish("roster", { eventId });
  }
}

async function postFresh(roster: Roster, embeds: RosterMessage[], channelId: string, actor: Session, replace: boolean) {
  const posted: string[] = [];
  try {
    for (let i = 0; i < embeds.length; i++) posted.push(await postMessage(channelId, messagePayload(embeds[i]!, roster.id, i, true)));
    await tx(async (c) => {
      await c.query("DELETE FROM published_messages WHERE roster_id = $1", [roster.id]);
      for (let i = 0; i < posted.length; i++) {
        await c.query("INSERT INTO published_messages (roster_id, part_index, channel_id, message_id, published_by) VALUES ($1,$2,$3,$4,$5)", [roster.id, i, channelId, posted[i], actor.discordId]);
      }
      await c.query("UPDATE rosters SET status = 'published' WHERE id = $1", [roster.id]);
    });
  } catch (err) {
    // Do not leave orphaned posts behind when the sequence did not complete; the saved roster is untouched.
    await Promise.allSettled(posted.map((id) => deleteMessage(channelId, id)));
    await audit(actor, "roster.publish_failed", "roster", roster.id, { channelId, error: (err as Error).message });
    throw err;
  }
  if (replace) await Promise.allSettled(roster.messages.map((m) => deleteMessage(m.channelId, m.messageId)));
  await audit(actor, replace ? "roster.republish" : "roster.publish", "roster", roster.id, { channelId, messageIds: posted });
  return { ok: true, action: replace ? "republished" : "published", channelId, messageIds: posted };
}

async function update(roster: Roster, embeds: RosterMessage[], actor: Session) {
  const old = roster.messages;
  const channelId = old[0]!.channelId;
  const shared = Math.min(old.length, embeds.length);

  try {
    for (let i = 0; i < shared; i++) await editMessage(old[i]!.channelId, old[i]!.messageId, messagePayload(embeds[i]!, roster.id, i, false));
  } catch (err) {
    if (err instanceof DiscordMessageMissing) {
      await audit(actor, "roster.update_failed", "roster", roster.id, { reason: "message_missing" });
      throw new HttpError(409, "A previously published Discord message was deleted. Republish to post it again.", "message_missing");
    }
    await audit(actor, "roster.update_failed", "roster", roster.id, { error: (err as Error).message });
    throw err;
  }

  const added: string[] = [];
  try {
    for (let i = old.length; i < embeds.length; i++) added.push(await postMessage(channelId, messagePayload(embeds[i]!, roster.id, i, false)));
  } catch (err) {
    await Promise.allSettled(added.map((id) => deleteMessage(channelId, id)));
    throw err;
  }
  for (const m of old.slice(embeds.length)) await deleteMessage(m.channelId, m.messageId).catch(() => undefined);

  await tx(async (c) => {
    await c.query("UPDATE published_messages SET updated_at = now(), updated_by = $2 WHERE roster_id = $1 AND part_index < $3", [roster.id, actor.discordId, shared]);
    for (let i = 0; i < added.length; i++) {
      await c.query("INSERT INTO published_messages (roster_id, part_index, channel_id, message_id, published_by) VALUES ($1,$2,$3,$4,$5)", [roster.id, old.length + i, channelId, added[i], actor.discordId]);
    }
    await c.query("DELETE FROM published_messages WHERE roster_id = $1 AND part_index >= $2", [roster.id, embeds.length]);
  });
  await audit(actor, "roster.update_discord", "roster", roster.id, { channelId, parts: embeds.length });
  return { ok: true, action: "updated", channelId, messageIds: [...old.slice(0, shared).map((m) => m.messageId), ...added] };
}
