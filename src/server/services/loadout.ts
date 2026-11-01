import { query } from "@/lib/db";
import { env } from "@/lib/env";
import { HttpError } from "@/lib/http";
import { LOADOUT_ITEMS, itemByKey, type LoadoutItem } from "@/lib/loadout";
import { deleteMessage, getAllClanMembers, postMessage, type DiscordMessagePayload } from "./discord";
import { publish } from "./bus";

export const LOADOUT_BUTTON = "wdlo";
const RED = 0x8b1a1a;
const DANGER = 4;
const SECONDARY = 2;

const emojiText = (i: LoadoutItem) => `<:${i.key}:${i.emojiId}>`;

/** Button rows: primary weapons, support/utility, aircraft, ground vehicles. Must sum to the item count and leave one row for "Show my unlocks". */
const ROW_SIZES = [4, 4, 2, 5];

const splitUnlock = (i: LoadoutItem) => {
  const m = /^(.*?)\s*\(Level (\d+)\)$/.exec(i.unlock);
  return { role: m?.[1] ?? i.unlock, level: m?.[2] ?? "-" };
};

function embedPayload(): DiscordMessagePayload {
  const rows = [];
  let n = 0;
  for (const size of ROW_SIZES) {
    rows.push({
      type: 1,
      components: LOADOUT_ITEMS.slice(n, (n += size)).map((i) => ({
        type: 2,
        style: DANGER,
        label: i.name,
        custom_id: `${LOADOUT_BUTTON}:t:${i.key}`,
        emoji: { id: i.emojiId, name: i.key },
      })),
    });
  }
  rows.push({ type: 1, components: [{ type: 2, style: SECONDARY, label: "Show my unlocks", custom_id: `${LOADOUT_BUTTON}:me` }] });
  return {
    embeds: [
      {
        title: "Loadout unlock tracker",
        description:
          "Press the button for each item you have **unlocked in game**. You'll be asked to confirm before it is saved, and you can press an item again to remove it.",
        // Discord has no tables; three inline fields line up as columns because each item is one line.
        fields: [
          { name: "Item", value: LOADOUT_ITEMS.map((i) => `${emojiText(i)} ${i.name}`).join("\n"), inline: true },
          { name: "Role", value: LOADOUT_ITEMS.map((i) => splitUnlock(i).role).join("\n"), inline: true },
          { name: "Level required", value: LOADOUT_ITEMS.map((i) => splitUnlock(i).level).join("\n"), inline: true },
        ],
        color: RED,
      },
    ],
    components: rows,
    allowed_mentions: { parse: [] as never[] },
  } as DiscordMessagePayload;
}

export async function getConfig() {
  const [c] = await query<{ channel_id: string; message_id: string; posted_at: Date }>("SELECT channel_id, message_id, posted_at FROM loadout_config WHERE id = 1");
  return c ? { channelId: c.channel_id, messageId: c.message_id, postedAt: c.posted_at.toISOString() } : null;
}

export async function postLoadoutEmbed(channelId: string, actorId: string): Promise<void> {
  const old = await getConfig();
  const messageId = await postMessage(channelId, embedPayload());
  if (old) await deleteMessage(old.channelId, old.messageId).catch(() => undefined);
  await query(
    `INSERT INTO loadout_config (id, channel_id, message_id, posted_by) VALUES (1,$1,$2,$3)
     ON CONFLICT (id) DO UPDATE SET channel_id = EXCLUDED.channel_id, message_id = EXCLUDED.message_id, posted_by = EXCLUDED.posted_by, posted_at = now()`,
    [channelId, messageId, actorId],
  );
}

export async function loadoutTable() {
  const [members, unlocks, config] = await Promise.all([
    getAllClanMembers().then((s) => s.data),
    query<{ discord_id: string; item_key: string }>("SELECT discord_id, item_key FROM loadout_unlocks"),
    getConfig(),
  ]);
  const byUser = new Map<string, string[]>();
  for (const u of unlocks) byUser.set(u.discord_id, [...(byUser.get(u.discord_id) ?? []), u.item_key]);
  return {
    config,
    members: members.map((m) => ({ id: m.id, name: m.displayName, avatarUrl: m.avatarUrl, items: byUser.get(m.id) ?? [] })),
  };
}

