/**
 * G3 — turn menu, tactical action, movement, landing. Mirrors bot ti4.selfhost.engine.kinds.{TurnAction,Tactical*}Kind
 * and the direct actions in ti4.selfhost.engine.TacticalController. Ids only: positions ("305"), planet ids, async
 * unit ids (cv, dd, gf, mf, ff...), colours. Dependency-free (the web imports it).
 */
import type { DecisionBase, Progress, UserId } from "../types.js";

// ---------------------------------------------------------------- turn.action

/** Action-phase turn menu (also "end turn or do another action", pass / end-of-turn ability menus). */
export type TurnActionValue =
  | { action: "tactical"; tacticTokens: number | null }
  | { action: "component" }
  | { action: "strategic"; strategyCard: number }
  /** abilities: opens the "pass with abilities" menu instead of passing now. */
  | { action: "pass"; abilities: boolean }
  /** abilities: opens the end-of-turn abilities menu (it carries a final end_turn with abilities=false). */
  | { action: "end_turn"; abilities: boolean };
export type TurnAction = DecisionBase<"turn.action", TurnActionValue>;

// ---------------------------------------------------------------- tactical.activate

/**
 * Choosing the system to activate. A menu step lists the systems it leads to (`positions`), so a client that wants
 * position X answers the menu option whose positions include X, then the system option for X.
 */
export type TacticalActivateValue =
  | { step: "system"; position: string; tileId: string | null }
  | { step: "ring"; ring: string; positions: string[] }
  | { step: "distance"; distance: number; positions: string[] };
export type TacticalActivate = DecisionBase<"tactical.activate", TacticalActivateValue>;

// ---------------------------------------------------------------- tactical.move

export type MovableUnit = {
  /** "space" or a planet id. */
  holder: string;
  unit: string;
  color: string;
  count: number;
  damaged: number;
  /** Base move value (nebula origin: 1). Bonuses below are separate. */
  move: number;
  capacity: number;
  ship: boolean;
};

export type MoveOrigin = {
  position: string;
  tileId: string;
  /** Movement distance to the active system ignoring rift bonuses / with rifts (100 = not reachable). */
  distance: number;
  riftDistance: number;
  units: MovableUnit[];
};

export type MoveBonus = { source: string; amount: number; appliesTo: "one_ship" | "all_ships" | "ships_not_transporting" | string };

export type StagedMove = { from: string; holder: string; unit: string; color: string; count: number; damaged: number };

export type TacticalMoveValue =
  /** Finish movement into `position`. Also carries the movement picture (origins, bonuses). */
  | { action: "done"; position: string; tileId: string | null; origins?: MoveOrigin[]; bonuses?: MoveBonus[] }
  | { action: "from"; position: string }
  | { action: "back" }
  | { action: "page"; page: number }
  | { action: "unit"; position: string; count: number; unit: string; reverse: boolean }
  | { action: "all"; position: string; op: "moveAll" | "reverseAll" | "removeAllShips" | "removeAll" }
  | { action: "change_destination" }
  | { action: "reset" };
/** progress.accumulated: what is staged to move so far. */
export type TacticalMoveProgress = Progress<{ position: string; staged: StagedMove[] }>;
export type TacticalMove = DecisionBase<"tactical.move", TacticalMoveValue> & { progress: TacticalMoveProgress | null };

// ---------------------------------------------------------------- tactical.land

export type TacticalLandValue =
  | {
      op: "land" | "unland";
      position: string;
      planet: string;
      unit: string;
      count: number;
      damaged: boolean;
      color: string;
      owner: string | null;
    }
  | { op: "done"; position: string };
export type TacticalLandProgress = Progress<{
  position: string;
  inSpace: { unit: string; count: number }[];
  onPlanets: { planet: string; unit: string; count: number }[];
}>;
export type TacticalLand = DecisionBase<"tactical.land", TacticalLandValue> & { progress: TacticalLandProgress | null };

// ---------------------------------------------------------------- tactical.conclude / tactical.rift

export type TacticalConcludeValue =
  | { action: "produce"; position: string; production: number }
  | { action: "rift"; position: string }
  /** frontierExplore: concluding explores the system's frontier token (Dark Energy Tap). */
  | { action: "conclude"; position: string; frontierExplore: boolean };
export type TacticalConclude = DecisionBase<"tactical.conclude", TacticalConcludeValue>;

export type TacticalRiftValue =
  | { op: "roll"; position: string; count: number; unit: string; damaged: boolean }
  | { op: "roll_all"; position: string }
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
  units: { from: string; holder: string; unit: string; color?: string; count: number; damaged?: number }[];
  conclude?: boolean;
  expectedSeq?: number;
  requestId?: string;
  userId?: UserId;
}

/** POST …/decisions/{id}/land on a tactical.land decision: lands each, then (unless done=false) Done Landing. */
export interface LandRequest {
  landings: { planet: string; unit: string; count: number; color?: string }[];
  done?: boolean;
  expectedSeq?: number;
  requestId?: string;
  userId?: UserId;
}
