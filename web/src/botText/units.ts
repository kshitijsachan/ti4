/** Unit names and the bot's unit emoji, by async unit id. */

export const UNIT_NAME: Record<string, [string, string]> = {
  ws: ["War Sun", "War Suns"],
  fs: ["Flagship", "Flagships"],
  dn: ["Dreadnought", "Dreadnoughts"],
  ca: ["Cruiser", "Cruisers"],
  cv: ["Carrier", "Carriers"],
  dd: ["Destroyer", "Destroyers"],
  ff: ["Fighter", "Fighters"],
  mf: ["Mech", "Mechs"],
  gf: ["Infantry", "Infantry"],
  pd: ["PDS", "PDS"],
  sd: ["Space Dock", "Space Docks"],
};

/** The bot's unit emoji names ("<:dreadnought:…>") → async ids. */
export const EMOJI_UNIT: Record<string, string> = {
  warsun: "ws",
  flagship: "fs",
  dreadnought: "dn",
  cruiser: "ca",
  carrier: "cv",
  destroyer: "dd",
  fighter: "ff",
  mech: "mf",
  infantry: "gf",
  pds: "pd",
  spacedock: "sd",
};

export function unitName(id: string, n = 1) {
  const names = UNIT_NAME[id];
  if (!names) return id;
  return n === 1 ? names[0] : names[1];
}

/** "2 Dreadnoughts", "1 Infantry". */
export function countName(id: string, n: number) {
  return `${n} ${unitName(id, n)}`;
}
