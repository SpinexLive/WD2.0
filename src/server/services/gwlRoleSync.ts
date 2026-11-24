import { z } from "zod";
import { audit } from "@/lib/audit";
import { independentQuery, query } from "@/lib/db";
import { env } from "@/lib/env";
import { HttpError } from "@/lib/http";
import { inspectOpenEvent, readOpenFixture, type Row } from "./gwlOpenSlots";
import { getRawLeagueEvent, getScheduledLeagueEvent, getScheduledLeagueEvents, isLeagueEventChannel,
  LEAGUE_EVENT_CHANNEL, prepareLeagueRoleRename, renameLeagueRole, updateLeagueTempRole,
  otherLeagueSettingsUnchanged, verifyLeagueRoleAbsent, verifyLeagueRoleRename } from "./leagueRaidHelper";

const actor = { discordId: "system:gwl", displayName: "GWL fixture worker" };
const updating = "Temporary role update in progress or unconfirmed; check Discord, Raid Helper and signups.";
const signups = z.array(z.object({ id: z.number(), userId: z.string() }));
const setting = z.object({ temp_role: z.string() });

async function inspect(row: Row) {
  const open = readOpenFixture(row.fixture);
  if (open) return inspectOpenEvent(row, open);
  if (!row.temporary_role || !row.start_time || !row.member_role_name || !row.voice_channel_name ||
      Number(row.start_time) !== Math.floor(Date.parse(row.fixture.startsAt) / 1000) - 1800) {
    throw new HttpError(409, "The GWL event identity is incomplete.", "gwl_role_unsafe");
  }
  const scheduled = row.state === "scheduled" && row.scheduled_id && !row.event_id;
  const id = scheduled ? row.scheduled_id : row.event_id;
  if (!id || (!scheduled && (row.state !== "posted" || !row.event_channel_id))) {
    throw new HttpError(409, "The GWL event is not safely editable.", "gwl_role_unsafe");
  }
  const event = scheduled ? await getScheduledLeagueEvent(id) : await getRawLeagueEvent(id);
  const lines = typeof event.description === "string" ? event.description.split(/\r?\n/) : [];
  const entries = scheduled ? await getScheduledLeagueEvents() : [];
  const entry = entries.find((item) => item.id === id);
  const parsedSignups = scheduled ? null : signups.safeParse(event.signUps);
  if (event.serverId !== env().DISCORD_GUILD_ID || event.title !== row.temporary_role ||
      event.templateId !== "ct34" || event.startTime !== Number(row.start_time) ||
      lines.filter((line) => line === "**Competition:** GWL").length !== 1 ||
      lines.filter((line) => line === `**Match:** #${row.match_number}`).length !== 1 ||
      (scheduled ? event.channelId !== id || event.interval !== "0 days" || event.postTime !== Number(row.post_at) ||
        !entry || entry.channelId !== LEAGUE_EVENT_CHANNEL || entry.title !== row.temporary_role ||
        entry.startTime !== Number(row.start_time) || entry.postTime !== Number(row.post_at)
        : event.id !== id || event.channelId !== row.event_channel_id ||
        !(await isLeagueEventChannel(event.channelId)) || !parsedSignups?.success)) {
    throw new HttpError(409, "The GWL event or its signups could not be verified.", "gwl_role_unsafe");
  }
  return { id, scheduled: Boolean(scheduled), description: event.description,
    signups: parsedSignups?.success ? parsedSignups.data : null, roleSetting: event.advancedSettings, roleId: event.temporaryRole };
}

