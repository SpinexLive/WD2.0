import type { Snapshot } from "@/lib/cache";

type GwlMember = { discordId?: string | null };
export type GwlMemberStatus = "linked" | "not_matched" | "unknown";

export function gwlMemberMatcher(snapshot: Snapshot<{ members: GwlMember[] }> | null) {
  if (!snapshot || snapshot.stale) {
    return { status: (_discordId: string): GwlMemberStatus => "unknown", missingScope: false };
  }
  const members = snapshot.data.members;
  const missingScope = members.some((member) => member.discordId === undefined);
  const counts = new Map<string, number>();
  for (const member of members) {
    if (member.discordId) counts.set(member.discordId, (counts.get(member.discordId) ?? 0) + 1);
  }
  return {
    missingScope,
    status: (discordId: string): GwlMemberStatus => {
      const count = counts.get(discordId) ?? 0;
      if (count > 1) return "unknown";
      if (count === 1) return "linked";
      return missingScope ? "unknown" : "not_matched";
    },
  };
}
