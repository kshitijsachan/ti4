/*
 * Generic technologies the planner knows (the bot's aliases): colour and prerequisites, from the bot's
 * data/technologies/pok.json. The bot does not check prerequisites when a player picks a technology, so the planner
 * only researches what this table says is legal. Faction technologies are left alone (their colours are unknown here).
 */

export type TechInfo = { alias: string; color: "B" | "G" | "Y" | "R" | "U"; reqs: string; name: string };

const LIST: TechInfo[] = [
  { alias: "amd", color: "B", reqs: "", name: "Antimass Deflectors" },
  { alias: "gd", color: "B", reqs: "B", name: "Gravity Drive" },
  { alias: "fl", color: "B", reqs: "BB", name: "Fleet Logistics" },
  { alias: "lwd", color: "B", reqs: "BBB", name: "Light/Wave Deflector" },
  { alias: "det", color: "B", reqs: "", name: "Dark Energy Tap" },
  { alias: "sr", color: "B", reqs: "B", name: "Sling Relay" },
  { alias: "nm", color: "G", reqs: "", name: "Neural Motivator" },
  { alias: "dxa", color: "G", reqs: "G", name: "Dacxive Animators" },
  { alias: "hm", color: "G", reqs: "GG", name: "Hyper Metabolism" },
  { alias: "x89_base", color: "G", reqs: "GGG", name: "X-89 Bacterial Weapon" },
  { alias: "pa", color: "G", reqs: "", name: "Psychoarchaeology" },
  { alias: "bs", color: "G", reqs: "G", name: "Bio-Stims" },
  { alias: "ps", color: "R", reqs: "", name: "Plasma Scoring" },
  { alias: "md_base", color: "R", reqs: "R", name: "Magen Defense Grid" },
  { alias: "md", color: "R", reqs: "R", name: "Magen Defense Grid" },
  { alias: "da", color: "R", reqs: "RR", name: "Duranium Armor" },
  { alias: "asc", color: "R", reqs: "RRR", name: "Assault Cannon" },
  { alias: "aida", color: "R", reqs: "", name: "AI Development Algorithm" },
  { alias: "sar", color: "R", reqs: "R", name: "Self-Assembly Routines" },
  { alias: "st", color: "Y", reqs: "", name: "Sarween Tools" },
  { alias: "gls", color: "Y", reqs: "Y", name: "Graviton Laser System" },
  { alias: "td", color: "Y", reqs: "YY", name: "Transit Diodes" },
  { alias: "ie", color: "Y", reqs: "YYY", name: "Integrated Economy" },
  { alias: "sdn", color: "Y", reqs: "", name: "Scanlink Drone Network" },
  { alias: "pi", color: "Y", reqs: "Y", name: "Predictive Intelligence" },
  { alias: "ws", color: "U", reqs: "RRRY", name: "War Sun" },
  { alias: "sd2", color: "U", reqs: "YY", name: "Space Dock II" },
  { alias: "cr2", color: "U", reqs: "GYR", name: "Cruiser II" },
  { alias: "dn2", color: "U", reqs: "BBY", name: "Dreadnought II" },
  { alias: "dd2", color: "U", reqs: "RR", name: "Destroyer II" },
  { alias: "pds2", color: "U", reqs: "RY", name: "PDS II" },
  { alias: "cv2", color: "U", reqs: "BB", name: "Carrier II" },
  { alias: "ff2", color: "U", reqs: "GB", name: "Fighter II" },
  { alias: "inf2", color: "U", reqs: "GG", name: "Infantry II" },
];

export const TECHS = new Map(LIST.map((t) => [t.alias, t]));

/** Research order of preference for a simple expanding player (economy and movement first). */
export const TECH_PREFERENCE = ["gd", "st", "nm", "amd", "sdn", "ps", "aida", "dxa", "cv2", "pa", "sar", "fl", "hm", "dd2", "gls", "pi", "ff2", "inf2", "md_base", "md", "bs", "det", "sr", "da", "cr2", "dn2", "td", "lwd", "x89_base", "asc", "ie", "sd2", "pds2", "ws"];

/** Whether `alias` has its prerequisites met by `owned` (technology skips on planets are not counted). */
export function researchable(alias: string, owned: string[]): boolean {
  const t = TECHS.get(alias);
  if (!t || owned.includes(alias)) return false;
  const have: Record<string, number> = {};
  for (const o of owned) {
    const c = TECHS.get(o)?.color;
    if (c && c !== "U") have[c] = (have[c] ?? 0) + 1;
  }
  const need: Record<string, number> = {};
  for (const ch of t.reqs) need[ch] = (need[ch] ?? 0) + 1;
  return Object.entries(need).every(([c, n]) => (have[c] ?? 0) >= n);
}

/** The best technology to research next, if any. */
export function nextTech(owned: string[]): string | undefined {
  return TECH_PREFERENCE.find((a) => researchable(a, owned));
}

const TYPE_LABEL: Record<string, RegExp> = { B: /propulsion/i, G: /biotic/i, Y: /cybernetic/i, R: /warfare/i, U: /unit/i };

export function typeLabelOf(alias: string): RegExp | undefined {
  const c = TECHS.get(alias)?.color;
  return c ? TYPE_LABEL[c] : undefined;
}
