export type LoadoutGroup = "loadout" | "vehicles";

export interface LoadoutItem {
  /** Matches the Discord emoji name and is what is stored in the database. */
  key: string;
  /** Display name; also the image file name under public/images/items/<group>/. */
  name: string;
  group: LoadoutGroup;
  emojiId: string;
}

export const LOADOUT_ITEMS: readonly LoadoutItem[] = [
  { key: "Defibrillator", name: "Defibrillator", group: "loadout", emojiId: "1566378189054410933" },
  { key: "Galil", name: "Galil", group: "loadout", emojiId: "1566378190702907412" },
  { key: "GhillieSuit", name: "Ghillie Suit", group: "loadout", emojiId: "1566378192565051523" },
  { key: "LargeHammer", name: "Large Hammer", group: "loadout", emojiId: "1566378194418798622" },
  { key: "M4", name: "M4", group: "loadout", emojiId: "1566378197166325854" },
  { key: "MAAWs", name: "MAAWs", group: "loadout", emojiId: "1566378198751518791" },
  { key: "SV98", name: "SV98", group: "loadout", emojiId: "1566378201129689238" },
  { key: "T3Armour", name: "T3 Armour", group: "loadout", emojiId: "1566378186483175536" },
  { key: "AH6RRockets", name: "AH-6R - Rockets", group: "vehicles", emojiId: "1566378098096734318" },
  { key: "Gepard", name: "Gepard", group: "vehicles", emojiId: "1566378100105936896" },
  { key: "Havoc", name: "Havoc", group: "vehicles", emojiId: "1566378102135984260" },
  { key: "HumveeMinigun", name: "Humvee Minigun", group: "vehicles", emojiId: "1566378103733747813" },
  { key: "L2A6", name: "L2A6", group: "vehicles", emojiId: "1566378106292535316" },
  { key: "SPH2", name: "SPH-2", group: "vehicles", emojiId: "1566378108792344707" },
  { key: "T72B3", name: "T72-B3", group: "vehicles", emojiId: "1566378096226209813" },
];

export const GROUP_LABELS: Record<LoadoutGroup, string> = { loadout: "Loadout", vehicles: "Vehicles" };

export const itemByKey = (key: string) => LOADOUT_ITEMS.find((i) => i.key === key);

/** Image path (the original, non-white artwork). */
export const itemImage = (i: LoadoutItem) => encodeURI(`/images/items/${i.group}/${i.name}.webp`);
