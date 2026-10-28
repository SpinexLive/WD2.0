import { env } from "@/lib/env";
import { query } from "@/lib/db";
import { audit } from "@/lib/audit";
import { HttpError, ProviderError, requestJson } from "@/lib/http";
import type { Session } from "@/lib/session";

const API = "https://discord.com/api/v10";
const SOURCE = "https://wardogshub.gg/gold-market/";
const PREFIX = "💰┊ɢᴏʟᴅ ʙᴀʀ";
const VIEW_CHANNEL = 1n << 10n;
const CONNECT = 1n << 20n;
const RUN_HOUR_UTC = 1;
const RETRY_MS = 15 * 60_000;

const bot = () => ({ Authorization: `Bot ${env().DISCORD_BOT_TOKEN}` });
const today = () => new Date().toISOString().slice(0, 10);
const SYSTEM = { discordId: "system", displayName: "Gold price scheduler" };

export interface GoldPrice { date: string; rate: number }

/** Reads the day's price from the JSON series the page embeds, falling back to the sentence in its meta description. */
export function parseGoldPrice(html: string, date: string): GoldPrice | null {
  const series = [...html.matchAll(/\{"date":"(\d{4}-\d{2}-\d{2})","rate":(\d+)\}/g)].map((m) => ({ date: m[1]!, rate: Number(m[2]) }));
  const hit = series.find((s) => s.date === date);
  if (hit) return hit;
  const meta = /costs \$([\d,]+) on (\d{1,2} [A-Za-z]+ \d{4})/.exec(html);
  if (meta) {
    const d = new Date(`${meta[2]} UTC`);
    if (!Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date) return { date, rate: Number(meta[1]!.replace(/,/g, "")) };
  }
  return null;
}

