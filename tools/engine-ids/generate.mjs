#!/usr/bin/env node
/**
 * Generates shim/src/engine/ids.ts: closed string-literal unions (+ const arrays and name lookups) for the ids the
 * engine contract carries — factions, technologies, planets, tiles, units, cards, leaders, strategy cards, colours,
 * phases — from the AsyncTI4 bot's own data files. Only official content: base, Prophecy of Kings, the Codices and
 * Thunder's Edge (`source` ∈ OFFICIAL_SOURCES); homebrew ids are left out on purpose, so the runtime validator
 * (shim/src/engine/validate.ts) logs them as drift.
 *
 *   node tools/engine-ids/generate.mjs [--bot <bot repo>] [--java <extra java root>]... [--out <file>] [--check]
 *
 * Defaults: --bot /home/user/asyncti4/ti4_map_generator_bot (read-only; data under src/main/resources), --java
 * /home/user/asyncti4/engine-int/src/main/java when it exists (the self-host engine sets phases too), --out
 * shim/src/engine/ids.ts. --check exits 1 when the output would change (CI / drift check). Dependency-free.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");

const OFFICIAL_SOURCES = ["base", "pok", "codex1", "codex2", "codex3", "codex4", "thunders_edge"];

// ---------------------------------------------------------------- args

const args = process.argv.slice(2);
let bot = "/home/user/asyncti4/ti4_map_generator_bot";
let out = join(REPO, "shim/src/engine/ids.ts");
const javaRoots = [];
let check = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--bot") bot = args[++i];
  else if (a === "--out") out = resolve(args[++i]);
  else if (a === "--java") javaRoots.push(args[++i]);
  else if (a === "--check") check = true;
  else {
    console.error(`unknown argument ${a}`);
    process.exit(2);
  }
}
javaRoots.unshift(join(bot, "src/main/java"));
if (!args.includes("--java") && existsSync("/home/user/asyncti4/engine-int/src/main/java")) {
  javaRoots.push("/home/user/asyncti4/engine-int/src/main/java");
}
const RES = join(bot, "src/main/resources");
if (!existsSync(join(RES, "data"))) {
  console.error(`no bot data under ${RES}`);
  process.exit(2);
}

// ---------------------------------------------------------------- reading

function walk(dir, ext) {
  const outFiles = [];
  if (!existsSync(dir)) return outFiles;
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) outFiles.push(...walk(p, ext));
    else if (name.endsWith(ext)) outFiles.push(p);
  }
  return outFiles;
}

/** Every JSON object (top-level object or array element) in a data folder, with the file it came from. */
function records(folder) {
  const recs = [];
  for (const f of walk(join(RES, folder), ".json")) {
    let j;
    try {
      j = JSON.parse(readFileSync(f, "utf8"));
    } catch (e) {
      console.warn(`skip ${relative(RES, f)}: ${e.message}`);
      continue;
    }
    for (const r of Array.isArray(j) ? j : [j]) if (r && typeof r === "object") recs.push(r);
  }
  return recs;
}

const official = (r) => OFFICIAL_SOURCES.includes(r.source);

/** id → display name for the official records of a folder; first record wins on a duplicate id. */
function table(folder, idKey, nameOf = (r) => r.name) {
  const m = new Map();
  for (const r of records(folder)) {
    if (!official(r)) continue;
    const id = r[idKey];
    if (typeof id !== "string" || !id || m.has(id)) continue;
    m.set(id, String(nameOf(r) ?? id));
  }
  return new Map([...m].sort(([a], [b]) => a.localeCompare(b)));
}

// ---------------------------------------------------------------- tables

const factions = table("data/factions", "alias", (r) => r.factionName);
const techs = table("data/technologies", "alias");
const planets = table("planets", "id");
const tiles = table("systems", "id");
const actionCards = table("data/action_cards", "alias");
const agendas = table("data/agendas", "alias");
const publicObjectives = table("data/public_objectives", "alias");
const secretObjectives = table("data/secret_objectives", "alias");
const relics = table("data/relics", "alias");
const explores = table("data/explores", "id");
const leaders = table("data/leaders", "id", (r) => (r.title ? `${r.name} (${r.title})` : r.name));
const unitModels = table("data/units", "id");
const breakthroughs = table("data/breakthroughs", "alias");

