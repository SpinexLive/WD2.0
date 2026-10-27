import { createPublicKey, verify } from "node:crypto";
import { query } from "@/lib/db";
import { env } from "@/lib/env";
import { audit } from "@/lib/audit";
import { editMessage } from "./discord";
import { getEventDetail } from "./raidHelper";
import { getRoster } from "./rosters";
import { BUTTON_PREFIX, messagePayload, renderRosterMessages } from "./rosterPublish";
import { publish } from "./bus";

/** Same as clicking Confirm/Decline in Discord, but from the dashboard. Refreshes every published roster message. */
export async function respondToRoster(eventId: string, userId: string, displayName: string, response: "accepted" | "declined"): Promise<boolean> {
  const [row] = await query<{ id: string }>(
    `SELECT r.id FROM rosters r JOIN roster_assignments a ON a.roster_id = r.id AND a.discord_id = $2 WHERE r.raid_helper_event_id = $1`,
    [eventId, userId],
  );
  if (!row) return false;
  await query(
    `INSERT INTO roster_responses (roster_id, discord_id, response) VALUES ($1,$2,$3)
     ON CONFLICT (roster_id, discord_id) DO UPDATE SET response = EXCLUDED.response, responded_at = now()`,
    [row.id, userId, response],
  );
  await audit({ discordId: userId, displayName }, `roster.${response}`, "roster", row.id, { via: "dashboard" });
  publish("roster", { eventId });
  try {
    const roster = await getRoster(eventId);
    if (roster && roster.messages.length) {
      const event = (await getEventDetail(eventId)).data;
      const messages = await renderRosterMessages(roster, event);
      for (const [idx, old] of roster.messages.entries()) {
        if (messages[idx]) await editMessage(old.channelId, old.messageId, messagePayload(messages[idx]!, roster.id, idx, false)).catch(() => undefined);
      }
    }
  } catch {
    // The response is saved; the Discord message will catch up on the next refresh.
  }
  return true;
}

// DER prefix that wraps a raw 32-byte Ed25519 public key as SPKI.
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/** Verifies the Ed25519 signature Discord attaches to every interaction request. */
export function verifyDiscordSignature(rawBody: string, signature: string | null, timestamp: string | null): boolean {
  const key = env().DISCORD_PUBLIC_KEY;
  if (!key || !signature || !timestamp || !/^[0-9a-f]{128}$/i.test(signature)) return false;
  try {
    const publicKey = createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(key, "hex")]), format: "der", type: "spki" });
    return verify(null, Buffer.from(timestamp + rawBody), publicKey, Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

export interface ButtonInteraction {
  member?: { user?: { id?: string } };
  user?: { id?: string };
  message?: { id?: string };
  data?: { custom_id?: string };
}

const ephemeral = (content: string) => ({ type: 4, data: { content, flags: 64, allowed_mentions: { parse: [] } } });

/** Handles a Confirm/Decline click and returns the interaction response body. */
export async function handleRosterButton(i: ButtonInteraction): Promise<unknown> {
  const m = new RegExp(`^${BUTTON_PREFIX}:([0-9a-f-]{36}):(accept|decline)$`).exec(i.data?.custom_id ?? "");
  const userId = i.member?.user?.id ?? i.user?.id;
  if (!m || !userId) return ephemeral("This button is no longer valid.");
  const rosterId = m[1]!;
  const response = m[2] === "accept" ? "accepted" : "declined";

  const [row] = await query<{ raid_helper_event_id: string }>(
    `SELECT r.raid_helper_event_id FROM rosters r
      JOIN roster_assignments a ON a.roster_id = r.id AND a.discord_id = $2
     WHERE r.id = $1`,
    [rosterId, userId],
  );
  if (!row) return ephemeral("You are not assigned a spot in this roster.");

  await query(
    `INSERT INTO roster_responses (roster_id, discord_id, response) VALUES ($1,$2,$3)
     ON CONFLICT (roster_id, discord_id) DO UPDATE SET response = EXCLUDED.response, responded_at = now()`,
    [rosterId, userId, response],
  );
  await audit({ discordId: userId, displayName: userId }, `roster.${response}`, "roster", rosterId, {});
  publish("roster", { eventId: row.raid_helper_event_id });

  try {
    const roster = await getRoster(row.raid_helper_event_id);
    if (!roster) return ephemeral(`You **${response}** your spot.`);
    const event = (await getEventDetail(row.raid_helper_event_id)).data;
    const messages = await renderRosterMessages(roster, event);
    const here = roster.messages.findIndex((x) => x.messageId === i.message?.id);
    if (here < 0 || !messages[here]) return ephemeral(`You **${response}** your spot.`);
    // Other parts of a multi-message roster are refreshed after replying; Discord expects an answer within 3 seconds.
    for (const [idx, old] of roster.messages.entries()) {
      if (idx !== here && messages[idx]) void editMessage(old.channelId, old.messageId, messagePayload(messages[idx]!, roster.id, idx, false)).catch(() => undefined);
    }
    const { content, embeds, components } = messagePayload(messages[here]!, roster.id, here, false);
    return { type: 7, data: { content: content ?? "", embeds, components, allowed_mentions: { parse: [] } } };
  } catch {
    return ephemeral(`You **${response}** your spot. The roster message will refresh shortly.`);
  }
}
