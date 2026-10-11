/**
 * Combat (G4). Mirrors bot ti4.selfhost.engine.kinds.Combat*Kind and CombatSupport. Dependency-free (web imports it).
 *
 * Roll types: "combat" (a combat round), "afb", "bombardment", "spacecannonoffence", "spacecannondefence".
 * Hit sources: "space" (space combat), "ground", "afb", "spacecannonoffence".
 */
import type { DecisionBase, FactionId, UserId } from "../types.js";

export type RollType = "combat" | "afb" | "bombardment" | "spacecannonoffence" | "spacecannondefence";
export type HitSource = "space" | "ground" | "afb" | "spacecannonoffence";

/** A unit stack a hit may land on. holder: "space" or a planet id; unit: async id (dd, ca, dn, ff, inf, mf, ...). */
export type HittableUnit = { holder: string; unit: string; count: number; damaged: number; sustain: boolean };

// ---------------------------------------------------------------- option values

export type CombatRollValue = {
  action: "roll";
  tile: string;
  holder: string;
  rollType: RollType;
  /** Bombardment that first asks which planets the dice target. */
  chooseTargets?: boolean;
};

/** Options on the combat controls message besides rolls. tile may be null when the id does not carry it. */
export type CombatControlValue =
  | CombatRollValue
  | { action: "decline_space_cannon"; tile: string | null; rollType: "spacecannonoffence" }
  | { action: "assign_manual"; tile: string; assignType: string }
  | { action: "announce_retreat" | "ready_for_dice" | "automate"; tile: string | null }
  /** The combat action-card window: playing the cards belongs to the action-card kinds (G8). */
  | { action: "action_cards"; tile: string | null }
  | { action: "repair"; tile: string }
  | { action: "retreat"; tile: string; variant: "skilled" | "foresight" | "gheminabt" | string | null }
  /** A temporary modifier for the presser's next roll offered on the controls (Supercharge: source "tech", card "sc"). */
  | { action: "temp_mod"; tile: string | null; source: "action_cards" | "tech" | string; card: string };

export type CombatHitsValue =
  | {
      action: "auto";
      tile: string;
      holder: string;
      source: HitSource;
      hits: number;
      /** The units the hits may land on when the prompt was posted (live counts: GameState.tiles / combat). */
      units: HittableUnit[];
      /** Hits one SUSTAIN DAMAGE cancels (2 with Non-Euclidean Shielding). */
      sustainCancels: 1 | 2;
    }
  | { action: "cancel"; tile: string; holder: string; source: HitSource; hits: number }
  | { action: "assign_manual"; tile: string; assignType: string }
  | CombatRollValue;

export type CombatUnitPickValue =
  | {
      action: "sustain" | "destroy";
      tile: string;
      holder: string;
      unit: string;
      count: number;
      damaged: boolean;
      state: "none" | "dmg" | "glv" | "dmg_glv";
      /** The engine's assignment mode: spacecombat, groundcombat, afb, pds, remove, combat... */
      assignType: string;
    }
  | { action: "destroy_all" | "destroy_all_ships"; tile: string; assignType: string }
  | { action: "done"; tile: null; assignType: string };

export type CombatRetreatValue =
  | { action: "retreat_to"; tile: string; to: string; skilled: boolean }
  | { action: "retreat_ground"; tile: string; to: string; count: number; unit: string; holder: string | null }
  | { action: "done"; tile: null };

// ---------------------------------------------------------------- kinds

/**
 * The combat controls (both sides; table scope). window.kind "combat_roll": eligible = who rolls here, responded =
 * who already rolled (combat round: the side ahead on rounds rolled; barrage / space cannon: rolled since the prompt).
 */
export type CombatRound = DecisionBase<"combat.round", CombatControlValue>;
/** Hits a player must assign (target = the player hit). Answer with an option, or with a plan (EngineClient.act(game, id, "combat-plan", {plan, userId})). */
export type CombatHits = DecisionBase<"combat.hits", CombatHitsValue>;
/**
 * The manual assignment menu, edited in place per unit. progress: flow "combat.assign_hits", accumulated
 * {assigned, destroyed: {unit: n}, sustained: {unit: n}}, required {owed, hits (left), tile, holder, source}.
 */
export type CombatAssignUnits = DecisionBase<"combat.assign_units", CombatUnitPickValue>;
export type CombatRetreat = DecisionBase<"combat.retreat", CombatRetreatValue>;

