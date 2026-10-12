/**
 * Combat (G4). Mirrors bot ti4.selfhost.engine.kinds.Combat*Kind and CombatSupport. Dependency-free (web imports it).
 *
 * Roll types: "combat" (a combat round), "afb", "bombardment", "spacecannonoffence", "spacecannondefence".
 * Hit sources: "space" (space combat), "ground", "afb", "spacecannonoffence".
 */
import type { DecisionBase, FactionId, HolderName, TileId, TilePosition, UnitId, UserId } from "../types.js";

export type RollType = "combat" | "afb" | "bombardment" | "spacecannonoffence" | "spacecannondefence";
export type HitSource = "space" | "ground" | "afb" | "spacecannonoffence";

/** A unit stack a hit may land on. holder: "space" or a planet id; unit: async id (dd, ca, dn, ff, inf, mf, ...). */
export type HittableUnit = { holder: HolderName; unit: UnitId; count: number; damaged: number; sustain: boolean };

// ---------------------------------------------------------------- option values

export type CombatRollValue = {
  action: "roll";
  tile: TilePosition;
  holder: HolderName;
  rollType: RollType;
  /** Bombardment that first asks which planets the dice target. */
  chooseTargets?: boolean;
};

/** Options on the combat controls message besides rolls. tile may be null when the id does not carry it. */
export type CombatControlValue =
  | CombatRollValue
  | { action: "decline_space_cannon"; tile: TilePosition | null; rollType: "spacecannonoffence" }
  | { action: "assign_manual"; tile: TilePosition; assignType: string }
  | { action: "announce_retreat" | "ready_for_dice" | "automate"; tile: TilePosition | null }
  /** The combat action-card window: playing the cards belongs to the action-card kinds (G8). */
  | { action: "action_cards"; tile: TilePosition | null }
  | { action: "repair"; tile: TilePosition }
  | { action: "retreat"; tile: TilePosition; variant: "skilled" | "foresight" | "gheminabt" | string | null };

export type CombatHitsValue =
  | {
      action: "auto";
      tile: TilePosition;
      holder: HolderName;
      source: HitSource;
      hits: number;
      /** The units the hits may land on when the prompt was posted (live counts: GameState.tiles / combat). */
      units: HittableUnit[];
      /** Hits one SUSTAIN DAMAGE cancels (2 with Non-Euclidean Shielding). */
      sustainCancels: 1 | 2;
    }
  | { action: "cancel"; tile: TilePosition; holder: HolderName; source: HitSource; hits: number }
  | { action: "assign_manual"; tile: TilePosition; assignType: string }
  | CombatRollValue;

export type CombatUnitPickValue =
  | {
      action: "sustain" | "destroy";
      tile: TilePosition;
      holder: HolderName;
      unit: UnitId;
      count: number;
      damaged: boolean;
      state: "none" | "dmg" | "glv" | "dmg_glv";
      /** The engine's assignment mode: spacecombat, groundcombat, afb, pds, remove, combat... */
      assignType: string;
    }
  | { action: "destroy_all" | "destroy_all_ships"; tile: TilePosition; assignType: string }
  | { action: "done"; tile: null; assignType: string };

export type CombatRetreatValue =
  | { action: "retreat_to"; tile: TilePosition; to: TilePosition; skilled: boolean }
  | { action: "retreat_ground"; tile: TilePosition; to: TilePosition; count: number; unit: UnitId; holder: HolderName | null }
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

export type CombatDecision = CombatRound | CombatHits | CombatAssignUnits | CombatRetreat;

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

export type CombatFront = { holder: HolderName; sides: CombatSide[] };

export type CombatRoll = {
  at: number;
  faction: FactionId;
  opponent: FactionId | null;
  tile: TilePosition;
  holder: HolderName;
  rollType: RollType;
  round: number | null;
  hits: number;
  dice: { unit: UnitId; threshold: number; results: number[] }[];
};

export type CombatState = {
  /** Active system position. */
  tile: TilePosition;
  tileId: TileId;
  /** Fighting factions; empty before the combat starts (space cannon offence). */
  factions: FactionId[];
  fronts: CombatFront[];
  /** Factions other than the active player that may fire SPACE CANNON at the active system. */
  spaceCannonOffence: FactionId[];
  /** Recent rolls in this game, oldest first (bot memory: empty after a bot restart). */
  rolls: CombatRoll[];
};

// ---------------------------------------------------------------- plan answer (POST …/decisions/{id}/combat-plan)

export type CombatPlanEntry = { holder: HolderName; unit: UnitId; damaged: boolean; action: "sustain" | "destroy"; count: number };
export type CombatPlanRequest = { plan: CombatPlanEntry[]; expectedSeq?: number; userId?: UserId };
export type CombatPlanResult = { ok: boolean; status: string; error: string | null; pressed: number };
