import { z } from "zod";

export const SCORE_SEPARATOR = "ㆍ";
export const SCORE_PREFIX = " | ";
export const MAX_NAME_LENGTH = 128;

export interface FactionScore { name: string; score: number }

export const serverNameSettingsSchema = z.object({
  enabled: z.boolean(),
  baseName: z.string().trim().min(1).max(100).regex(/^[^"\r\n\\]+$/, "Name cannot contain quotes, backslashes or line breaks"),
});
export type ServerNameSettings = z.infer<typeof serverNameSettingsSchema>;

/** `L 98ㆍV 45ㆍM 12`, using each faction's initial in the order the server reports them. */
export function scoreText(scores: FactionScore[]): string {
  return scores.map((s) => `${s.name.trim().charAt(0).toUpperCase()} ${Math.max(0, Math.trunc(s.score))}`).join(SCORE_SEPARATOR);
}

/** The score is always shown, including 0-0; the plain base name is used only when no scores are reported. */
export function buildServerName(base: string, scores: FactionScore[]): string {
  const name = scores.length === 0 ? base : `${base}${SCORE_PREFIX}${scoreText(scores)}`;
  if (name.length > MAX_NAME_LENGTH) throw new Error(`Server name would be ${name.length} characters (max ${MAX_NAME_LENGTH}). Shorten the base name.`);
  return name;
}

/** Removes a previously appended score suffix, so the current in-game name can seed the base name. */
export function stripScore(name: string): string {
  const re = new RegExp(`${SCORE_PREFIX.replace(/[|]/g, "\\|")}[A-Z] \\d+(?:${SCORE_SEPARATOR}[A-Z] \\d+)+$`);
  return name.replace(re, "").trim();
}

const NAME_LINE = /^ServerName="[^"\r\n]*"/m;
export function readConfigServerName(text: string): string | null {
  const m = NAME_LINE.exec(text);
  return m ? m[0].slice('ServerName="'.length, -1) : null;
}

/** Replaces only the ServerName value and leaves every other byte of the config untouched. */
export function replaceConfigServerName(text: string, name: string): string {
  if (!NAME_LINE.test(text)) throw new Error("ServerName was not found in the game config");
  if (/["\r\n]/.test(name)) throw new Error("Invalid server name");
  return text.replace(NAME_LINE, () => `ServerName="${name}"`);
}