export async function fetchGoldPrice(): Promise<GoldPrice> {
  const res = await fetch(SOURCE, { headers: { "User-Agent": "REMNANT-Dashboard/1.0", Accept: "text/html" }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new HttpError(502, `The gold market page answered ${res.status}.`, "gold_source");
  const price = parseGoldPrice(await res.text(), today());
  if (!price) throw new HttpError(502, "Today's gold bar price isn't on the page yet.", "gold_not_published");
  return price;
}

export const channelName = (rate: number) => `${PREFIX}ㆍ$${rate.toLocaleString("en-US")}`;

function mapDiscord(err: unknown): never {
  if (err instanceof ProviderError && (err.code === "50013" || err.code === "50001" || err.status === 403)) {
    throw new HttpError(403, "The bot needs the Manage Channels permission in this server (and access to the category).", "bot_permission");
  }
  throw err;
}

export async function listCategories(): Promise<{ id: string; name: string }[]> {
  const { data } = await requestJson({ provider: "discord", url: `${API}/guilds/${env().DISCORD_GUILD_ID}/channels`, headers: bot() });
  return (data as { id: string; name: string; type: number; position: number }[])
    .filter((c) => c.type === 4)
    .sort((a, b) => a.position - b.position)
    .map((c) => ({ id: c.id, name: c.name }));
}

interface Row {
  channel_id: string;
  category_id: string | null;
  last_price: string | null;
  last_price_date: Date | null;
  last_checked_at: Date | null;
  last_error: string | null;
  created_by_name: string;
}

export async function getGoldStatus() {
  const [row] = await query<Row>("SELECT channel_id, category_id, last_price, last_price_date, last_checked_at, last_error, created_by_name FROM gold_channel");
  const categories = await listCategories().catch(() => null);
  return {
    channel: row
      ? {
          id: row.channel_id,
          categoryId: row.category_id,
          categoryName: categories?.find((c) => c.id === row.category_id)?.name ?? null,
          lastPrice: row.last_price === null ? null : Number(row.last_price),
          lastPriceDate: row.last_price_date?.toISOString().slice(0, 10) ?? null,
          lastCheckedAt: row.last_checked_at?.toISOString() ?? null,
          lastError: row.last_error,
          createdBy: row.created_by_name,
        }
      : null,
    categories: categories ?? [],
    categoriesError: categories === null ? "Could not load the server's categories from Discord." : null,
  };
}

/** Creates the voice channel inside the chosen category: hidden from everyone, visible (but not joinable) to the clan member role. */
export async function createGoldChannel(actor: Session, categoryId: string) {
  const [existing] = await query("SELECT 1 FROM gold_channel");
  if (existing) throw new HttpError(409, "A gold price channel already exists. Remove it first to create another.", "exists");
  const categories = await listCategories();
  if (!categories.some((c) => c.id === categoryId)) throw new HttpError(400, "That category no longer exists.", "invalid_input");

  const guildId = env().DISCORD_GUILD_ID;
  const price = await fetchGoldPrice().catch(() => null);
  let channelId: string;
  try {
    const { data } = await requestJson({
      provider: "discord",
      method: "POST",
      url: `${API}/guilds/${guildId}/channels`,
      headers: bot(),
      retries: 0,
      body: {
        name: price ? channelName(price.rate) : PREFIX,
        type: 2,
        parent_id: categoryId,
        permission_overwrites: [
          { id: guildId, type: 0, allow: "0", deny: String(VIEW_CHANNEL | CONNECT) },
          { id: env().DISCORD_MEMBER_ROLE_ID, type: 0, allow: String(VIEW_CHANNEL), deny: String(CONNECT) },
        ],
      },
    });
    channelId = (data as { id: string }).id;
  } catch (err) {
    return mapDiscord(err);
  }
  await query(
    "INSERT INTO gold_channel (channel_id, category_id, last_price, last_price_date, last_checked_at, created_by_name) VALUES ($1,$2,$3,$4,now(),$5)",
    [channelId, categoryId, price?.rate ?? null, price?.date ?? null, actor.displayName],
  );
  await audit(actor, "gold.create_channel", "channel", channelId, { categoryId });
  return { ok: true, channelId };
}

export async function removeGoldChannel(actor: Session) {
  const [row] = await query<{ channel_id: string }>("SELECT channel_id FROM gold_channel");
  if (!row) throw new HttpError(404, "There is no gold price channel.", "not_found");
  try {
    await requestJson({ provider: "discord", method: "DELETE", url: `${API}/channels/${row.channel_id}`, headers: bot(), okStatuses: [404], retries: 0 });
  } catch (err) {
    return mapDiscord(err);
  }
  await query("DELETE FROM gold_channel");
  await audit(actor, "gold.remove_channel", "channel", row.channel_id);
  return { ok: true };
}

/** Fetches today's price and renames the channel when it changed. `force` renames even if today's price was already applied. */
export async function updateGoldChannel(actor: Pick<Session, "discordId" | "displayName">, force = false) {
  const [row] = await query<{ channel_id: string; last_price: string | null; last_price_date: Date | null }>("SELECT channel_id, last_price, last_price_date FROM gold_channel");
  if (!row) throw new HttpError(404, "There is no gold price channel.", "not_found");
  if (!force && row.last_price_date?.toISOString().slice(0, 10) === today()) return { ok: true, price: Number(row.last_price), changed: false };

  let price: GoldPrice;
  try {
    price = await fetchGoldPrice();
  } catch (err) {
    await query("UPDATE gold_channel SET last_checked_at = now(), last_error = $1", [(err as Error).message]);
    throw err;
  }
  try {
    await requestJson({ provider: "discord", method: "PATCH", url: `${API}/channels/${row.channel_id}`, headers: bot(), body: { name: channelName(price.rate) }, retries: 1 });
  } catch (err) {
    if (err instanceof ProviderError && err.status === 404) {
      await query("DELETE FROM gold_channel");
      throw new HttpError(404, "The gold price channel was deleted in Discord. Create it again.", "channel_missing");
    }
    await query("UPDATE gold_channel SET last_checked_at = now(), last_error = $1", [(err as Error).message]);
    return mapDiscord(err);
  }
  await query("UPDATE gold_channel SET last_price = $1, last_price_date = $2, last_checked_at = now(), last_error = NULL", [price.rate, price.date]);
  await audit(actor, "gold.update_channel", "channel", row.channel_id, { price: price.rate, date: price.date });
  return { ok: true, price: price.rate, changed: true };
}

const g = globalThis as unknown as { __goldTimer?: NodeJS.Timeout };

/** Runs at 01:00 UTC every day; a failed attempt (for example the page hasn't published yet) is retried every 15 minutes. A restart after 01:00 catches up the same day. */
export function startGoldScheduler(): void {
  if (process.env.NEXT_PHASE === "phase-production-build" || g.__goldTimer) return;
  const nextRun = () => {
    const n = new Date();
    const t = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate(), RUN_HOUR_UTC);
    return t > n.getTime() ? t : t + 86_400_000;
  };
  const schedule = (at: number) => {
    g.__goldTimer = setTimeout(run, Math.max(1000, at - Date.now()));
    g.__goldTimer.unref?.();
  };
  const run = async () => {
    let retry = false;
    try {
      await updateGoldChannel(SYSTEM);
    } catch (err) {
      const code = (err as HttpError).code;
      retry = code !== "not_found" && code !== "channel_missing" && code !== "bot_permission";
      console.error("gold price update failed:", err instanceof Error ? err.message : "unknown");
    }
    schedule(retry ? Date.now() + RETRY_MS : nextRun());
  };
  const n = new Date();
  schedule(n.getUTCHours() >= RUN_HOUR_UTC ? Date.now() + 30_000 : nextRun());
}
