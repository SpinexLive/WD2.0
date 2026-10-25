import { env } from "./env";
import { HttpError } from "./http";
import type { Session } from "./session";

export const isOwner = (session: Pick<Session, "discordId">) => session.discordId === env().OWNER_DISCORD_ID;

/** Answers 404 (not 403) so the existence of the admin area is not revealed to anyone else. */
export function requireOwner(session: Pick<Session, "discordId">): void {
  if (!isOwner(session)) throw new HttpError(404, "Not found", "not_found");
}
