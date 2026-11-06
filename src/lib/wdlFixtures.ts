import { z } from "zod";

const optionalText = z.string().nullable().optional().transform((value) => value ?? null);
const optionalNumber = z.number().finite().nullable().optional().transform((value) => value ?? null);

export const wdlFixtureSchema = z.object({
  id: z.string().min(1).max(128),
  number: optionalNumber,
  status: z.string().min(1),
  scheduledAt: z.string().datetime({ offset: true }).nullable().optional().transform((value) => value ?? null),
  map: optionalText,
  gameMode: optionalText,
  competition: z.object({
    competition: optionalText,
    season: optionalText,
    division: optionalText,
    round: optionalNumber,
  }).nullable().optional().transform((value) => value ?? null),
  participants: z.array(z.object({
    team: z.object({ code: optionalText, name: optionalText }),
    faction: optionalText,
    finishingPosition: optionalNumber,
    points: optionalNumber,
    noShow: z.boolean().nullable().optional().transform((value) => value ?? null),
  })),
});

export const wdlFixturesSchema = z.object({
  upcoming: z.array(wdlFixtureSchema),
  recent: z.array(wdlFixtureSchema),
}).refine((value) => {
  const ids = [...value.upcoming, ...value.recent].map((fixture) => fixture.id);
  return new Set(ids).size === ids.length;
}, "Duplicate fixture IDs cannot be processed safely");

export type WdlFixture = z.infer<typeof wdlFixtureSchema>;
export type WdlFixtures = z.infer<typeof wdlFixturesSchema>;

export function parseWdlMap(value: string | null | undefined) {
  const [map, zone, ...weatherParts] = (value ?? "").split("·").map((part) => part.trim());
  return {
    map: map || null,
    zone: zone || null,
    weather: weatherParts.join(" · ").trim() || null,
  };
}

/** Never infer our participant from an opponent's name or from its position in the array. */
export function fixtureOpponents(fixture: WdlFixture): string[] | null {
  const ours = fixture.participants.filter((participant) => participant.team.code?.trim().toUpperCase() === "RMNT");
  if (ours.length !== 1) return null;
  const opponents = fixture.participants.filter((participant) => participant !== ours[0]);
  const codes = opponents.map((participant) => participant.team.code?.trim() ?? "");
  if (!codes.length || codes.some((code) => !code) || new Set(codes.map((code) => code.toUpperCase())).size !== codes.length) return null;
  return codes;
}
