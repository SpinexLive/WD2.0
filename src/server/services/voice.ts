import { publish } from "./bus";

export interface VoiceChannel {
  id: string;
  name: string;
  userIds: string[];
}

const g = globalThis as unknown as { __voice?: { at: number; channels: VoiceChannel[]; sig: string } };

/** Written by the Discord gateway listener; null until the first snapshot arrives. Live pages are told only when who is in voice actually changed. */
export const setVoice = (channels: VoiceChannel[]) => {
  const sig = JSON.stringify(channels.map((c) => [c.id, [...c.userIds].sort()]).sort());
  const changed = g.__voice?.sig !== sig;
  g.__voice = { at: Date.now(), channels, sig };
  if (changed) publish("voice");
};
export const getVoice = () => g.__voice ?? null;
