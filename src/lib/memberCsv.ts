export interface MemberCsvRow {
  displayName: string;
  discordId: string;
  steamId: string | null;
}

function csvCell(value: string): string {
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/u.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function memberCsv(members: MemberCsvRow[]): string {
  const rows = members.map((member) => [member.displayName, member.discordId, member.steamId ?? ""].map(csvCell).join(","));
  return `name,discord_id,steam_id\r\n${rows.join("\r\n")}${rows.length ? "\r\n" : ""}`;
}
