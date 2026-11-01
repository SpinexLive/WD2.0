export type LoadoutGroup = "loadout" | "vehicles";

export interface LoadoutItem {
  /** Matches the Discord emoji name and is what is stored in the database. */
  key: string;
  /** Display name; also the image file name under public/images/items/<group>/. */
  name: string;
  group: LoadoutGroup;
  emojiId: string;
  /** What it takes to unlock it in game. */
  unlock: string;
}

export const LOADOUT_ITEMS: readonly LoadoutItem[] = [
  { key: "Defibrillator", name: "Defibrillator", group: "loadout", emojiId: "1566378189054410933", unlock: "Medic (Level 22)" },
  { key: "Galil", name: "Galil", group: "loadout", emojiId: "1566378190702907412", unlock: "Assault (Level 10)" },
  { key: "GhillieSuit", name: "Ghillie Suit", group: "loadout", emojiId: "1566378192565051523", unlock: "Recon (Level 26)" },
  { key: "LargeHammer", name: "Large Hammer", group: "loadout", emojiId: "1566378194418798622", unlock: "Support (Level 8)" },
  { key: "M4", name: "M4", group: "loadout", emojiId: "1566378197166325854", unlock: "Assault (Level 28)" },
  { key: "MAAWs", name: "MAAWs", group: "loadout", emojiId: "1566378198751518791", unlock: "Support (Level 18)" },
  { key: "SV98", name: "SV98", group: "loadout", emojiId: "1566378201129689238", unlock: "Recon (Level 18)" },
  { key: "T3Armour", name: "T3 Armour", group: "loadout", emojiId: "1566378186483175536", unlock: "Wardogs (Level 70)" },
  { key: "AH6RRockets", name: "AH-6R - Rockets", group: "vehicles", emojiId: "1566378098096734318", unlock: "Pilot (Level 20)" },
  { key: "Gepard", name: "Gepard", group: "vehicles", emojiId: "1566378100105936896", unlock: "Driver (Level 25)" },
  { key: "Havoc", name: "Havoc", group: "vehicles", emojiId: "1566378102135984260", unlock: "Pilot (Level 35)" },
  { key: "HumveeMinigun", name: "Humvee Minigun", group: "vehicles", emojiId: "1566378103733747813", unlock: "Driver (Level 30)" },
  { key: "L2A6", name: "L2A6", group: "vehicles", emojiId: "1566378106292535316", unlock: "Driver (Level 35)" },
  { key: "SPH2", name: "SPH-2", group: "vehicles", emojiId: "1566378108792344707", unlock: "Driver (Level 31)" },
  { key: "T72B3", name: "T72-B3", group: "vehicles", emojiId: "1566378096226209813", unlock: "Driver (Level 20)" },
];

export const GROUP_LABELS: Record<LoadoutGroup, string> = { loadout: "Loadout", vehicles: "Vehicles" };

export const itemByKey = (key: string) => LOADOUT_ITEMS.find((i) => i.key === key);

/** Image path (the original, non-white artwork). */
export const itemImage = (i: LoadoutItem) => encodeURI(`/images/items/${i.group}/${i.name}.webp`);
