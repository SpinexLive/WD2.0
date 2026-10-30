export type EventType = "competitive" | "weekly";
/** Competitive rosters are limited to this many positions in total. */
export const COMPETITIVE_PLAYER_CAP = 32;
export type RegistrationStatus = "registered" | "pending" | "not_registered" | "unknown";

export interface SlotPlayer {
  /** Null for a named mercenary who has no Discord confirmation workflow. */
  discordId: string | null;
  mercenaryId?: string;
  displayName: string;
  avatarUrl: string | null;
  isLeader: boolean;
}

export interface Squad {
  id: string;
  name: string;
  category: string;
  size: number;
  leaderRequired: boolean;
  slots: (SlotPlayer | null)[];
}

export interface RosterSettings {
  warnUnregistered: boolean;
}

export type RosterResponse = "accepted" | "declined";

export interface PublishedMessage {
  partIndex: number;
  channelId: string;
  messageId: string;
  publishedAt: string;
  updatedAt: string | null;
}

export interface Roster {
  id: string;
  eventId: string;
  eventType: EventType;
  templateKey: string | null;
  settings: RosterSettings;
  status: "draft" | "published";
  version: number;
  lastEditorId: string;
  updatedAt: string;
  squads: Squad[];
  messages: PublishedMessage[];
  /** Discord ID -> response; players absent from the map have not responded yet. */
  responses: Record<string, RosterResponse>;
}

export interface TemplateSquad {
  name: string;
  category: string;
  size: number;
  leaderRequired: boolean;
}

export interface RosterTemplate {
  key: string;
  name: string;
  eventType: EventType;
  squads: TemplateSquad[];
}

export interface SignupInfo {
  discordId: string;
  name: string;
  role: string | null;
  status: string | null;
  absent: boolean;
  registration: RegistrationStatus;
  avatarUrl: string | null;
  kd: number | null;
  deaths: number | null;
}

export type WarningType = "unregistered" | "registration_unknown" | "missing_leader" | "empty_position" | "not_signed_up" | "absent" | "duplicate" | "invalid";

export interface RosterWarning {
  type: WarningType;
  /** "error" findings are structural problems; the rest are advisory and never block saving. */
  severity: "error" | "warning";
  message: string;
  squadId?: string;
  discordId?: string;
}