// Strategy cards: model ids plus the automation ids the engine resolves them as.
const strategyCards = table("data/strategy_cards", "id");
for (const r of records("data/strategy_cards")) {
  if (official(r) && r.botSCAutomationID && !strategyCards.has(r.botSCAutomationID)) {
    strategyCards.set(r.botSCAutomationID, r.name);
  }
}
const strategyCardNumbers = [
  ...new Set(records("data/strategy_cards").filter(official).map((r) => Number(r.initiative))),
]
  .filter((n) => Number.isInteger(n) && n > 0)
  .sort((a, b) => a - b);

// Unit types (async ids: gf, ff, dd, …) with a readable name taken from the generic unit of that type.
const unitTypes = new Map();
for (const r of records("data/units")) {
  if (!official(r) || !r.asyncId) continue;
  const generic = !r.faction && r.id === r.baseType;
  if (!unitTypes.has(r.asyncId) || generic) unitTypes.set(r.asyncId, generic ? r.name : unitTypes.get(r.asyncId) ?? r.name);
}
const unitTypeMap = new Map(
  [...unitTypes]
    .map(([id, name]) => [id, name.replace(/ I$/, "").replace(/^Factionless /, "")])
    .sort(([a], [b]) => a.localeCompare(b)),
);

// Colours: no `source` field; every colour the bot knows (PlayerState.color / UnitStack.color carry the name).
const colors = new Map();
for (const r of records("data/colors")) if (r.name) colors.set(r.name, r.displayName ?? r.name);
const colorMap = new Map([...colors].sort(([a], [b]) => a.localeCompare(b)));

// Promissory notes: "<color>_xx" notes become `${ColorName}_xx`.
const pnFixed = new Map();
const pnColored = new Map();
for (const r of records("data/promissory_notes")) {
  if (!official(r) || typeof r.alias !== "string") continue;
  if (r.alias.startsWith("<color>_")) pnColored.set(r.alias.slice("<color>_".length), r.name);
  else if (!pnFixed.has(r.alias)) pnFixed.set(r.alias, r.name);
}
const pnFixedMap = new Map([...pnFixed].sort(([a], [b]) => a.localeCompare(b)));
const pnColoredMap = new Map([...pnColored].sort(([a], [b]) => a.localeCompare(b)));

// Small closed vocabularies straight from the data.
const techTypes = new Set();
for (const r of records("data/technologies")) if (official(r)) for (const t of r.types ?? []) techTypes.add(t);
const agendaTypes = new Set(records("data/agendas").filter(official).map((r) => r.type).filter(Boolean));
const leaderTypes = new Set(records("data/leaders").filter(official).map((r) => r.type).filter(Boolean));
const planetTypes = new Set(records("planets").filter(official).map((r) => r.planetType).filter(Boolean));
const fragments = [...explores.keys()].filter((id) =>
  records("data/explores").some((r) => official(r) && r.id === id && r.resolution === "Fragment"),
);

// Phases: every literal the engine passes to Game.setPhaseOfGame (plus "" = a new game, and "finished" = what the
// engine's GameState reports once the game is won or ended, StateSnapshotBuilder.FINISHED).
const phases = new Set(["", "finished"]);
for (const root of javaRoots) {
  for (const f of walk(root, ".java")) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/setPhaseOfGame\(\s*"([^"]*)"\s*\)/g)) phases.add(m[1]);
  }
}

// ---------------------------------------------------------------- rendering

const q = (s) => JSON.stringify(s);
const lines = [];
const emit = (s = "") => lines.push(s);

function wrapList(items, indent = "  ") {
  const outLines = [];
  let cur = indent;
  for (const it of items) {
    const piece = `${it}, `;
    if (cur.length + piece.length > 118 && cur.trim()) {
      outLines.push(cur.trimEnd());
      cur = indent;
    }
    cur += piece;
  }
  if (cur.trim()) outLines.push(cur.trimEnd());
  return outLines.join("\n");
}