export async function syncGwlEventRole(row: Row, isCurrent: () => Promise<boolean>) {
  const id = row.state === "posted" ? row.event_id : row.state === "scheduled" ? row.scheduled_id : null;
  if (!id || !row.temporary_role || Date.parse(row.fixture.startsAt) <= Date.now()) return;
  const initial = row.state === "scheduled" ? await getScheduledLeagueEvent(id) : await getRawLeagueEvent(id);
  const parsed = setting.safeParse(initial.advancedSettings);
  if (parsed.success && parsed.data.temp_role === row.temporary_role) return;
  try {
    const old = await inspect(row);
    const oldSetting = setting.safeParse(old.roleSetting);
    if (!oldSetting.success || !oldSetting.data.temp_role.startsWith("GWL | RMNT v ") ||
        !row.temporary_role.startsWith("GWL | RMNT v ") || oldSetting.data.temp_role === row.temporary_role) {
      throw new HttpError(409, "The existing temporary role setting could not be verified.", "gwl_role_unsafe");
    }
    const oldName = oldSetting.data.temp_role;
    const roleId = await prepareLeagueRoleRename(id, oldName, row.temporary_role, old.scheduled, row.temporary_role);
    if (!(await isCurrent())) return;
    const again = await inspect(row);
    if (again.id !== old.id || again.description !== old.description ||
        JSON.stringify(again.signups) !== JSON.stringify(old.signups) ||
        !setting.safeParse(again.roleSetting).success ||
        JSON.stringify(again.roleSetting) !== JSON.stringify(old.roleSetting) ||
        (roleId === null ? again.roleId != null : again.roleId !== roleId)) {
      throw new HttpError(409, "The event or temporary role changed during verification.", "gwl_role_unsafe");
    }
    const claimed = await independentQuery(
      `UPDATE gwl_raid_events SET state = 'uncertain', error = $3, updated_at = now()
       WHERE match_number = $1 AND state = $2 AND fixture = $4::jsonb AND temporary_role = $5
         AND event_id IS NOT DISTINCT FROM $6 AND scheduled_id IS NOT DISTINCT FROM $7 RETURNING match_number`,
      [row.match_number, row.state, updating, JSON.stringify(row.fixture), row.temporary_role, row.event_id, row.scheduled_id]);
    if (!claimed.length) return;
    await audit(actor, "gwl.role_update_started", "gwl_fixture", row.match_number, { eventId: id });
    try {
      if (roleId) await renameLeagueRole(roleId, oldName, row.temporary_role);
      await updateLeagueTempRole(id, row.temporary_role);
      if (roleId) await verifyLeagueRoleRename(roleId, oldName, row.temporary_role);
      else await verifyLeagueRoleAbsent(oldName, row.temporary_role);
      const updated = await inspect(row);
      const updatedSetting = setting.safeParse(updated.roleSetting);
      if (updated.id !== id || updated.description !== old.description || !updatedSetting.success ||
          updatedSetting.data.temp_role !== row.temporary_role ||
          !otherLeagueSettingsUnchanged(old.roleSetting, updated.roleSetting) ||
          (roleId ? updated.roleId !== roleId : updated.roleId != null || (updated.signups?.length ?? 0) !== 0) ||
          (old.signups && (!updated.signups || old.signups.some((signup) =>
            !updated.signups!.some((item) => item.id === signup.id && item.userId === signup.userId))))) {
        throw new Error("The updated temporary role or signups could not be verified.");
      }
      const saved = await independentQuery(
        `UPDATE gwl_raid_events SET state = $2, error = NULL, updated_at = now()
         WHERE match_number = $1 AND state = 'uncertain' AND error = $3 RETURNING match_number`,
        [row.match_number, row.state, updating]);
      if (!saved.length) throw new Error("The verified temporary role update could not be recorded.");
    } catch (error) {
      await audit(actor, "gwl.role_update_uncertain", "gwl_fixture", row.match_number, { eventId: id });
      throw new Error(`GWL temporary role update could not be confirmed: ${error instanceof Error ? error.message : "unknown error"}`);
    }
    await audit(actor, "gwl.role_updated", "gwl_fixture", row.match_number, { eventId: id, roleId });
  } catch (error) {
    if (error instanceof HttpError && ["gwl_role_unsafe", "gwl_slot_unsafe"].includes(error.code ?? "")) {
      await query("UPDATE gwl_raid_events SET state = 'review', error = $2, updated_at = now() WHERE match_number = $1 AND state = $3",
        [row.match_number, `${error.message} Review the temporary role in Discord and Raid Helper.`, row.state]);
    } else throw error;
  }
}
