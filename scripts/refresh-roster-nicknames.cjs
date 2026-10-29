// Run with: node --env-file=.env.local scripts/refresh-roster-nicknames.cjs
// Updates existing embed fields directly, including posts whose Raid Helper event was deleted.
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  return resolveFilename.call(this, request.startsWith("@/") ? path.join(root, "src", request.slice(2)) : request, ...args);
};
require.extensions[".ts"] = function (module, filename) {
  const result = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    fileName: filename,
  });
  module._compile(result.outputText, filename);
};

async function main() {
  const { query } = require("../src/lib/db.ts");
  const { env } = require("../src/lib/env.ts");
  const { requestJson } = require("../src/lib/http.ts");
  const { getGuildMembers, editMessage } = require("../src/server/services/discord.ts");
  const { audit } = require("../src/lib/audit.ts");
  const members = await getGuildMembers(true);
  if (members.stale) throw new Error("Current guild nicknames unavailable");
  const names = new Map(members.data.map((m) => [m.id, m.displayName]));
  const rows = await query(`SELECT p.*, r.raid_helper_event_id FROM published_messages p
    JOIN rosters r ON r.id = p.roster_id ORDER BY p.roster_id, p.part_index`);
  const assignments = await query("SELECT discord_id, display_name FROM roster_assignments");
  for (const a of assignments) if (!names.has(a.discord_id)) names.set(a.discord_id, a.display_name);
  const escapeMd = (name) => name.replace(/[\\*_~`|>[\]()#]/g, "\\$&").replace(/@/g, "@\u200b");
  let failed = 0;
  for (const row of rows) {
    try {
      const { data } = await requestJson({ provider: "discord",
        url: `https://discord.com/api/v10/channels/${row.channel_id}/messages/${row.message_id}`,
        headers: { Authorization: `Bot ${env().DISCORD_BOT_TOKEN}` } });
      const embeds = data.embeds.map((embed) => ({ ...embed, fields: embed.fields?.map((field) => ({
        ...field, value: field.value.replace(/<@!?(\d+)>/g, (_match, id) => {
          if (!names.has(id)) throw new Error(`No display name for ${id}`);
          return escapeMd(names.get(id));
        }),
      })) }));
      const size = embeds.reduce((sum, e) => sum + (e.title?.length ?? 0) + (e.description?.length ?? 0)
        + (e.footer?.text?.length ?? 0) + (e.author?.name?.length ?? 0)
        + (e.fields ?? []).reduce((n, f) => n + f.name.length + f.value.length, 0), 0);
      if (size > 6000 || embeds.some((e) => e.fields?.some((f) => f.value.length > 1024)))
        throw new Error("Nickname replacement exceeds Discord embed limits");
      await editMessage(row.channel_id, row.message_id, { embeds, allowed_mentions: { parse: [] } });
      await query("UPDATE published_messages SET updated_at = now() WHERE roster_id = $1 AND part_index = $2", [row.roster_id, row.part_index]);
      await audit({ discordId: env().OWNER_DISCORD_ID, displayName: "Roster nickname refresh" }, "roster.refresh_nicknames", "roster", row.roster_id, { messageId: row.message_id });
      console.log(`Updated message ${row.message_id}`);
    } catch (err) {
      failed++;
      console.error(`Failed message ${row.message_id}: ${err.message}`);
    }
  }
  console.log(`Refreshed ${rows.length - failed}/${rows.length} published messages.`);
  return failed ? 1 : 0;
}
main().then((code) => process.exit(code), (err) => { console.error(err.message); process.exit(1); });
