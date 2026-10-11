/*
 * Rules / state invariants over game snapshots. A snapshot carries the bot's web data (GET /api/public/game/{g}/web-data,
 * what every client renders) and/or the raw save text (maps/<game>.txt or an undo copy); each check uses what is there.
 *
 *   checkSnapshot(s)        invariants of one state
 *   checkSequence(states)   invariants between consecutive states (VP, round, phase, techs, ...)
 *
 * Severity: "error" = the state is impossible under the rules / internally inconsistent; "warn" = suspicious but
 * legitimately reachable in edge cases (mid-movement fleet supply, homebrew abilities, ...). Usable as a library by
 * fuzzers: no I/O here except the optional unit-model table read from the bot's resources.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BOT_RESOURCES, type Json } from "./env.ts";
import { normalizeSave, parseSave, type ParsedSave } from "./savefile.ts";

export type Severity = "error" | "warn";
export type Violation = { id: string; severity: Severity; message: string; player?: string; snapshot?: string | number };
export type Snapshot = {
  /** label for reports: undo index, "live", ... */
  id: string | number;
  savedAt?: number;
  /** the action that produced this state (latest_command) */
  label?: string;
  web?: Json | null;
  save?: string | null;
};

/* ---------------------------------------------------------------------------------------------------------------- */

const PHASES_SETUP = new Set(["", "miltydraft", "playerSetup", "setup", "draft", "franken", "frankenDraft"]);
const KNOWN_PHASES = new Set([
  ...PHASES_SETUP,
  "strategy",
  "action",
  "statusScoring",
  "statusHomework",
  "status",
  "agenda",
  "agendawaiting",
  "agendaVoting",
  "agendaEnd",
  "finished",
]);

/** Legal phase changes (same phase is always fine). `+1` = the round must advance by one on that edge. */
export const PHASE_EDGES: Record<string, Record<string, 0 | 1>> = {
  "": { miltydraft: 0, playerSetup: 0, strategy: 0 },
  miltydraft: { playerSetup: 0 },
  playerSetup: { strategy: 0 },
  strategy: { action: 0 },
  action: { statusScoring: 0 },
  statusScoring: { statusHomework: 0 },
  statusHomework: { strategy: 1, agenda: 0, agendawaiting: 0 },
  agenda: { agendawaiting: 0, agendaVoting: 0 },
  agendawaiting: { agendaVoting: 0 },
  agendaVoting: { agendaEnd: 0 },
  agendaEnd: { agendawaiting: 0, agendaVoting: 0, strategy: 1 },
};

/** Changes that skip a step the bot sometimes does not save on its own (e.g. nobody can score: no statusScoring save). */
export const SOFT_EDGES = new Set(["action>statusHomework", "statusHomework>agendaVoting"]);

let unitModels: Map<string, Json> | null = null;
/** Unit models (capacity etc.) from the bot's resources, keyed by model id; empty if the resources are not there. */
export function units(): Map<string, Json> {
  if (unitModels) return unitModels;
  unitModels = new Map();
  const dir = join(BOT_RESOURCES, "data", "units");
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      try {
        for (const u of JSON.parse(readFileSync(join(dir, f), "utf8"))) unitModels.set(u.id, u);
      } catch {
        /* skip a bad file */
      }
    }
  }
  return unitModels;
}

/** The web data's canonical phase (WebGameState.CanonicalPhase) as the bot's raw phase_of_game. */
export const WEB_PHASES: Record<string, string> = {
  "setup.draft": "miltydraft",
  "setup.players": "playerSetup",
  strategy: "strategy",
  action: "action",
  "status.scoring": "statusScoring",
  "status.homework": "statusHomework",
  "agenda.readyToFlip": "agenda",
  "agenda.whens": "agendawaiting",
  "agenda.afters": "agendawaiting",
  "agenda.voting": "agendaVoting",
  "agenda.resolving": "agendaEnd",
  finished: "finished",
  unknown: "",
};
export const webPhase = (web: Json) => {
  const p = String(web.gameState?.phase ?? "");
  return WEB_PHASES[p] ?? p;
};

const realPlayers = (web: Json) =>
  ((web.playerData ?? []) as Json[]).filter((p) => p.faction && p.faction !== "neutral" && p.faction !== "null" && !p.eliminated);
const inSetup = (phase: string) => PHASES_SETUP.has(phase);
const num = (x: unknown) => (typeof x === "number" ? x : Number(x ?? 0));