const counts = {};
function idSet(constName, typeName, doc, map, { names = true } = {}) {
  const ids = [...map.keys()];
  counts[typeName] = ids.length;
  emit(`/** ${doc} (${ids.length}). */`);
  emit(`export const ${constName} = [\n${wrapList(ids.map(q))}\n] as const;`);
  emit(`export type ${typeName} = (typeof ${constName})[number];`);
  if (names) {
    const namesConst = constName.replace(/_IDS$|S$/, "") + "_NAMES";
    emit(`export const ${namesConst}: Readonly<Record<${typeName}, string>> = {`);
    for (const [id, name] of map) emit(`  ${q(id)}: ${q(name)},`);
    emit(`};`);
  }
  emit();
}

function literalUnion(typeName, doc, values) {
  const vals = [...values].sort();
  counts[typeName] = vals.length;
  emit(`/** ${doc} */`);
  emit(`export const ${typeName.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase()}S = [${vals.map(q).join(", ")}] as const;`);
  emit(`export type ${typeName} = (typeof ${typeName.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase()}S)[number];`);
  emit();
}

emit(`/**`);
emit(` * GENERATED by tools/engine-ids/generate.mjs from the AsyncTI4 bot data (src/main/resources/data, planets, systems)`);
emit(` * — do not edit by hand; rerun the script. Official content only (sources: ${OFFICIAL_SOURCES.join(", ")}).`);
emit(` * Homebrew ids are deliberately absent: the engine may still send them, and shim/src/engine/validate.ts logs`);
emit(` * every id outside these unions (dev/test) so drift shows up instead of silently passing.`);
emit(` * Dependency-free: the web imports it too.`);
emit(` */`);
emit(`/* eslint-disable */`);
emit();
emit(`export const OFFICIAL_SOURCES = [${OFFICIAL_SOURCES.map(q).join(", ")}] as const;`);
emit(`export type OfficialSource = (typeof OFFICIAL_SOURCES)[number];`);
emit();

idSet("FACTION_IDS", "FactionId", "Faction ids (`alias` in data/factions; Keleres drafts as \"keleresm\")", factions);
idSet("TECH_IDS", "TechId", "Technology ids (`alias` in data/technologies; unit upgrades included)", techs);
idSet("PLANET_IDS", "PlanetId", "Planet ids (planets/*.json `id`; also TileState holder names besides \"space\")", planets);
idSet("TILE_IDS", "TileId", "System tile ids (systems/*.json `id`; TileState.tileId, not the board position)", tiles);
idSet("UNIT_IDS", "UnitId", "Unit types as async ids (UnitStack.unit: gf, mf, ff, dd, ca, cv, dn, fs, ws, sd, pd, …)", unitTypeMap);
idSet("UNIT_MODEL_IDS", "UnitModelId", "Unit model ids (data/units `id`: \"arborec_mech\", \"carrier2\", …)", unitModels);
idSet("ACTION_CARD_IDS", "ActionCardId", "Action card ids (`alias` in data/action_cards; copies are numbered: sabo1…)", actionCards);
idSet("AGENDA_IDS", "AgendaId", "Agenda ids (`alias` in data/agendas; laws in play are agenda ids)", agendas);
idSet("PUBLIC_OBJECTIVE_IDS", "PublicObjectiveId", "Public objective ids (`alias` in data/public_objectives)", publicObjectives);
idSet("SECRET_OBJECTIVE_IDS", "SecretObjectiveId", "Secret objective ids (`alias` in data/secret_objectives)", secretObjectives);
idSet("RELIC_IDS", "RelicId", "Relic ids (`alias` in data/relics; includes the \"fake\" relic cards)", relics);
idSet("EXPLORE_CARD_IDS", "ExploreCardId", "Exploration card ids (`id` in data/explores; relic fragments included)", explores);
idSet("LEADER_IDS", "LeaderId", "Leader ids (data/leaders `id`: <faction>agent / commander / hero)", leaders);
idSet("STRATEGY_CARD_IDS", "StrategyCardId", "Strategy card model + automation ids (\"pok4construction\", \"te6warfare\", …)", strategyCards);
idSet("BREAKTHROUGH_IDS", "BreakthroughId", "Thunder's Edge breakthrough ids (`alias` in data/breakthroughs)", breakthroughs);
idSet("COLORS", "ColorName", "Player colour names (data/colors `name`; PlayerState.color, UnitStack.color)", colorMap);

