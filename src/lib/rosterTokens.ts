/** Icons that can be dropped onto a rostered player. A player may only carry one if they have confirmed the matching loadout unlock. */
export interface RosterToken {
  key: "defib" | "sniper" | "maaws" | "rockets" | "havoc";
  label: string;
  /** Loadout item (see loadout.ts) the player must have confirmed. */
  requires: string;
  /** Discord emoji shown next to the player on the published roster. */
  emoji: string;
  image: string;
}

export const ROSTER_TOKENS: readonly RosterToken[] = [
  { key: "defib", label: "Defib", requires: "Defibrillator", emoji: "<:Defibrillator:1566378189054410933>", image: "/images/items/loadout/white/Defibrillator.webp" },
  { key: "sniper", label: "Sniper", requires: "SV98", emoji: "<:sniper:1388568893206958172>", image: "/images/items/loadout/white/sniper.png" },
  { key: "maaws", label: "MAAWs", requires: "MAAWs", emoji: "<:MAAWs:1566378198751518791>", image: "/images/items/loadout/white/MAAWs.webp" },
  { key: "rockets", label: "AH-6R Rockets", requires: "AH6RRockets", emoji: "<:AH6RRockets:1566378098096734318>", image: encodeURI("/images/items/vehicles/white/AH-6R - Rockets.webp") },
  { key: "havoc", label: "Havoc", requires: "Havoc", emoji: "<:Havoc:1566378102135984260>", image: "/images/items/vehicles/white/Havoc.webp" },
];

export const TOKEN_KEYS = ROSTER_TOKENS.map((t) => t.key) as [RosterToken["key"], ...RosterToken["key"][]];
export const tokenByKey = (key: string) => ROSTER_TOKENS.find((t) => t.key === key);
