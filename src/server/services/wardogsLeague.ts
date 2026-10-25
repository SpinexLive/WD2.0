import { env } from "@/lib/env";
import { requestJson, ProviderError } from "@/lib/http";
import { cached, invalidate, type Snapshot } from "@/lib/cache";

const BASE = "https://wardogsleague.net/api/v1/team";
const auth = () => ({ Authorization: `Bearer ${env().TOURNAMENT_API_KEY}` });

export interface LeagueMember {
  discordId: string;
  name: string | null;
  role: string | null;
  joinedAt: string | null;
}

export interface LeagueApplication {
  id: string;
  discordId: string | null;
  name: string | null;
}

const pick = (o: Record<string, unknown>, keys: string[]): unknown => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
};

/** Discord IDs are only accepted as strings; JSON numbers would already have lost precision. */
function discordIdOf(o: Record<string, unknown>): string | null {
  const nested = (o.discord ?? o.user) as Record<string, unknown> | undefined;
  const raw = pick(o, ["discordId", "discord_id", "discordUserId"]) ?? (nested && typeof nested === "object" ? pick(nested, ["id", "discordId", "discord_id"]) : undefined);
  return typeof raw === "string" && /^\d{15,22}$/.test(raw) ? raw : null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

function nameOf(o: Record<string, unknown>): string | null {
  const nested = (o.user ?? o.discord) as Record<string, unknown> | undefined;
  return str(pick(o, ["name", "username", "displayName"])) ?? (nested && typeof nested === "object" ? str(pick(nested, ["displayName", "discordUsername", "name"])) : null);
}

function items(data: unknown, label: string): Record<string, unknown>[] {
  const list = Array.isArray(data)
    ? data
    : data && typeof data === "object"
      ? (["members", "applications", "data", "results", "items"] as const).map((k) => (data as Record<string, unknown>)[k]).find(Array.isArray)
      : undefined;
  if (!Array.isArray(list)) throw new ProviderError("wardogs-league", `Unrecognised Wardogs League ${label} response format`);
  return list.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
}

export function parseMembers(data: unknown): LeagueMember[] {
  const list = items(data, "members");
  const members = list.flatMap((o) => {
    const discordId = discordIdOf(o);
    if (!discordId) return [];
    return [{ discordId, name: nameOf(o), role: str(o.role), joinedAt: str(o.joinedAt) }];
  });
  if (list.length > 0 && members.length === 0) {
    throw new ProviderError("wardogs-league", "Wardogs League members have no usable Discord ID field; matching is unreliable");
  }
  return members;
}

export function parseApplications(data: unknown): LeagueApplication[] {
  const list = items(data, "applications");
  return list.flatMap((o) => {
    const id = pick(o, ["id", "applicationId", "application_id"]);
    if (typeof id !== "string" && typeof id !== "number") return [];
    const status = str(pick(o, ["status", "state"]));
    if (status && status.toLowerCase() !== "pending") return [];
    return [{ id: String(id), discordId: discordIdOf(o), name: nameOf(o) }];
  });
}

export function getLeagueMembers(force = false): Promise<Snapshot<LeagueMember[]>> {
  return cached("league:members", 2 * 60_000, async () => parseMembers((await requestJson({ provider: "wardogs-league", url: `${BASE}/members`, headers: auth() })).data), force);
}

export function getLeagueApplications(force = false): Promise<Snapshot<LeagueApplication[]>> {
  return cached("league:applications", 60_000, async () => parseApplications((await requestJson({ provider: "wardogs-league", url: `${BASE}/applications`, headers: auth() })).data), force);
}

export async function respondToApplication(id: string, accept: boolean): Promise<void> {
  await requestJson({
    provider: "wardogs-league",
    method: "POST",
    url: `${BASE}/applications/${encodeURIComponent(id)}/respond`,
    headers: auth(),
    body: { accept },
    retries: 0,
  });
  invalidate("league:");
}

export type RegistrationStatus = "registered" | "pending" | "not_registered" | "unknown";

/**
 * Matches by Discord ID only. If either dataset is unavailable the answer is
 * "unknown" rather than guessing "not registered".
 */
export function registrationStatus(discordId: string, members: LeagueMember[] | null, apps: LeagueApplication[] | null): RegistrationStatus {
  if (!members) return "unknown";
  if (members.some((m) => m.discordId === discordId)) return "registered";
  if (!apps) return "unknown";
  if (apps.some((a) => a.discordId === discordId)) return "pending";
  if (apps.some((a) => !a.discordId)) return "unknown";
  return "not_registered";
}
