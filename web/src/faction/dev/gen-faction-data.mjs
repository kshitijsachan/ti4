// Regenerates src/faction/data/{official,extended}Data.ts from the bot's resource JSON.
// From web/:  node src/faction/dev/gen-faction-data.mjs [botResourcesDir]
// official = base, PoK, Codex (incl. Keleres variants) and Thunder's Edge factions; extended = every other faction.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../data");
const res = process.argv[2] ?? "/home/user/asyncti4/ti4_map_generator_bot/src/main/resources";
const data = join(res, "data");

const OFFICIAL = new Set(["base", "pok", "codex1", "codex2", "codex3", "codex4", "thunders_edge"]);
const SKIP_FACTIONS = new Set(["neutral", "lazax", "franken"]);

const readDir = (dir) =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => {
      const parsed = JSON.parse(readFileSync(join(dir, f), "utf8"));
      return Array.isArray(parsed) ? parsed : [parsed];
    });

const byKey = (items, key) => {
  const map = new Map();
  for (const item of items) if (!map.has(item[key]) || OFFICIAL.has(item.source)) map.set(item[key], item);
  return map;
};

const pick = (obj, fields) => {
  const slim = {};
  for (const f of fields) {
    const v = obj[f];
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    slim[f] = v;
  }
  return slim;
};

const factions = readDir(join(data, "factions")).filter((f) => !SKIP_FACTIONS.has(f.alias) && !f.alias.startsWith("franken"));
const units = byKey(readDir(join(data, "units")), "id");
const leaders = byKey(readDir(join(data, "leaders")), "id");
const abilities = byKey(readDir(join(data, "abilities")), "id");
const techs = byKey(readDir(join(data, "technologies")), "alias");
const pns = byKey(readDir(join(data, "promissory_notes")), "alias");
const bts = byKey(readDir(join(data, "breakthroughs")), "alias");
const planets = byKey(readDir(join(res, "planets")), "id");
const systems = byKey(readDir(join(res, "systems")), "id");

const UNIT_FIELDS = [
  "id", "baseType", "asyncId", "name", "subtitle", "source", "faction", "upgradesFromUnitId", "upgradesToUnitId",
  "requiredTechId", "cost", "combatHitsOn", "combatDieCount", "moveValue", "capacityValue", "productionValue",
  "basicProduction", "afbHitsOn", "afbDieCount", "bombardHitsOn", "bombardDieCount", "spaceCannonHitsOn",
  "spaceCannonDieCount", "deepSpaceCannon", "sustainDamage", "planetaryShield", "disablesPlanetaryShield",
  "isShip", "isGroundForce", "isStructure", "fleetSupplyBonus", "ability", "homebrewReplacesID",
];
const LEADER_FIELDS = [
  "id", "faction", "type", "name", "title", "abilityName", "abilityWindow", "abilityText", "unlockCondition", "source",
  "homebrewReplacesID",
];
const ABILITY_FIELDS = ["id", "name", "faction", "permanentEffect", "window", "windowEffect", "source"];
const TECH_FIELDS = ["alias", "name", "types", "requirements", "faction", "baseUpgrade", "text", "source", "homebrewReplacesID"];
const PN_FIELDS = ["alias", "name", "faction", "playArea", "text", "source"];
const BT_FIELDS = ["alias", "name", "faction", "synergy", "text", "source"];
const PLANET_FIELDS = ["id", "name", "resources", "influence", "techSpecialties", "legendaryAbilityName", "legendaryAbilityText"];

/** "keleresa" units/leaders are stored under any Keleres alias (or plain "keleres"). */
const familyOf = (alias) => (alias.startsWith("keleres") && alias !== "keleresplus" ? "keleres" : alias);

