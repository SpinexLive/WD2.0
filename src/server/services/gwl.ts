import { z } from "zod";
import { env } from "@/lib/env";
import { cached, invalidate } from "@/lib/cache";
import { HttpError, ProviderError, requestJson } from "@/lib/http";

const BASE = "https://gwl.gg/api/v1/team";
const text = z.string();
const teamSchema = z.object({
  name: text, tag: text, slug: text, region: text, eloRating: z.number(),
  ratedMatches: z.number(), rosterCount: z.number(), leagueRank: z.number().nullable(),
});
const memberSchema = z.object({
  name: text, role: text, playerId: text.optional(), discordName: text.optional(),
  discordId: z.string().regex(/^\d{15,22}$/).nullable().optional(),
});
const applicationSchema = z.object({
  id: text, name: text, note: text.nullable(), appliedAt: text, deadline: text,
  regions: z.array(text).optional(), elo: z.number().nullable().optional(), ratedMatches: z.number().optional(),
});
const sideSchema = z.object({
  team: z.object({ slug: text, name: text.nullable(), tag: text.nullable() }),
  faction: text.nullable(), points: z.number().nullable(), score: z.number().nullable(),
  placement: z.number().nullable(), eloDelta: z.number().nullable(),
});
export const gwlFixtureSchema = z.object({
  number: text.min(1).max(128), status: text, map: text, layer: text.nullable(), weather: text.nullable().optional(), startsAt: z.string().datetime({ offset: true }),
  region: text, sides: z.array(sideSchema),
  concludedAt: z.string().datetime({ offset: true }).nullable().optional(),
  season: text.optional(),
  rated: z.boolean().optional(),
  serverPosted: z.boolean().optional(),
  readyTeams: z.array(text).optional(),
});
export type GwlFixture = z.infer<typeof gwlFixtureSchema>;
export function nextGwlFixture(fixtures: GwlFixture[], now = Date.now()): GwlFixture | null {
  const excluded = new Set(["CANCELLED", "CANCELED", "POSTPONED", "ABANDONED", "VOID"]);
  return fixtures.filter((fixture) => !excluded.has(fixture.status.trim().toUpperCase()) && Date.parse(fixture.startsAt) >= now)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0] ?? null;
}
export const gwlFixturesSchema = z.object({
  upcoming: z.array(gwlFixtureSchema), recent: z.array(gwlFixtureSchema),
}).refine((fixtures) => {
  const numbers = [...fixtures.upcoming, ...fixtures.recent].map((fixture) => fixture.number);
  return new Set(numbers).size === numbers.length;
}, "Duplicate GWL match numbers");
const slotsSchema = z.object({ slots: z.array(z.object({
  id: text, startsAt: text, region: text, map: text, layer: text.nullable(), weather: text.nullable().optional(),
  seatsFilled: z.number(), host: text,
})) });
const eloSchema = z.object({ eloRating: z.number(), ratedMatches: z.number(), changeLast5: z.number(), history: z.array(z.number()) });

async function get<T>(path: string, schema: z.ZodType<T>, force = false) {
  return cached(`gwl:${path}`, 60_000, async () => {
    const key = env().GWL_API_KEY;
    if (!key) throw new HttpError(503, "GWL is not configured. Set GWL_API_KEY on the server.", "gwl_not_configured");
    const { data } = await requestJson({ provider: "gwl", url: `${BASE}${path}`, headers: { Authorization: `Bearer ${key}` } });
    const parsed = schema.safeParse(data);
    if (!parsed.success) throw new ProviderError("gwl", `Unexpected GWL ${path || "team"} response format.`);
    return parsed.data;
  }, force);
}

export const getGwlTeam = (force = false) => get("", teamSchema, force);
export const getGwlMembers = (force = false) => get("/members", z.object({ members: z.array(memberSchema) }), force);
export const getGwlApplications = (force = false) => get("/applications", z.object({ applications: z.array(applicationSchema) }), force);
export const getGwlFixtures = (force = false) => get("/fixtures?limit=100", gwlFixturesSchema, force);
export const getGwlElo = (force = false) => get("/elo?limit=100", eloSchema, force);
export const getGwlSlots = (force = false) => get("/slots", slotsSchema, force);

export async function respondGwlApplication(id: string, accept: boolean) {
  const key = env().GWL_API_KEY;
  if (!key) throw new HttpError(503, "GWL is not configured. Set GWL_API_KEY on the server.", "gwl_not_configured");
  await requestJson({
    provider: "gwl", method: "POST", url: `${BASE}/applications/${encodeURIComponent(id)}/respond`,
    headers: { Authorization: `Bearer ${key}` }, body: { accept }, retries: 0,
  });
  invalidate("gwl:");
}