/** Every unit stack on the board as {faction, where, id, count}. */
function boardUnits(web: Json): { faction: string; tile: string; where: "space" | string; id: string; count: number }[] {
  const out: { faction: string; tile: string; where: string; id: string; count: number }[] = [];
  for (const [tile, t] of Object.entries((web.tileUnitData ?? {}) as Record<string, Json>)) {
    for (const [faction, list] of Object.entries((t.space ?? {}) as Record<string, Json[]>))
      for (const e of list) if (e.entityType === "unit") out.push({ faction, tile, where: "space", id: e.entityId, count: num(e.count) });
    for (const [planet, pl] of Object.entries((t.planets ?? {}) as Record<string, Json>))
      for (const [faction, list] of Object.entries((pl.entities ?? {}) as Record<string, Json[]>))
        for (const e of list) if (e.entityType === "unit") out.push({ faction, tile, where: planet, id: e.entityId, count: num(e.count) });
  }
  return out;
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* One snapshot                                                                                                       */
/* ---------------------------------------------------------------------------------------------------------------- */

export function checkSnapshot(s: Snapshot): Violation[] {
  const v: Violation[] = [];
  const add = (id: string, severity: Severity, message: string, player?: string) => v.push({ id, severity, message, player, snapshot: s.id });
  const parsed = s.save ? parseSave(s.save) : null;
  // The game's own setting wins over the rule-book default (e.g. `/game sc_count` for 5 players with 2 cards each).
  const scCount = Number(parsed?.game.get("sc_count_for_map") ?? NaN);
  if (s.web) checkWeb(s.web, add, { scCount: Number.isFinite(scCount) && scCount > 0 ? scCount : undefined });
  if (parsed) checkSave(parsed, s.web ?? null, add);
  return v;
}

type Add = (id: string, severity: Severity, message: string, player?: string) => void;

function checkWeb(web: Json, add: Add, ctx: { scCount?: number } = {}) {
  const phase = webPhase(web);
  const players = realPlayers(web);
  const setup = inSetup(phase);
  if (!KNOWN_PHASES.has(phase)) add("phase.known", "warn", `unknown phase "${phase}"`);

  // -- identity: one faction and one colour each, all distinct --
  if (!setup) {
    const seen = new Map<string, string>();
    for (const p of players) {
      if (!p.color || p.color === "null") add("identity.color", "error", `${p.faction} has no colour`, p.faction);
      for (const key of ["faction", "color"]) {
        const k = `${key}:${p[key]}`;
        if (seen.has(k)) add(`identity.${key}-unique`, "error", `${key} ${p[key]} is used by two players (${seen.get(k)} and ${p.userName})`, p.faction);
        seen.set(k, p.userName);
      }
    }
    const ids = new Map<string, number>();
    for (const p of players) ids.set(p.discordId, (ids.get(p.discordId) ?? 0) + 1);
    for (const [id, n] of ids) if (n > 1 && id) add("identity.seat-unique", "warn", `user ${id} plays ${n} factions`);
  }

  // -- speaker --
  if (!setup && players.length) {
    const speakers = players.filter((p) => p.isSpeaker);
    if (speakers.length !== 1)
      add("speaker.exactly-one", "error", `${speakers.length} speakers (${speakers.map((p) => p.faction).join(", ") || "none"})`);
  }

  // -- command tokens --
  const ccOnBoard = new Map<string, number>();
  for (const t of Object.values((web.tileUnitData ?? {}) as Record<string, Json>)) for (const c of t.ccs ?? []) ccOnBoard.set(c, (ccOnBoard.get(c) ?? 0) + 1);
  for (const p of players) {
    for (const pool of ["tacticalCC", "fleetCC", "strategicCC"])
      if (num(p[pool]) < 0) add("cc.pool-nonnegative", "error", `${pool} = ${p[pool]}`, p.faction);
    const captured = p.faction === "mahact" ? (p.mahactEdict ?? []).length : 0;
    const pools = num(p.tacticalCC) + num(p.fleetCC) - captured + num(p.strategicCC);
    const board = ccOnBoard.get(p.color) ?? 0;
    if (pools + board > 16)
      add("cc.total-at-most-16", "error", `${pools} in pools + ${board} on the board = ${pools + board} > 16 command tokens`, p.faction);
    if (p.ccReinf !== undefined && num(p.ccReinf) < 0) add("cc.reinforcements-nonnegative", "error", `ccReinf = ${p.ccReinf}`, p.faction);
  }

  // -- trade goods / commodities --
  for (const p of players) {
    if (num(p.tg) < 0) add("tg.nonnegative", "error", `tg = ${p.tg}`, p.faction);
    if (num(p.commodities) < 0) add("commodities.nonnegative", "error", `commodities = ${p.commodities}`, p.faction);
    if (p.commoditiesTotal !== undefined && num(p.commodities) > num(p.commoditiesTotal))
      add("commodities.at-most-max", "error", `commodities ${p.commodities} > faction max ${p.commoditiesTotal}`, p.faction);
    if (num(p.fragments?.length ?? 0) < 0) add("fragments", "error", "negative fragments", p.faction);
  }

  // -- planets / techs --
  const owner = new Map<string, string>();
  for (const p of players) {
    const planets = new Set<string>(p.planets ?? []);
    if (planets.size !== (p.planets ?? []).length) add("planets.no-duplicates", "error", `planet listed twice: ${dupes(p.planets)}`, p.faction);
    for (const x of p.exhaustedPlanets ?? []) if (!planets.has(x)) add("planets.exhausted-subset", "error", `exhausted planet ${x} is not controlled`, p.faction);
    for (const x of planets) {
      if (owner.has(x)) add("planets.single-owner", "error", `planet ${x} controlled by ${owner.get(x)} and ${p.faction}`, p.faction);
      owner.set(x, p.faction);
    }
    const techs = new Set<string>(p.techs ?? []);
    if (techs.size !== (p.techs ?? []).length) add("techs.no-duplicates", "error", `technology listed twice: ${dupes(p.techs)}`, p.faction);
    for (const x of p.exhaustedTechs ?? []) if (!techs.has(x)) add("techs.exhausted-subset", "error", `exhausted tech ${x} is not owned`, p.faction);
  }
  // Planet tiles agree with the players' planet lists.
  for (const t of Object.values((web.tileUnitData ?? {}) as Record<string, Json>)) {
    for (const [planet, pl] of Object.entries((t.planets ?? {}) as Record<string, Json>)) {
      const by = pl.controlledBy;
      if (by && by !== "neutral" && owner.get(planet) && owner.get(planet) !== by)
        add("planets.board-agrees", "error", `map says ${planet} is controlled by ${by}, player data says ${owner.get(planet)}`);
      if (by && players.some((p) => p.faction === by) && !owner.has(planet))
        add("planets.board-agrees", "error", `map says ${planet} is controlled by ${by}, but no player lists it`);
    }
  }

  // -- strategy cards --
  if (!setup && players.length) {
    const allowed = ctx.scCount ?? (players.length <= 4 ? 2 : 1);
    const scHolder = new Map<number, string>();
    for (const p of players) {
      const scs: number[] = p.scs ?? [];
      if (scs.length > allowed) add("sc.count", "error", `holds ${scs.length} strategy cards (${scs.join(",")}), ${ctx.scCount ? "the game's sc_count_for_map allows" : `${players.length} players allow`} ${allowed}`, p.faction);
      for (const sc of scs) {
        if (scHolder.has(sc)) add("sc.unique", "error", `strategy card ${sc} held by ${scHolder.get(sc)} and ${p.faction}`, p.faction);
        scHolder.set(sc, p.faction);
      }
    }
    for (const sc of (web.strategyCards ?? []) as Json[]) {
      const holder = [...scHolder.entries()].find(([n]) => n === sc.initiative)?.[1];
      if (sc.picked && sc.pickedByFaction && holder && sc.pickedByFaction !== holder)
        add("sc.picked-agrees", "error", `strategy card ${sc.initiative} picked by ${sc.pickedByFaction} but held by ${holder}`);
      if (num(sc.tradeGoods) < 0) add("sc.tradegoods-nonnegative", "error", `strategy card ${sc.initiative} has ${sc.tradeGoods} trade goods`);
    }
    if (phase === "action") for (const p of players) if (!(p.scs ?? []).length) add("sc.action-phase-holds-one", "warn", "has no strategy card in the action phase", p.faction);
  }

  // -- victory points --
  for (const p of players) {
    const entries: Json[] = web.scoreBreakdowns?.[p.faction]?.entries ?? [];
    if (entries.length) {
      const sum = entries.filter((e) => e.state === "SCORED").reduce((a, e) => a + num(e.pointValue), 0);
      if (sum !== num(p.totalVps)) add("vp.equals-sources", "error", `totalVps ${p.totalVps} but scored sources add up to ${sum}`, p.faction);
    }
    if (num(p.totalVps) < 0) add("vp.nonnegative", "error", `totalVps ${p.totalVps}`, p.faction);
    if (web.vpsToWin && num(p.totalVps) > num(web.vpsToWin) + 2) add("vp.beyond-target", "warn", `${p.totalVps} VP with ${web.vpsToWin} to win`, p.faction);
  }
  for (const o of (web.objectives?.allObjectives ?? []) as Json[]) {
    const sf: string[] = o.scoredFactions ?? [];
    if (!o.multiScoring && new Set(sf).size !== sf.length) add("objectives.scored-once", "error", `${o.key} scored twice by the same faction (${sf.join(",")})`);
    if (sf.length && !o.revealed && !String(o.key).startsWith("UNREVEALED")) add("objectives.scored-revealed", "warn", `${o.key} scored but not revealed`);
  }

  // -- secret objectives --
  for (const p of players) {
    const scored = Object.keys(p.secretsScored ?? {}).length;
    const max = num(p.numScoreableSecrets ?? 3);
    if (scored > max) add("secrets.scored-at-most-max", "error", `${scored} secrets scored, max ${max}`, p.faction);
    if (num(p.soCount) + scored > max + 1) add("secrets.held-at-most-max", "warn", `${p.soCount} held + ${scored} scored > ${max}`, p.faction);
  }

  // -- units: reinforcements, counts, fleet supply, capacity --
  const stacks = boardUnits(web);
  for (const p of players) {
    const mine = stacks.filter((u) => u.faction === p.faction);
    for (const [uid, c] of Object.entries((p.unitCounts ?? {}) as Record<string, Json>)) {
      const onBoard = mine.filter((u) => u.id === uid).reduce((a, u) => a + u.count, 0);
      const cap = num(c.unitCap);
      const deployed = num(c.deployedCount);
      if (cap > 0 && deployed > cap)
        add("units.within-component-limit", uid === "ff" || uid === "gf" ? "warn" : "error", `${deployed} ${uid} deployed, component limit ${cap}`, p.faction);
      // Fighters and infantry are counted as tokens/stacks by the bot, not as units.
      if (deployed < onBoard && !["ff", "gf", "mf"].includes(uid))
        add("units.count-agrees", "warn", `unitCounts says ${deployed} ${uid} deployed, board has ${onBoard}`, p.faction);
    }
    if (setup || !units().size) continue;
    const owned = new Map<string, Json>();
    for (const id of p.unitsOwned ?? []) {
      const m = units().get(id);
      if (m?.asyncId) owned.set(m.asyncId, m);
    }
    const tiles = new Set(mine.filter((u) => u.where === "space").map((u) => u.tile));
    for (const tile of tiles) {
      const space = mine.filter((u) => u.tile === tile && u.where === "space");
      let capacity = 0;
      let ships = 0;
      let fighters = 0;
      let ground = 0;
      for (const u of space) {
        const m = owned.get(u.id);
        if (u.id === "ff") fighters += u.count;
        else if (u.id === "gf" || u.id === "mf") ground += u.count;
        else if (m?.isShip) ships += u.count;
        capacity += num(m?.capacityValue) * u.count;
      }
      const excessFighters = Math.max(0, fighters - capacity);
      const nonFighterSupply = ships + excessFighters;
      // Fleet supply may be exceeded mid-move; the rules only enforce it at specific timings.
      if (num(p.fleetCC) >= 0 && nonFighterSupply > num(p.fleetCC) && !/nomad|letnev/.test(p.faction))
        add("fleet.supply", "warn", `system ${tile}: ${ships} ships${excessFighters ? ` + ${excessFighters} unsupported fighters` : ""} > fleet pool ${p.fleetCC}`, p.faction);
      if (fighters + ground > capacity && ground > 0 && !/naalu|titans|nekro/.test(p.faction))
        add("capacity.space", "warn", `system ${tile}: ${fighters} fighters + ${ground} ground forces in space, capacity ${capacity}`, p.faction);
    }
  }

  // -- active player --
  const active = web.gameState?.activePlayer;
  if (phase === "action" && active && !players.some((p) => p.color === active || p.faction === active))
    add("turn.active-is-player", "error", `active player ${active} is not a player`);
  if (phase === "action" && active) {
    const ap = players.find((p) => p.color === active || p.faction === active);
    if (ap?.passed && players.some((p) => !p.passed)) add("turn.active-not-passed", "warn", `active player ${ap.faction} has passed while others have not`, ap.faction);
  }
}

function dupes(list: string[] = []) {
  const seen = new Set<string>();
  return [...new Set(list.filter((x) => (seen.has(x) ? true : (seen.add(x), false))))].join(",");
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* Raw save: card zones                                                                                               */
/* ---------------------------------------------------------------------------------------------------------------- */

/** "a,b,c" or "a,12;b,7;" (card id with its number) -> ids */
export function cardIds(v: string | undefined): string[] {
  if (!v) return [];
  if (v.includes(";")) return v.split(";").filter(Boolean).map((e) => e.split(",")[0]).filter(Boolean);
  return v.split(",").map((x) => x.trim()).filter(Boolean);
}

function checkSave(p: ParsedSave, web: Json | null, add: Add) {
  const g = p.game;
  // -- content: web (self-hosted) games are official-only (bot ti4.selfhost.WebContent; TI4_OFFICIAL_ONLY) --
  for (const flag of homebrewFlags(g)) add("content.no-homebrew", "error", `homebrew / alternate mode on: ${flag}`);
  const real = p.players.filter((x) => x.kv.get("faction") && x.kv.get("faction") !== "null" && x.kv.get("faction") !== "neutral");
  const zoneCheck = (kind: string, zones: [string, string[]][], fullSize?: number) => {
    const where = new Map<string, string>();
    let total = 0;
    for (const [zone, ids] of zones) {
      total += ids.length;
      for (const id of ids) {
        if (where.has(id)) add(`cards.${kind}-unique`, "error", `${kind} card ${id} is both in ${where.get(id)} and in ${zone}`);
        else where.set(id, zone);
      }
    }
    if (fullSize && total > fullSize) add(`cards.${kind}-conserved`, "error", `${total} ${kind} cards across zones, deck has ${fullSize}`);
    return total;
  };
  zoneCheck(
    "action",
    [
      ["deck", cardIds(g.get("action_cards"))],
      ["discard", cardIds(g.get("action_cards_discarded"))],
      ["purged", cardIds(g.get("action_cards_purged"))],
      ...real.map((x) => [`${x.kv.get("faction")}'s hand`, cardIds(x.kv.get("action_cards"))] as [string, string[]]),
    ],
    web?.cardPool?.actionCardFullDeckSize,
  );
  zoneCheck(
    "secret",
    [
      ["deck", cardIds(g.get("secret_objectives"))],
      ...real.map((x) => [`${x.kv.get("faction")}'s hand`, cardIds(x.kv.get("secret_objectives"))] as [string, string[]]),
      ...real.map((x) => [`${x.kv.get("faction")}'s scored`, cardIds(x.kv.get("secret_objectives_scored"))] as [string, string[]]),
    ],
    // Monuments mode shuffles its 2 secrets (dagw, tam) into the deck; the web data's size is the deck model's.
    web?.cardPool?.secretObjectiveFullDeckSize && g.get("monuments_mode") === "true"
      ? web.cardPool.secretObjectiveFullDeckSize + 2
      : web?.cardPool?.secretObjectiveFullDeckSize,
  );
  zoneCheck(
    "agenda",
    [
      ["deck", cardIds(g.get("agendas"))],
      ["discard", cardIds(g.get("discarded_agendas"))],
      ["laws", cardIds(g.get("law"))],
    ],
    web?.cardPool?.agendaFullDeckSize,
  );
  zoneCheck("relic", [
    ["deck", cardIds(g.get("relics"))],
    ...real.map((x) => [`${x.kv.get("faction")}'s relics`, cardIds(x.kv.get("relics"))] as [string, string[]]),
  ]);
  zoneCheck("explore", [
    ["deck", cardIds(g.get("explore"))],
    ["discard", cardIds(g.get("discarded_explores"))],
  ]);
  // Promissory notes: each in exactly one hand or play area (or purged).
  const pnWhere = new Map<string, string>();
  for (const x of real) {
    for (const [zone, key] of [
      ["hand", "promissory_notes"],
      ["play area", "promissory_notes_play_area"],
    ]) {
      for (const id of cardIds(x.kv.get(key))) {
        const here = `${x.kv.get("faction")}'s ${zone}`;
        if (pnWhere.has(id)) add("cards.promissory-unique", "error", `promissory note ${id} is both in ${pnWhere.get(id)} and in ${here}`);
        pnWhere.set(id, here);
      }
    }
  }
  for (const id of cardIds(g.get("purged_pn"))) if (pnWhere.has(id)) add("cards.promissory-unique", "error", `purged promissory note ${id} is still in ${pnWhere.get(id)}`);
  // Owned notes are somewhere (unless purged).
  const purged = new Set(cardIds(g.get("purged_pn")));
  for (const x of real) for (const id of cardIds(x.kv.get("promissory_notes_owned"))) {
    if (!pnWhere.has(id) && !purged.has(id) && !inSetup(g.get("phase_of_game") ?? ""))
      add("cards.promissory-somewhere", "warn", `${x.kv.get("faction")}'s promissory note ${id} is in no hand, play area or purge`, x.kv.get("faction"));
  }
  // Game.setOwnerID cuts ids to 18 characters; 19-digit snowflakes (all of the shim's, and newer Discord accounts)
  // then name nobody, so owner-only actions fail for the game's creator.
  if (p.ownerId && !p.players.some((x) => x.userId === p.ownerId) && p.players.some((x) => x.userId.startsWith(p.ownerId) && x.userId !== p.ownerId))
    add("identity.owner-id-intact", "warn", `owner id ${p.ownerId} is a truncated player id (${p.players.find((x) => x.userId.startsWith(p.ownerId))!.userId})`);
  const speaker = g.get("speaker");
  if (!inSetup(g.get("phase_of_game") ?? "") && real.length && speaker && !p.players.some((x) => x.userId === speaker))
    add("speaker.is-player", "error", `speaker ${speaker} is not a player in the game`);
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* Between snapshots                                                                                                  */
/* ---------------------------------------------------------------------------------------------------------------- */

type Facts = { phase: string; round: number; vps: Map<string, number>; losable: Map<string, number>; techs: Map<string, Set<string>>; secretsScored: Map<string, number>; rewind: boolean };

function facts(s: Snapshot): Facts | null {
  let phase = "";
  let round = 0;
  const vps = new Map<string, number>();
  const losable = new Map<string, number>();
  const techs = new Map<string, Set<string>>();
  const secretsScored = new Map<string, number>();
  if (s.save) {
    const p = parseSave(s.save);
    phase = p.game.get("phase_of_game") ?? "";
    if (p.game.get("game_has_ended") === "true") phase = "finished";
  }
  if (s.web) {
    phase ||= webPhase(s.web);
    round = num(s.web.gameRound);
    for (const p of realPlayers(s.web)) {
      vps.set(p.faction, num(p.totalVps));
      const entries: Json[] = s.web.scoreBreakdowns?.[p.faction]?.entries ?? [];
      losable.set(p.faction, entries.filter((e) => e.state === "SCORED" && e.losable).reduce((a, e) => a + num(e.pointValue), 0));
      techs.set(p.faction, new Set(p.techs ?? []));
      secretsScored.set(p.faction, Object.keys(p.secretsScored ?? {}).length);
    }
  } else if (s.save) {
    const p = parseSave(s.save);
    round = num(p.game.get("round"));
    for (const pl of p.players) {
      const f = pl.kv.get("faction");
      if (!f || f === "null" || f === "neutral") continue;
      techs.set(f, new Set(cardIds(pl.kv.get("tech"))));
      secretsScored.set(f, cardIds(pl.kv.get("secret_objectives_scored")).length);
    }
  } else return null;
  return { phase, round, vps, losable, techs, secretsScored, rewind: /^⏪|rewound|^Game created|Rolled back/.test(s.label ?? "") };
}

/** Invariants over consecutive snapshots (in save order). Snapshots right after a roll-back are not compared. */
export function checkSequence(states: Snapshot[]): Violation[] {
  const v: Violation[] = [];
  let prev: Facts | null = null;
  let prevS: Snapshot | null = null;
  for (const s of states) {
    const f = facts(s);
    if (!f) continue;
    const add = (id: string, severity: Severity, message: string, player?: string) =>
      v.push({ id, severity, message: `${message} (after ${prevS?.id} -> ${s.id}${s.label ? `: ${s.label}` : ""})`, player, snapshot: s.id });
    if (prev && !f.rewind) {
      if (f.round < prev.round) add("round.monotone", "error", `round went back from ${prev.round} to ${f.round}`);
      if (f.phase !== prev.phase && f.phase !== "finished" && !(inSetup(prev.phase) && inSetup(f.phase))) {
        const edge = PHASE_EDGES[prev.phase]?.[f.phase];
        // A person may set any phase by command (/game start_phase): legal by fiat, but worth seeing.
        const forced = /used: \/?game (start_phase|set_phase)|used: \/?(status|agenda|game) /.test(s.label ?? "");
        if (edge === undefined && forced) add("phase.forced-by-command", "warn", `phase set ${prev.phase || "(none)"} -> ${f.phase} by command`);
        else if (edge === undefined && SOFT_EDGES.has(`${prev.phase}>${f.phase}`)) add("phase.transition-skipped", "warn", `phase skipped ${prev.phase} -> ${f.phase}`);
        else if (edge === undefined) add("phase.transition", "error", `illegal phase change ${prev.phase || "(none)"} -> ${f.phase}`);
        else if (f.round !== prev.round + edge) add("phase.round-advance", "error", `${prev.phase} -> ${f.phase} moved the round ${prev.round} -> ${f.round}`);
      } else if (f.phase === prev.phase && f.round !== prev.round) add("phase.round-advance", "error", `round changed ${prev.round} -> ${f.round} within ${f.phase}`);
      for (const [fac, vp] of f.vps) {
        const before = prev.vps.get(fac);
        if (before === undefined) continue;
        const lost = before - vp;
        if (lost > 0 && lost > (prev.losable.get(fac) ?? 0)) add("vp.monotone", "error", `victory points fell ${before} -> ${vp}`, fac);
      }
      for (const [fac, t] of f.techs) {
        const before = prev.techs.get(fac);
        if (!before) continue;
        const gone = [...before].filter((x) => !t.has(x));
        if (gone.length) add("techs.monotone", "warn", `lost technology ${gone.join(",")}`, fac);
      }
      for (const [fac, n] of f.secretsScored) {
        const before = prev.secretsScored.get(fac);
        if (before !== undefined && n < before) add("secrets.scored-monotone", "warn", `scored secrets fell ${before} -> ${n}`, fac);
      }
    }
    prev = f;
    prevS = s;
  }
  v.push(...checkProgress(states));
  return v;
}

/**
 * Liveness: the game state (saves, volatile keys dropped) coming back to an earlier state after several actions
 * means presses that go in circles (e.g. a stale prompt re-opening a window). Roll-backs are excluded.
 */
export function checkProgress(states: Snapshot[], minLoop = 3, minIdle = 6): Violation[] {
  const v: Violation[] = [];
  const seen = new Map<string, number>();
  const withSave = states.filter((s) => s.save);
  const hashes = withSave.map((s) => normalizeSave(s.save!).join("\n"));
  const summary = (from: number, to: number) =>
    [...new Set(withSave.slice(from, to + 1).map((x) => (x.label ?? "?").replace(/^\S+ /, "")))].slice(0, 4).join(" | ");
  let idleFrom = 0;
  const flushIdle = (end: number) => {
    // `end` is the last save of a run of identical states starting at idleFrom
    if (end - idleFrom >= minIdle)
      v.push({ id: "progress.no-idle-streaks", severity: "warn", message: `${end - idleFrom} saved actions in a row changed nothing (saves ${withSave[idleFrom].id}..${withSave[end].id}: ${summary(idleFrom + 1, end)})`, snapshot: withSave[end].id });
  };
  withSave.forEach((s, i) => {
    if (/^⏪|rewound|Rolled back/.test(s.label ?? "")) {
      seen.clear();
      flushIdle(i - 1);
      idleFrom = i;
      return;
    }
    const h = hashes[i];
    if (i > 0 && h !== hashes[i - 1]) {
      flushIdle(i - 1);
      idleFrom = i;
    }
    const at = seen.get(h);
    // A state seen before, with different states in between: actions that went round in a circle.
    if (at !== undefined && i - at >= minLoop && h !== hashes[i - 1])
      v.push({ id: "progress.no-cycles", severity: "warn", message: `state after ${s.id} equals the state after ${withSave[at].id}: ${i - at} actions went in a circle (${summary(at + 1, i)})`, snapshot: s.id });
    if (!seen.has(h) || h !== hashes[i - 1]) seen.set(h, i);
  });
  flushIdle(withSave.length - 1);
  return v;
}

/** Groups violations by invariant id for a compact report. */
export function summarize(vs: Violation[]): Map<string, Violation[]> {
  const m = new Map<string, Violation[]>();
  for (const x of vs) {
    if (!m.has(x.id)) m.set(x.id, []);
    m.get(x.id)!.push(x);
  }
  return m;
}

/**
 * Save-file flags that mean homebrew or an alternate game mode (mirror of bot ti4.selfhost.WebContent.violations;
 * the player count is not a criterion here, unlike Game.hasHomebrew()). Official: base, PoK, Thunder's Edge, codices.
 */
const OFFICIAL_MODE_FLAGS = new Set(["base_game_mode", "thunders_edge_mode", "no_swap_mode", "veiled_heart_mode", "lore_mode", "limited_whispers_mode", "beta_test_mode", "cpti_explore_mode"]);
const OTHER_HOMEBREW_FLAGS = new Set(["twilight_kart", "tf_br", "twilight_ds", "tk_nova_cup", "tk_destroyer_cup"]);
export function homebrewFlags(g: Map<string, string>): string[] {
  const out: string[] = [];
  for (const [k, v] of g) {
    if (String(v) !== "true") continue;
    if ((k.endsWith("_mode") && !OFFICIAL_MODE_FLAGS.has(k)) || OTHER_HOMEBREW_FLAGS.has(k)) out.push(k);
  }
  const spin = g.get("spin_mode");
  if (spin && spin !== "OFF") out.push(`spin_mode=${spin}`);
  if (String(g.get("ac_deck_id") ?? "").startsWith("action_deck_2")) out.push("ac_deck_id=action_deck_2");
  return out;
}

export const INVARIANTS: { id: string; severity: Severity; what: string }[] = [
  { id: "content.no-homebrew", severity: "error", what: "a web game has no homebrew or alternate mode on (save *_mode flags, spin, AC deck 2)" },
  { id: "identity.color / faction-unique", severity: "error", what: "after setup every player has a colour; factions and colours are distinct" },
  { id: "speaker.exactly-one / is-player", severity: "error", what: "exactly one speaker, and the save's speaker id is a seated player" },
  { id: "cc.pool-nonnegative", severity: "error", what: "tactic, fleet and strategy pools >= 0" },
  { id: "cc.total-at-most-16", severity: "error", what: "pools + own tokens on the board <= 16 (Mahact's captured tokens excluded); reinforcements >= 0" },
  { id: "tg / commodities", severity: "error", what: "trade goods and commodities >= 0; commodities <= the faction's commodity value" },
  { id: "planets.*", severity: "error", what: "no planet twice; exhausted planets are controlled; one controller per planet; map and player data agree" },
  { id: "techs.*", severity: "error", what: "no duplicate technology; exhausted techs are owned" },
  { id: "sc.*", severity: "error", what: "<=2 strategy cards each with <=4 players, else 1; each card held once; picked-by agrees; card trade goods >= 0" },
  { id: "vp.equals-sources", severity: "error", what: "totalVps = sum of SCORED entries in the score breakdown" },
  { id: "objectives.scored-once", severity: "error", what: "a non-multi-scoring objective is scored at most once per faction" },
  { id: "secrets.*", severity: "error", what: "scored secrets <= the faction's maximum (held + scored may exceed by one while discarding)" },
  { id: "units.within-component-limit", severity: "error", what: "deployed units <= component limit (fighters / infantry: warn)" },
  { id: "units.count-agrees", severity: "warn", what: "unitCounts.deployedCount covers what the board shows" },
  { id: "fleet.supply / capacity.space", severity: "warn", what: "ships per system <= fleet pool (+ unsupported fighters); ground forces + fighters in space <= capacity" },
  { id: "turn.*", severity: "error", what: "in the action phase the active player is a player (warn if they already passed)" },
  { id: "cards.*-unique / conserved", severity: "error", what: "every action / secret / agenda / relic / explore / promissory card is in at most one zone; zone totals <= deck size" },
  { id: "round.monotone / phase.transition / phase.round-advance", severity: "error", what: "rounds never go back; phases follow setup -> strategy -> action -> status -> [agenda] -> strategy (round + 1)" },
  { id: "vp.monotone", severity: "error", what: "a player's VP never drop, except by losable points (e.g. Shard, Political Censure)" },
  { id: "techs.monotone / secrets.scored-monotone", severity: "warn", what: "technologies and scored secrets are not lost" },
  { id: "phase.forced-by-command / phase.transition-skipped", severity: "warn", what: "a phase set by /game start_phase, or a step the bot did not save (action -> statusHomework)" },
  { id: "identity.owner-id-intact", severity: "warn", what: "the save's owner id is a whole user id (Game.setOwnerID truncates to 18 chars)" },
  { id: "progress.no-idle-streaks", severity: "warn", what: "no long run (>= 6) of saved actions that change nothing (stale prompts pressed in a loop)" },
  { id: "progress.no-cycles", severity: "warn", what: "the state does not return to an earlier state through different ones (actions going round in circles)" },
];