function build(selected, includeGenerics) {
  const bundle = { factions: {}, units: {}, leaders: {}, abilities: {}, techs: {}, pns: {}, breakthroughs: {}, planets: {} };
  const missing = [];
  const add = (table, map, fields, id, owner) => {
    const item = map.get(id);
    if (!item) {
      missing.push(`${owner}: ${table} ${id}`);
      return false;
    }
    bundle[table][id] = pick(item, fields);
    return true;
  };
  const allowedSource = (src) => !includeGenerics || OFFICIAL.has(src);
  for (const f of selected) {
    const fam = familyOf(f.alias);
    const sameFaction = (item) =>
      item.faction && familyOf(item.faction) === fam && allowedSource(item.source) && !String(item.id ?? item.alias).startsWith("absol_");
    const extraUnits = [...units.values()].filter(sameFaction).map((u) => u.id);
    const extraLeaders = [...leaders.values()].filter(sameFaction).map((l) => l.id);
    const extraTechs = [...techs.values()].filter(sameFaction).map((t) => t.alias);
    const bt = [...bts.values()].find((b) => b.faction && familyOf(b.faction) === fam && allowedSource(b.source));
    const unitIds = new Set([...f.units, ...extraUnits]);
    for (const id of f.units) {
      const upgrade = units.get(id)?.upgradesToUnitId;
      if (upgrade) unitIds.add(upgrade);
    }
    for (const id of unitIds) add("units", units, UNIT_FIELDS, id, f.alias);
    for (const id of new Set([...(f.leaders ?? []), ...extraLeaders])) add("leaders", leaders, LEADER_FIELDS, id, f.alias);
    for (const id of f.abilities ?? []) add("abilities", abilities, ABILITY_FIELDS, id, f.alias);
    for (const id of new Set([...(f.factionTech ?? []), ...(f.startingTech ?? []), ...(f.startingTechOptions ?? []), ...extraTechs]))
      add("techs", techs, TECH_FIELDS, id, f.alias);
    for (const id of f.promissoryNotes ?? []) add("pns", pns, PN_FIELDS, id, f.alias);
    for (const id of f.homePlanets ?? []) add("planets", planets, PLANET_FIELDS, id, f.alias);
    if (bt) bundle.breakthroughs[bt.alias] = pick(bt, BT_FIELDS);
    bundle.factions[f.alias] = {
      ...pick(f, [
        "alias", "factionName", "shortName", "source", "commodities", "homeSystem", "homePlanets", "startingFleet",
        "startingTech", "startingTechOptions", "startingTechAmount", "complexity", "abilities", "leaders",
        "promissoryNotes", "factionTech", "units", "wikiURL",
      ]),
      extraUnits: extraUnits.filter((id) => !f.units.includes(id)),
      extraLeaders: extraLeaders.filter((id) => !(f.leaders ?? []).includes(id)),
      extraTechs: extraTechs.filter((id) => !(f.factionTech ?? []).includes(id)),
      ...(bt ? { breakthrough: bt.alias } : {}),
      ...(systems.get(f.homeSystem)?.imagePath ? { homeTileImage: systems.get(f.homeSystem).imagePath } : {}),
    };
  }
  if (includeGenerics) {
    for (const u of units.values()) if (!u.faction && OFFICIAL.has(u.source)) bundle.units[u.id] = pick(u, UNIT_FIELDS);
    for (const t of techs.values()) if (!t.faction && OFFICIAL.has(t.source)) bundle.techs[t.alias] = pick(t, TECH_FIELDS);
  }
  return { bundle, missing };
}

function write(file, bundle, label) {
  writeFileSync(
    join(out, file),
    `// Generated by src/faction/dev/gen-faction-data.mjs from the bot's resources (${label}). Do not edit.\n` +
      `import type { FactionBundle } from "../types";\n\n` +
      `const data = JSON.parse(${JSON.stringify(JSON.stringify(bundle))}) as FactionBundle;\nexport default data;\n`,
  );
}

const official = factions.filter((f) => OFFICIAL.has(f.source));
const extended = factions.filter((f) => !OFFICIAL.has(f.source));
const a = build(official, true);
const b = build(extended, false);
write("officialData.ts", a.bundle, "base, PoK, Codex, Thunder's Edge");
write("extendedData.ts", b.bundle, "homebrew factions");
console.log("official factions", Object.keys(a.bundle.factions).length, "units", Object.keys(a.bundle.units).length);
console.log("extended factions", Object.keys(b.bundle.factions).length);
if (a.missing.length) console.log("official missing:\n  " + a.missing.join("\n  "));
if (b.missing.length) console.log("extended missing:", b.missing.length);
