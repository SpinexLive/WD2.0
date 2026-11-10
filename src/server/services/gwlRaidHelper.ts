import { env } from "@/lib/env";
import { HttpError } from "@/lib/http";
import { gwlMapLabel } from "@/lib/gwl";
import { FACTIONS, resolveFaction } from "@/lib/scouting";
import type { WdlFixture } from "@/lib/wdlFixtures";
import type { GwlFixture } from "./gwl";
import { wdlEventBody, type wdlEventNames } from "./wdlRaidHelper";

const clean = (value: string | null) => value?.replace(/@/g, "@\u200b").replace(/[\r\n]/g, " ").trim() || "TBD";

export function gwlEventBody(fixture: GwlFixture, names: Awaited<ReturnType<typeof wdlEventNames>>, now: number) {
  const sides = fixture.sides.map((side) => ({ ...side, tag: side.team.tag?.trim() ?? "" }));
  const ours = sides.filter((side) => side.tag.toUpperCase() === "RMNT");
  const opponents = sides.filter((side) => side.tag.toUpperCase() !== "RMNT");
  const tags = sides.map((side) => side.tag.toUpperCase());
  if (fixture.status.trim().toUpperCase() !== "SCHEDULED" || ours.length !== 1 || !opponents.length ||
      sides.some((side) => !/^[A-Za-z0-9_-]{1,30}$/.test(side.tag)) || new Set(tags).size !== tags.length) {
    throw new HttpError(409, "The GWL fixture needs one RMNT team and unique, valid team tags before creating an event.", "gwl_fixture_incomplete");
  }
  const title = `GWL | RMNT v ${opponents.map((side) => side.tag).join(" v ")}`;
  if (title.length > 100 || names.roleNames.includes(title.toLowerCase())) {
    throw new HttpError(409, "The GWL temporary role name is too long or already reserved.", "gwl_role_collision");
  }
  const baseUrl = new URL(env().APP_URL);
  if (baseUrl.protocol !== "https:" || ["localhost", "127.0.0.1", "::1"].includes(baseUrl.hostname)) {
    throw new HttpError(503, "APP_URL must be a public HTTPS URL for the GWL event image.", "gwl_image_url");
  }
  const adapted: WdlFixture = {
    id: fixture.number, number: null, status: "SCHEDULED", scheduledAt: fixture.startsAt,
    map: null, gameMode: null, competition: null,
    participants: sides.map((side) => ({
      team: { code: side.tag, name: side.team.name }, faction: side.faction,
      finishingPosition: null, points: null, noShow: null,
    })),
  };
  // The GWL role is league-prefixed; do not let an unrelated WDL role affect its construction.
  const body = wdlEventBody(adapted, { ...names, roleNames: [] }, now);
  const matchTime = Math.floor(Date.parse(fixture.startsAt) / 1000);
  const postAt = matchTime - 12 * 24 * 60 * 60;
  const lines = [...opponents, ...ours].map((side) => {
    const faction = resolveFaction(side.faction);
    return faction ? `<:${faction}:${FACTIONS[faction].emojiId}> ${side.tag}` : `${side.tag} (${clean(side.faction)})`;
  });
  const { schedule: _wdlSchedule, ...common } = body;
  return {
    ...common,
    ...(postAt > now ? { schedule: postAt } : {}),
    title,
    description: [
      `**Briefing Start:** <t:${matchTime - 1800}:F>`,
      `**Match Start:** <t:${matchTime}:F>`,
      "", "**Competition:** GWL",
      `**Match:** #${clean(fixture.number)}`,
      "", `**Map:** ${clean(gwlMapLabel(fixture.map))}`,
      `**Layer:** ${clean(fixture.layer)}`,
      "", ...lines,
    ].join("\n"),
    advancedSettings: { ...body.advancedSettings, temp_role: title, image: new URL("/images/gwl.png", baseUrl).toString() },
  };
}
