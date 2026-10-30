import { playerKey } from "./rosterOps";
import type { RegistrationStatus, Roster, RosterWarning, SignupInfo } from "./rosterTypes";

/**
 * Shared by the editor (live warnings) and the server (publish validation).
 * `signups` is null when Raid Helper data is unavailable, in which case sign-up checks are skipped rather than guessed.
 */
export function validateRoster(roster: Pick<Roster, "squads" | "settings" | "eventType">, signups: SignupInfo[] | null): RosterWarning[] {
  const out: RosterWarning[] = [];
  const signupById = new Map((signups ?? []).map((s) => [s.discordId, s]));
  const seen = new Map<string, string>();

  for (const squad of roster.squads) {
    if (squad.slots.length !== squad.size) {
      out.push({ type: "invalid", severity: "error", squadId: squad.id, message: `${squad.name}: slot count does not match squad size` });
    }
    const filled = squad.slots.filter((s) => s !== null);

    if (squad.slots.some((s) => s === null)) {
      const empty = squad.slots.filter((s) => s === null).length;
      out.push({ type: "empty_position", severity: "warning", squadId: squad.id, message: `${squad.name}: ${empty} empty position${empty === 1 ? "" : "s"}` });
    }
    if (squad.leaderRequired && filled.length > 0 && !filled.some((p) => p!.isLeader)) {
      out.push({ type: "missing_leader", severity: "warning", squadId: squad.id, message: `${squad.name} has no squad leader` });
    }
    if (filled.filter((p) => p!.isLeader).length > 1) {
      out.push({ type: "invalid", severity: "error", squadId: squad.id, message: `${squad.name} has more than one leader` });
    }

    for (const p of filled) {
      const prev = seen.get(playerKey(p!));
      if (prev) {
        out.push({ type: "duplicate", severity: "error", squadId: squad.id, discordId: p!.discordId ?? undefined, message: `${p!.displayName} is assigned twice (${prev} and ${squad.name})` });
      } else {
        seen.set(playerKey(p!), squad.name);
      }
      if (p!.discordId === null) {
        if (!p!.mercenaryId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p!.mercenaryId) || !p!.displayName.trim()) {
          out.push({ type: "invalid", severity: "error", squadId: squad.id, message: `${squad.name}: invalid mercenary` });
        }
        continue;
      }
      if (!/^\d{15,22}$/.test(p!.discordId)) {
        out.push({ type: "invalid", severity: "error", squadId: squad.id, discordId: p!.discordId ?? undefined, message: `${p!.displayName} has an invalid Discord ID` });
      }

      if (signups) {
        const s = signupById.get(p!.discordId);
        if (!s) {
          out.push({ type: "not_signed_up", severity: "warning", squadId: squad.id, discordId: p!.discordId ?? undefined, message: `${p!.displayName} is no longer signed up in Raid Helper` });
        } else {
          if (s.absent) out.push({ type: "absent", severity: "warning", squadId: squad.id, discordId: p!.discordId ?? undefined, message: `${p!.displayName} is marked absent in Raid Helper` });
          const reg: RegistrationStatus = s.registration;
          if (roster.settings.warnUnregistered) {
            if (reg === "not_registered" || reg === "pending") {
              out.push({ type: "unregistered", severity: "warning", squadId: squad.id, discordId: p!.discordId ?? undefined, message: `${p!.displayName} is ${reg === "pending" ? "pending" : "not registered"} with Wardogs League` });
            } else if (reg === "unknown") {
              out.push({ type: "registration_unknown", severity: "warning", squadId: squad.id, discordId: p!.discordId ?? undefined, message: `${p!.displayName}: Wardogs League registration could not be confirmed` });
            }
          }
        }
      }
    }
  }
  return out;
}
