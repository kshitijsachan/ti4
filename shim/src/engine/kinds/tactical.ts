/**
 * G3 — turn menu, tactical action, movement, landing. Mirrors bot ti4.selfhost.engine.kinds.{TurnAction,Tactical*}Kind
 * and the direct actions in ti4.selfhost.engine.TacticalController. Ids only: positions ("305"), planet ids, async
 * unit ids (cv, dd, gf, mf, ff...), colours. Dependency-free (the web imports it).
 */
import type {
  ColorName,
  DecisionBase,
  FactionId,
  HolderName,
  PlanetId,
  Progress,
  StrategyCardNumber,
  TileId,
  TilePosition,
  UnitId,
  UserId,
} from "../types.js";

// ---------------------------------------------------------------- turn.action

/** Action-phase turn menu (also "end turn or do another action", pass / end-of-turn ability menus). */
/**
 * A played strategy card that still waits on followers and so holds the turn (engine ScFollowGate): the engine
 * refuses end_turn / pass until every listed player followed or declined it.
 */
export type FollowWait = { strategyCard: StrategyCardNumber; name: string; factions: FactionId[]; userIds: UserId[] };

export type TurnActionValue =
  | { action: "tactical"; tacticTokens: number | null }
  | { action: "component" }
  | { action: "strategic"; strategyCard: StrategyCardNumber }
  /** abilities: opens the "pass with abilities" menu instead of passing now. waitingFor: see FollowWait. */
  | { action: "pass"; abilities: boolean; waitingFor?: FollowWait[] }
  /** abilities: opens the end-of-turn abilities menu (it carries a final end_turn with abilities=false). */
  | { action: "end_turn"; abilities: boolean; waitingFor?: FollowWait[] }
  /** "End Turn When All Have Reacted": the turn ends by itself once every player answered the card's follow window. */
  | { action: "end_turn_when_followed"; strategyCard: StrategyCardNumber; waitingFor?: FollowWait[] }
  /**
   * Take another action this turn (confirmSecondAction / doAnotherAction). Offered only when something allows it;
   * sources names it (Master Plan, Minister of War, Fleet Logistics, Thunder's Edge, …).
   */
  | { action: "another_action"; sources: string[] };
export type TurnAction = DecisionBase<"turn.action", TurnActionValue>;

// ---------------------------------------------------------------- tactical.activate

/**
 * Choosing the system to activate. A menu step lists the systems it leads to (`positions`), so a client that wants
 * position X answers the menu option whose positions include X, then the system option for X.
 */
export type TacticalActivateValue =
  | { step: "system"; position: TilePosition; tileId: TileId | null }
  | { step: "ring"; ring: string; positions: TilePosition[] }
  | { step: "distance"; distance: number; positions: TilePosition[] };
export type TacticalActivate = DecisionBase<"tactical.activate", TacticalActivateValue>;

// ---------------------------------------------------------------- tactical.move

export type MovableUnit = {
  /** "space" or a planet id. */
  holder: HolderName;
  unit: UnitId;
  color: ColorName;
  count: number;
  damaged: number;
  /** Base move value (nebula origin: 1). Bonuses below are separate. */
  move: number;
  capacity: number;
  ship: boolean;
};

export type MoveOrigin = {
  position: TilePosition;
  tileId: TileId;
  /** Movement distance to the active system ignoring rift bonuses / with rifts (100 = not reachable). */
  distance: number;
  riftDistance: number;
  units: MovableUnit[];
};

export type MoveBonus = { source: string; amount: number; appliesTo: "one_ship" | "all_ships" | "ships_not_transporting" | string };

export type StagedMove = { from: TilePosition; holder: HolderName; unit: UnitId; color: ColorName; count: number; damaged: number };

export type TacticalMoveValue =
  /** Finish movement into `position`. Also carries the movement picture (origins, bonuses). */
  | { action: "done"; position: TilePosition; tileId: TileId | null; origins?: MoveOrigin[]; bonuses?: MoveBonus[] }
  | { action: "from"; position: TilePosition }
  | { action: "back" }
  | { action: "page"; page: number }
  | { action: "unit"; position: TilePosition; count: number; unit: UnitId; reverse: boolean }
  | { action: "all"; position: TilePosition; op: "moveAll" | "reverseAll" | "removeAllShips" | "removeAll" }
  | { action: "change_destination" }
  | { action: "reset" };
/** progress.accumulated: what is staged to move so far. */
export type TacticalMoveProgress = Progress<{ position: TilePosition; staged: StagedMove[] }>;
export type TacticalMove = DecisionBase<"tactical.move", TacticalMoveValue> & { progress: TacticalMoveProgress | null };

// ---------------------------------------------------------------- tactical.land

export type TacticalLandValue =
  | {
      op: "land" | "unland";
      position: TilePosition;
      planet: PlanetId;
      unit: UnitId;
      count: number;
      damaged: boolean;
      color: ColorName;
      /** Faction owning the units. */
      owner: FactionId | null;
    }
  | { op: "done"; position: TilePosition };
export type TacticalLandProgress = Progress<{
  position: TilePosition;
  inSpace: { unit: UnitId; count: number }[];
  onPlanets: { planet: PlanetId; unit: UnitId; count: number }[];
}>;
export type TacticalLand = DecisionBase<"tactical.land", TacticalLandValue> & { progress: TacticalLandProgress | null };

// ---------------------------------------------------------------- tactical.conclude / tactical.rift

export type TacticalConcludeValue =
  | { action: "produce"; position: TilePosition; production: number }
  | { action: "rift"; position: TilePosition }
  /**
   * frontierExplore: concluding explores the system's frontier token (Dark Energy Tap). endTurn: "Conclude & End
   * Turn" (offered only when the end-of-turn menu would hold nothing but End Turn).
   */
  | { action: "conclude"; position: TilePosition; frontierExplore: boolean; endTurn?: boolean };
export type TacticalConclude = DecisionBase<"tactical.conclude", TacticalConcludeValue>;

export type TacticalRiftValue =
  | { op: "roll"; position: TilePosition; count: number; unit: UnitId; damaged: boolean }
  | { op: "roll_all"; position: TilePosition }
  | { op: "done" };
export type TacticalRift = DecisionBase<"tactical.rift", TacticalRiftValue>;

export type TacticalDecision = TurnAction | TacticalActivate | TacticalMove | TacticalLand | TacticalConclude | TacticalRift;

// ---------------------------------------------------------------- direct actions

/**
 * POST /api/public/selfhost/engine/{g}/decisions/{id}/move (Bot, userId in body) or
 * POST /api/game/{g}/engine/decisions/{id}/move (seat). On a tactical.move decision: stages exactly these units into
 * the active system (replacing anything staged before) and, unless conclude=false, finishes movement. Answers an
 * AnswerResult with every decision opened meanwhile (landing, combat, ...).
 */
export interface MoveRequest {
  units: { from: TilePosition; holder: HolderName; unit: UnitId; color?: ColorName; count: number; damaged?: number }[];
  conclude?: boolean;
  expectedSeq?: number;
  requestId?: string;
  userId?: UserId;
}

/** POST …/decisions/{id}/land on a tactical.land decision: lands each, then (unless done=false) Done Landing. */
export interface LandRequest {
  landings: { planet: PlanetId; unit: UnitId; count: number; color?: ColorName }[];
  done?: boolean;
  expectedSeq?: number;
  requestId?: string;
  userId?: UserId;
}