/** BOMBARDMENT target step (bombarding player; edited in place). source: unit async id | plasmascoring | argentcommander. */
export type CombatBombardValue =
  | { op: "assign" | "unassign"; source: string; planet: string; galvanized: boolean; type: "UNIT" | "TECH" | "LEADER" }
  | { op: "done"; tile: string | null };
/** progress: flow "combat.bombard", accumulated.assigned = [{source, planet, galvanized, type}], canCommit always true. */
export type CombatBombard = DecisionBase<"combat.bombard", CombatBombardValue>;

/**
 * A stand-alone opener of the per-unit removal menu (fleet pool / capacity violation, rift: "remove"; hits taken
 * outside the combat controls: "bombardment", "afb", "pds", "spacecombat", "groundcombat"). "done" closes it.
 */
export type UnitsRemoveValue = { action: "open"; tile: string; assignType: string } | { action: "done"; tile: null; assignType: null };
export type UnitsRemove = DecisionBase<"units.remove", UnitsRemoveValue>;

/**
 * "Automate the entire ground combat" on a message of its own: the vote (unconfirmed; no owner, table scope, no
 * window: optional) and the opponent's confirmation (confirmed; owner = the opponent). factions = [p1, p2].
 */
export type CombatAutomateValue = { planet: string; factions: [FactionId, FactionId]; confirmed: boolean };
export type CombatAutomate = DecisionBase<"combat.automate", CombatAutomateValue>;

/**
 * A temporary combat modifier for the next roll on a message of its own: "Resolve <action card>" right after playing
 * Morale Boost / Fighter Prototype / Bunker / … (source "action_cards", card = the action card alias), or Supercharge
 * (source "tech", card "sc"). One option; pressing it applies the modifier.
 */
export type CombatModifierValue = { source: "action_cards" | "tech" | string; card: string };
export type CombatModifier = DecisionBase<"combat.modifier", CombatModifierValue>;

export type CombatDecision = CombatRound | CombatHits | CombatAssignUnits | CombatRetreat | CombatBombard | CombatAutomate | CombatModifier;

/**
 * The "Modify Units" menu (a manual board edit opened from the turn-start / cards-info "Modify Units" button):
 * system list (tile: genericModify_ = systems with your units, allTiles = every system; all_tiles = show every
 * system), then build (opens production.produce, context "genericBuild") or remove (opens combat.assign_units) in that
 * system; done closes the step. units = the owner's units in that system when captured.
 */
export type UnitsModifyValue =
  | { action: "tile"; tile: string; allTiles: boolean; units: number }
  | { action: "build" | "remove"; tile: string; units: number }
  | { action: "all_tiles" | "done"; tile: null };
export type UnitsModify = DecisionBase<"units.modify", UnitsModifyValue>;

// ---------------------------------------------------------------- GameState.combat

export type CombatSide = {
  faction: FactionId;
  userId: UserId;
  /** Combat rounds this side has rolled in this fight. */
  roundsRolled: number;
  /** Units able to fight here (ships in space, ground forces on a planet). */
  units: HittableUnit[];
  /** Optional rolls this side has units for here. */
  abilities: ("afb" | "bombardment" | "spacecannondefence")[];
};

export type CombatFront = { holder: string; sides: CombatSide[] };

export type CombatRoll = {
  at: number;
  faction: FactionId;
  opponent: FactionId | null;
  tile: string;
  holder: string;
  rollType: RollType;
  round: number | null;
  hits: number;
  dice: { unit: string; threshold: number; results: number[] }[];
};

export type CombatState = {
  /** Active system position. */
  tile: string;
  tileId: string;
  /** Fighting factions; empty before the combat starts (space cannon offence). */
  factions: FactionId[];
  fronts: CombatFront[];
  /** Factions other than the active player that may fire SPACE CANNON at the active system. */
  spaceCannonOffence: FactionId[];
  /** Recent rolls in this game, oldest first (bot memory: empty after a bot restart). */
  rolls: CombatRoll[];
};

// ---------------------------------------------------------------- plan answer (POST …/decisions/{id}/combat-plan)

export type CombatPlanEntry = { holder: string; unit: string; damaged: boolean; action: "sustain" | "destroy"; count: number };
export type CombatPlanRequest = { plan: CombatPlanEntry[]; expectedSeq?: number; userId?: UserId };
export type CombatPlanResult = { ok: boolean; status: string; error: string | null; pressed: number };
