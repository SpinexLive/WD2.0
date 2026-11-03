import { HttpError } from "./http";

export const GAME_MESSAGE_LIMIT = 256;

/** UTF-8 byte length conservatively bounds the common character counts used by the game server. */
export function gameMessageSize(message: string): number {
  return Math.max(message.length, Buffer.byteLength(message, "utf8"));
}

export function assertGameMessage(message: string): void {
  if (!message.trim()) throw new HttpError(400, "In-game message cannot be empty.", "game_message_empty");
  if (gameMessageSize(message) > GAME_MESSAGE_LIMIT) {
    throw new HttpError(400, `In-game messages must fit within the game server's ${GAME_MESSAGE_LIMIT}-character limit.`, "game_message_too_long");
  }
}

export function isInvalidGameMessage(error: unknown): error is HttpError {
  return error instanceof HttpError && (error.code === "game_message_empty" || error.code === "game_message_too_long");
}