export async function resetUnlocks(): Promise<number> {
  const rows = await query<{ n: string }>("WITH d AS (DELETE FROM loadout_unlocks RETURNING 1) SELECT count(*) AS n FROM d");
  publish("loadout");
  return Number(rows[0]?.n ?? 0);
}

interface RawInteraction {
  type?: number;
  member?: { user?: { id?: string }; roles?: string[] };
  user?: { id?: string };
  data?: { custom_id?: string };
}

const reply = (content: string, components: unknown[] = [], update = false) => ({
  type: update ? 7 : 4,
  data: { content, components, flags: 64, allowed_mentions: { parse: [] } },
});
const button = (label: string, customId: string, style: number) => ({ type: 2, style, label, custom_id: customId });

/** Handles item buttons: the first press asks for confirmation, so a mis-click never saves anything. */
export async function handleLoadoutRaw(i: RawInteraction): Promise<unknown> {
  const userId = i.member?.user?.id ?? i.user?.id;
  const [, action, key] = (i.data?.custom_id ?? "").split(":");
  if (!userId) return reply("That button isn't valid.");
  if (action === "no") return reply("Cancelled. Nothing was changed.", [], true);
  if (action === "me") {
    const mine = new Set((await query<{ item_key: string }>("SELECT item_key FROM loadout_unlocks WHERE discord_id = $1", [userId])).map((r) => r.item_key));
    const line = (i: LoadoutItem) => `${emojiText(i)} ${i.name} - ${i.unlock}`;
    const have = LOADOUT_ITEMS.filter((i) => mine.has(i.key));
    const missing = LOADOUT_ITEMS.filter((i) => !mine.has(i.key));
    return reply(`**Unlocked (${have.length}/${LOADOUT_ITEMS.length})**\n${have.map(line).join("\n") || "None yet"}\n\n**Not unlocked**\n${missing.map(line).join("\n") || "Everything unlocked!"}`);
  }
  const item = key ? itemByKey(key) : undefined;
  if (!item || !["t", "ok", "rm"].includes(action ?? "")) return reply("That button isn't valid.");
  const roles = i.member?.roles ?? [];
  if (!roles.includes(env().DISCORD_CLAN_ROLE_ID) && !roles.includes(env().DISCORD_MEMBER_ROLE_ID)) return reply("Only clan members can use this.");

  if (action === "t") {
    const [have] = await query("SELECT 1 FROM loadout_unlocks WHERE discord_id = $1 AND item_key = $2", [userId, item.key]);
    return have
      ? reply(`${emojiText(item)} You have **${item.name}** marked as unlocked. Remove it?`, [{ type: 1, components: [button("Remove", `${LOADOUT_BUTTON}:rm:${item.key}`, DANGER), button("Keep", `${LOADOUT_BUTTON}:no`, SECONDARY)] }])
      : reply(`${emojiText(item)} Confirm you have **${item.name}** unlocked in game?`, [{ type: 1, components: [button("Yes, I have it", `${LOADOUT_BUTTON}:ok:${item.key}`, DANGER), button("Cancel", `${LOADOUT_BUTTON}:no`, SECONDARY)] }]);
  }
  if (action === "ok") {
    await query("INSERT INTO loadout_unlocks (discord_id, item_key) VALUES ($1,$2) ON CONFLICT DO NOTHING", [userId, item.key]);
    publish("loadout");
    return reply(`${emojiText(item)} **${item.name}** saved as unlocked.`, [], true);
  }
  await query("DELETE FROM loadout_unlocks WHERE discord_id = $1 AND item_key = $2", [userId, item.key]);
  publish("loadout");
  return reply(`${emojiText(item)} **${item.name}** removed.`, [], true);
}

export function assertChannel(id: unknown): string {
  if (typeof id !== "string" || !/^\d{5,25}$/.test(id)) throw new HttpError(400, "Choose a channel", "bad_channel");
  return id;
}
