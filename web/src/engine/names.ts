import type { GameState } from "./contract";

/**
 * Faction ids as players say them (base, PoK, Codex, Thunder's Edge). The engine only knows ids ("mentak",
 * "keleresm"); the web shows these. Unknown ids (homebrew) are title-cased.
 */
const FACTION_NAMES: Record<string, string> = {
  arborec: "Arborec",
  ghost: "Creuss",
  hacan: "Hacan",
  jolnar: "Jol-Nar",
  l1z1x: "L1Z1X",
  letnev: "Letnev",
  mentak: "Mentak",
  muaat: "Muaat",
  naalu: "Naalu",
  nekro: "Nekro",
  saar: "Saar",
  sardakk: "Sardakk N'orr",
  sol: "Sol",
  winnu: "Winnu",
  xxcha: "Xxcha",
  yin: "Yin",
  yssaril: "Yssaril",
  argent: "Argent Flight",
  cabal: "Vuil'raith",
  empyrean: "Empyrean",
  mahact: "Mahact",
  nomad: "Nomad",
  naaz: "Naaz-Rokha",
  titans: "Titans of Ul",
  keleres: "Keleres",
  keleresm: "Keleres",
  keleresx: "Keleres",
  keleresa: "Keleres",
  bastion: "Last Bastion",
  deepwrought: "Deepwrought",
  firmament: "Firmament",
  obsidian: "Obsidian",
  crimson: "Crimson Rebellion",
  ralnel: "Ral Nel",
  neutral: "Neutral",
};

/** "mentak" → "Mentak"; "keleresm" → "Keleres"; null/empty → "". */
export function factionName(id: string | null | undefined): string {
  if (!id) return "";
  const key = id.toLowerCase();
  return FACTION_NAMES[key] ?? key.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * A player as the table knows them: "Alice (Mentak)", or just the faction / name when one is missing. Accepts a
 * user id or a faction id (renderers get either from the engine).
 */
export function playerLabel(state: GameState | null | undefined, who: string | null | undefined): string {
  if (!who) return "someone";
  const p = state?.players.find((x) => x.userId === who || x.faction === who);
  if (!p) return factionName(who) || who;
  const faction = factionName(p.faction);
  const name = p.userName && p.userName !== "null" ? p.userName : "";
  if (name && faction) return `${name} (${faction})`;
  return name || faction || who;
}
