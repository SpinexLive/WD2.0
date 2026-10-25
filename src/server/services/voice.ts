export interface VoiceChannel {
  id: string;
  name: string;
  userIds: string[];
}

const g = globalThis as unknown as { __voice?: { at: number; channels: VoiceChannel[] } };

/** Written by the Discord gateway listener; null until the first snapshot arrives. */
export const setVoice = (channels: VoiceChannel[]) => {
  g.__voice = { at: Date.now(), channels };
};
export const getVoice = () => g.__voice ?? null;