counts.RelicFragmentId = fragments.length;
emit(`/** Relic fragment exploration cards (PlayerState.fragments) (${fragments.length}). */`);
emit(`export const RELIC_FRAGMENT_IDS = [\n${wrapList(fragments.map(q))}\n] as const;`);
emit(`export type RelicFragmentId = (typeof RELIC_FRAGMENT_IDS)[number] & ExploreCardId;`);
emit();

counts.PromissoryNoteId = `${pnFixedMap.size} + ${pnColoredMap.size} × colour`;
emit(`/** Faction promissory notes (fixed ids) (${pnFixedMap.size}). */`);
emit(`export const FACTION_PROMISSORY_NOTE_IDS = [\n${wrapList([...pnFixedMap.keys()].map(q))}\n] as const;`);
emit(`/** Generic promissory notes, one per colour: id = \`<colour name>_<suffix>\` (${pnColoredMap.size}). */`);
emit(`export const COLOR_PROMISSORY_NOTE_SUFFIXES = [${[...pnColoredMap.keys()].map(q).join(", ")}] as const;`);
emit(`export type ColorPromissoryNoteSuffix = (typeof COLOR_PROMISSORY_NOTE_SUFFIXES)[number];`);
emit(`export type PromissoryNoteId =`);
emit(`  | (typeof FACTION_PROMISSORY_NOTE_IDS)[number]`);
emit(`  | \`\${ColorName}_\${ColorPromissoryNoteSuffix}\`;`);
emit(`export const PROMISSORY_NOTE_NAMES: Readonly<Record<(typeof FACTION_PROMISSORY_NOTE_IDS)[number] | ColorPromissoryNoteSuffix, string>> = {`);
for (const [id, name] of pnFixedMap) emit(`  ${q(id)}: ${q(name)},`);
for (const [id, name] of pnColoredMap) emit(`  ${q(id)}: ${q(name)},`);
emit(`};`);
emit();

counts.StrategyCardNumber = strategyCardNumbers.length;
emit(`/** Strategy card initiative numbers. */`);
emit(`export const STRATEGY_CARD_NUMBERS = [${strategyCardNumbers.join(", ")}] as const;`);
emit(`export type StrategyCardNumber = (typeof STRATEGY_CARD_NUMBERS)[number];`);
emit();

literalUnion("TechType", "Technology colour / kind (data/technologies `types`).", techTypes);
literalUnion("AgendaType", "Agenda card type.", agendaTypes);
literalUnion("LeaderType", "Leader card type.", leaderTypes);
literalUnion("PlanetType", "Planet trait / type as the data spells it.", planetTypes);
literalUnion(
  "Phase",
  "Game.phaseOfGame: every literal the engine passes to setPhaseOfGame (\"\" = a new game). Compare case-sensitively; older saves may hold other spellings (validate.ts logs them).",
  phases,
);

emit(`/** "<leaderId>", "<leaderId>:locked" or "<leaderId>:exhausted" (PlayerState.leaders). */`);
emit(`export type LeaderStatus = LeaderId | \`\${LeaderId}:locked\` | \`\${LeaderId}:exhausted\`;`);
emit();

