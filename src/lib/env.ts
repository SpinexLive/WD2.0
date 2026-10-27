import { z } from "zod";

const snowflake = z.string().regex(/^\d{15,22}$/, "must be a Discord snowflake");
const idList = z
  .string()
  .min(1)
  .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean))
  .pipe(z.array(snowflake).min(1));

const schema = z.object({
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_CLIENT_SECRET: z.string().min(1),
  DISCORD_BOT_TOKEN: z.string().min(1),
  // Application public key (Developer Portal > General Information); verifies Confirm/Decline button clicks.
  DISCORD_PUBLIC_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/).optional(),
  DISCORD_GUILD_ID: snowflake,
  DISCORD_ALLOWED_ROLE_IDS: idList,
  DISCORD_MEMBER_ROLE_ID: snowflake,
  // Whole-clan role (includes members who don't play Wardogs); used for the public member count.
  DISCORD_CLAN_ROLE_ID: snowflake.default("1433399320903815188"),
  RAID_HELPER_API_TOKEN: z.string().min(1),
  WARDOGS_API_KEY: z.string().min(1),
  TOURNAMENT_API_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32, "must be at least 32 characters"),
  APP_URL: z.string().url().transform((u) => u.replace(/\/+$/, "")),
  RAID_HELPER_BASE_URL: z.string().url().default("https://raid-helper.dev"),
  RAID_HELPER_EVENTS_PATH: z.string().default("/api/v4/servers/{guildId}/events"),
  RAID_HELPER_EVENT_PATH: z.string().default("/api/v4/events/{eventId}"),
  WARDOGS_RCON_SERVER_ID: z.string().optional(),
  // Shown as the "Join us" button on the public landing page.
  DISCORD_INVITE_URL: z.string().url().optional(),
  // The only Discord user who can open the hidden /admin page.
  OWNER_DISCORD_ID: snowflake.default("839225558806167582"),
  // Optional channel where the dashboard posts an alert when an integration has been failing for an hour.
  ALERT_CHANNEL_ID: snowflake.optional(),
  // Direct game-server RCON HTTP API (fast); both must be set to use it, otherwise the hosted API is used.
  GAME_RCON_URL: z.string().url().optional(),
  GAME_RCON_PASSWORD: z.string().min(1).optional(),
  // Members of this role can read the compiled scouting feedback on opposing teams.
  DISCORD_REVIEWER_ROLE_ID: snowflake.default("1546477974461882418"),
  // Any OpenAI-compatible chat-completions API (GitHub Models, Gemini, OpenAI...). All three must be set to enable AI overviews.
  AI_BASE_URL: z.string().url().optional().or(z.literal("").transform(() => undefined)),
  AI_API_KEY: z.string().min(1).optional().or(z.literal("").transform(() => undefined)),
  AI_MODEL: z.string().min(1).optional().or(z.literal("").transform(() => undefined)),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Validated lazily so that `next build` does not require production secrets. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export const isProduction = process.env.NODE_ENV === "production";
