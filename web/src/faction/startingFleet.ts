const UNIT_NAMES: Record<string, [string, string]> = {
  cv: ["Carrier", "Carriers"],
  ca: ["Cruiser", "Cruisers"],
  cr: ["Cruiser", "Cruisers"],
  ff: ["Fighter", "Fighters"],
  fighter: ["Fighter", "Fighters"],
  dd: ["Destroyer", "Destroyers"],
  dn: ["Dreadnought", "Dreadnoughts"],
  inf: ["Infantry", "Infantry"],
  gf: ["Infantry", "Infantry"],
  mf: ["Mech", "Mechs"],
  mech: ["Mech", "Mechs"],
  fs: ["Flagship", "Flagships"],
  ws: ["War Sun", "War Suns"],
  pds: ["PDS", "PDS"],
  pd: ["PDS", "PDS"],
  sd: ["Space Dock", "Space Docks"],
};

/** "cv, cr,2 ff, 4 inf n,pds n, sd n" → "1 Carrier, 1 Cruiser, 2 Fighters, 4 Infantry, 1 PDS, 1 Space Dock". */
export function formatStartingFleet(raw?: string): string | undefined {
  if (!raw) return undefined;
  const parts = raw
    .split(",")
    .map((p) => p.trim().split(/\s+/))
    .filter((t) => t[0])
    .map((tokens) => {
      const count = /^\d+$/.test(tokens[0]) ? Number(tokens.shift()) : 1;
      const name = UNIT_NAMES[tokens[0]?.toLowerCase() ?? ""];
      if (!name) return tokens.join(" ");
      return `${count} ${count === 1 ? name[0] : name[1]}`;
    });
  return parts.join(", ");
}