emit(`// ---------------------------------------------------------------- lookups`);
emit();
emit(`const has = (list: readonly string[]) => {`);
emit(`  const set = new Set<string>(list);`);
emit(`  return (x: unknown): boolean => typeof x === "string" && set.has(x);`);
emit(`};`);
emit(`const COLOR_PN = new RegExp(\`^(.+)_(\${COLOR_PROMISSORY_NOTE_SUFFIXES.join("|")})$\`);`);
emit(`const isColorName = has(COLORS);`);
emit(`const isFactionPn = has(FACTION_PROMISSORY_NOTE_IDS);`);
emit();
emit(`/** Membership tests per id family (string in, type guard out). */`);
emit(`export const is = {`);
emit(`  faction: has(FACTION_IDS) as (x: unknown) => x is FactionId,`);
emit(`  tech: has(TECH_IDS) as (x: unknown) => x is TechId,`);
emit(`  planet: has(PLANET_IDS) as (x: unknown) => x is PlanetId,`);
emit(`  tile: has(TILE_IDS) as (x: unknown) => x is TileId,`);
emit(`  unit: has(UNIT_IDS) as (x: unknown) => x is UnitId,`);
emit(`  actionCard: has(ACTION_CARD_IDS) as (x: unknown) => x is ActionCardId,`);
emit(`  agenda: has(AGENDA_IDS) as (x: unknown) => x is AgendaId,`);
emit(`  publicObjective: has(PUBLIC_OBJECTIVE_IDS) as (x: unknown) => x is PublicObjectiveId,`);
emit(`  secretObjective: has(SECRET_OBJECTIVE_IDS) as (x: unknown) => x is SecretObjectiveId,`);
emit(`  relic: has(RELIC_IDS) as (x: unknown) => x is RelicId,`);
emit(`  breakthrough: has(BREAKTHROUGH_IDS) as (x: unknown) => x is BreakthroughId,`);
emit(`  exploreCard: has(EXPLORE_CARD_IDS) as (x: unknown) => x is ExploreCardId,`);
emit(`  relicFragment: has(RELIC_FRAGMENT_IDS) as (x: unknown) => x is RelicFragmentId,`);
emit(`  leader: has(LEADER_IDS) as (x: unknown) => x is LeaderId,`);
emit(`  leaderStatus: ((x: unknown) => typeof x === "string" && has(LEADER_IDS)(x.replace(/:(locked|exhausted)$/, ""))) as (x: unknown) => x is LeaderStatus,`);
emit(`  strategyCard: has(STRATEGY_CARD_IDS) as (x: unknown) => x is StrategyCardId,`);
emit(`  strategyCardNumber: ((x: unknown) => typeof x === "number" && (STRATEGY_CARD_NUMBERS as readonly number[]).includes(x)) as (x: unknown) => x is StrategyCardNumber,`);
emit(`  color: isColorName as (x: unknown) => x is ColorName,`);
emit(`  promissoryNote: ((x: unknown) => {`);
emit(`    if (typeof x !== "string") return false;`);
emit(`    if (isFactionPn(x)) return true;`);
emit(`    const m = COLOR_PN.exec(x);`);
emit(`    return !!m && isColorName(m[1]);`);
emit(`  }) as (x: unknown) => x is PromissoryNoteId,`);
emit(`  phase: has(PHASES) as (x: unknown) => x is Phase,`);
emit(`};`);
emit();
emit(`/** Display name of a promissory note id ("red_sftt" → "Support for the Throne"); the id itself when unknown. */`);
emit(`export function promissoryNoteName(id: string): string {`);
emit(`  const names = PROMISSORY_NOTE_NAMES as Record<string, string>;`);
emit(`  if (names[id]) return names[id];`);
emit(`  const m = COLOR_PN.exec(id);`);
emit(`  return (m && names[m[2]]) || id;`);
emit(`}`);
emit();
emit(`/** Display name of any id in one of the families above (unknown ids come back unchanged). */`);
emit(`export function idName(id: string): string {`);
emit(`  for (const names of [FACTION_NAMES, TECH_NAMES, PLANET_NAMES, ACTION_CARD_NAMES, AGENDA_NAMES, PUBLIC_OBJECTIVE_NAMES, SECRET_OBJECTIVE_NAMES, RELIC_NAMES, EXPLORE_CARD_NAMES, LEADER_NAMES, STRATEGY_CARD_NAMES, UNIT_NAMES] as Record<string, string>[]) {`);
emit(`    const n = names[id];`);
emit(`    if (n) return n;`);
emit(`  }`);
emit(`  const base = id.replace(/:(locked|exhausted)$/, "");`);
emit(`  if (base !== id) return idName(base);`);
emit(`  return promissoryNoteName(id);`);
emit(`}`);

const text = lines.join("\n") + "\n";
if (check) {
  const cur = existsSync(out) ? readFileSync(out, "utf8") : "";
  if (cur !== text) {
    console.error(`${relative(REPO, out)} is stale: rerun node tools/engine-ids/generate.mjs`);
    process.exit(1);
  }
  console.log(`${relative(REPO, out)} up to date`);
} else {
  writeFileSync(out, text);
  console.log(`wrote ${relative(REPO, out)}`);
}
for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`);
