const OURS = /^(rmnt|remnant)$/i;

/** "RMNT v Team A v Team B" -> ["Team A", "Team B"]. Our own name is dropped; anything else is left for staff to correct. */
export function parseTeams(title: string): string[] {
  return title
    .split(/\s+(?:v|vs\.?|versus)\s+/i)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p && !OURS.test(p.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").replace(/^[^\p{L}\p{N}]*\s*/u, "")) && !/(^|[^\p{L}\p{N}])(rmnt|remnant)$/iu.test(p))
    .slice(0, 2);
}

/** Stable key so "Team  A" and "team a" are the same opponent across matches. */
export const teamKey = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "");
