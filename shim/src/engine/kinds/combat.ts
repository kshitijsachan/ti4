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
  | { action: "retreat"; tile: TilePosition; variant: "skilled" | "foresight" | "gheminabt" | string | null }
  /** A temporary modifier for the presser's next roll offered on the controls (Supercharge: source "tech", card "sc"). */
  | { action: "temp_mod"; tile: TilePosition | null; source: "action_cards" | "tech" | string; card: string }
  | CombatAbilityValue
  | { action: "refresh"; tile: TilePosition }
  /** "Done" on a controls message. */
  | { action: "done"; tile: null };

/**
 * Any other button the bot posts with a combat ("Buttons for combat."): agents (Sol, Letnev, Yin...), relics (Heart of
 * Ixth), promissory notes (War Funding), faction abilities. owner = the faction that may use it (null when not known);
 * window = the card's timing text; blocked = why it cannot be used now (agent exhausted, no combat under way...),
 * refused by the engine when pressed.
 */
export type CombatAbilityValue = {
  action: "ability";
  tile: TilePosition | null;
  /** Leader / relic / note id, or the handler prefix for other abilities. */
  ability: string;
  source: "agent" | "relic" | "pn" | "other";
  owner: FactionId | null;
  name: string | null;
  window: string | null;
  blocked: string | null;
};

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
      /**
       * Set once Shields Holding cancelled hits after the prompt was posted (re-read on every state change): hits is
       * then what is left, promptHits what the buttons ask for. The engine refuses this option then — answer with a
       * combat plan for `hits`, or "Cancel a Hit".
       */
      cancelled?: number;
      promptHits?: number;
    }
  | { action: "cancel"; tile: TilePosition; holder: HolderName; source: HitSource; hits: number }
  | {
      action: "assign_manual";
      tile: TilePosition;
      assignType: string;
      /** assignType "bombardment" only (that prompt has no auto option): hits owed (newest bombardment roll of this
       * activation, null when unknown), the bombarded planet and the units there; answer with a combat plan. */
      source?: "ground";
      holder?: HolderName | null;
      hits?: number | null;
      units?: HittableUnit[];
      sustainCancels?: 1 | 2;
    }
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
export type UnitsRemoveValue =
  /** reminder: the fleet-pool / capacity reminder (the turn cannot end while it is open and its system breaks the rules). */
  | { action: "open"; tile: string; assignType: string; reminder?: boolean }
  /** blocked: on a fleet-pool / capacity reminder, why Dismiss is refused now (the system is still over its limits). */
  | { action: "done"; tile: null; assignType: null; blocked?: string | null };
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

/**
 * "Unsure if a combat should occur on <planet>" (pbd203): engage (startCombatOn_), coexist (deleteButtons) or, after a
 * won combat with coexisters left, claim the planet (claimPlanet_). Target: the player the message names.
 */
export type CombatEngageValue = { action: "engage" | "claim"; planet: string } | { action: "coexist"; planet: null };
export type CombatEngage = DecisionBase<"combat.engage", CombatEngageValue>;

export type CombatDecision = CombatRound | CombatHits | CombatAssignUnits | CombatRetreat | CombatBombard | CombatAutomate | CombatModifier | CombatEngage;

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
  /** Space: the combat round this side announced a retreat for (this activation), 0 when none. Older engines: absent. */
  retreatAnnounced?: number;
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
  /** Combat rounds: the roller's units able to fight in that holder when it rolled (losses = difference to its next roll / now). Older engines: absent. */
  units?: HittableUnit[];
};

/** Hits a player still has to assign in the active system (an open hits prompt / manual menu). */
export type HitsOwed = {
  faction: FactionId;
  userId: UserId;
  tile: TilePosition;
  holder: HolderName;
  source: HitSource;
  /** Hits still to assign. */
  hits: number;
  /** Assigned so far through the manual menu. */
  assigned: number;
  /** The combat.hits decision to answer (option, or a combat plan). */
  decisionId: string;
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
  /** Rolls of this game, oldest first (persisted ledger, last 60; older entries may have no dice). */
  rolls: CombatRoll[];
  /** Hits owed in this system right now. Older engines: absent. */
  owed?: HitsOwed[];
  /** The active player's faction (the attacker), or null. Older engines: absent. */
  attacker?: FactionId | null;
};

// ---------------------------------------------------------------- plan answer (POST …/decisions/{id}/combat-plan)

export type CombatPlanEntry = { holder: HolderName; unit: UnitId; damaged: boolean; action: "sustain" | "destroy"; count: number };
export type CombatPlanRequest = { plan: CombatPlanEntry[]; expectedSeq?: number; userId?: UserId };
export type CombatPlanResult = { ok: boolean; status: string; error: string | null; pressed: number };
