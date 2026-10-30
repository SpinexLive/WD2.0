import { getEvents } from "./raidHelper";
import { getRoster } from "./rosters";
import { getVoice } from "./voice";

export const BRIEFING_VOICE_CHANNEL_ID = "1546197103498363031";
const LOOKBACK_S = 2 * 3600;

export interface BriefingPlayer {
  discordId: string | null;
  mercenaryId?: string;
  name: string;
  avatarUrl: string | null;
  squad: string;
  isLeader: boolean;
  response: string | null;
  inVoice: boolean;
}

export interface BriefingSquad {
  name: string;
  size: number;
  slots: (BriefingPlayer | null)[];
}

export interface BriefingRoster {
  eventId: string;
  title: string;
  startTime: number;
  status: "draft" | "published";
  players: BriefingPlayer[];
  squads: BriefingSquad[];
}

/** Rosters (draft or published) for events starting within the last 2 hours or in the future, with who is currently in the briefing voice channel. */
export async function buildBriefing() {
  const events = await getEvents();
  const cutoff = Math.floor(Date.now() / 1000) - LOOKBACK_S;
  const relevant = events.data.filter((e) => e.startTime !== null && e.startTime >= cutoff).sort((a, b) => a.startTime! - b.startTime!);

  const voice = getVoice();
  const channel = voice?.channels.find((c) => c.id === BRIEFING_VOICE_CHANNEL_ID);
  const present = new Set(channel?.userIds ?? []);

  const rosters: BriefingRoster[] = [];
  for (const e of relevant) {
    const roster = await getRoster(e.id);
    if (!roster) continue;
    const squads: BriefingSquad[] = roster.squads.map((s) => ({
      name: s.name,
      size: s.size,
      slots: s.slots.map((p) =>
        p ? { discordId: p.discordId, mercenaryId: p.mercenaryId, name: p.displayName, avatarUrl: p.avatarUrl, squad: s.name, isLeader: p.isLeader, response: p.discordId ? roster.responses[p.discordId] ?? null : null, inVoice: !!p.discordId && present.has(p.discordId) } : null,
      ),
    }));
    const players = squads.flatMap((s) => s.slots.flatMap((p) => (p ? [p] : [])));
    rosters.push({ eventId: e.id, title: e.title, startTime: e.startTime!, status: roster.status, players, squads });
  }
  return {
    rosters,
    // Null when the gateway hasn't delivered a voice snapshot yet, so "absent" isn't claimed without data.
    voiceAvailable: voice !== null,
    voiceCount: present.size,
    fetchedAt: events.fetchedAt,
    stale: events.stale,
  };
}
export type Briefing = Awaited<ReturnType<typeof buildBriefing>>;
