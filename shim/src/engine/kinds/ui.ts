/**
 * Perpetual / optional / undo prompts and preferences (c12): Java UiAffordanceKind, UiOptionalKind, InfoMenuSplit,
 * PlayerPreferenceKind, ChooseSelectKind.
 *
 * `ui.*` decisions are NOT pending decisions: nobody is asked anything (an undo button left on screen, an optional
 * shortcut, a help menu). `awaits()` is false for them, so they are never "waiting on me", never block a bot, and
 * the web lists them only as background affordances — but every option stays answerable when a player clicks it.
 * `player.preference` is answered by bots (defaults) and is a background prompt for people.
 */
import type { DecisionBase } from "../types.js";

/**
 * What an affordance option does. `undo` takes back something (`undoes`: so_discard | preset | agenda_put | vote |
 * rider | pre_score | last_action, `ref` = the id the handler parses: secret objective id, agenda alias, …);
 * `shortcut` (info menu): `shortcut` names it (exhaust_agent | agent_selection | galvanize | trade_station_convert |
 * laws_order | pillage_preference); optional actions: round_summary | pre_score | disable_pings | skip_waiting |
 * refresh_agenda | ping_nonresponders. Dismiss and read-only options have value null.
 */
export interface UiAffordanceValue {
  action: string;
  undoes: string | null;
  ref: string | null;
  shortcut?: string;
}

/** "If this was an accident: Retrieve …" / "Remove the preset" / "Erase my vote" / "Reassign …" / "Unqueue it". */
export type UiUndoAffordance = DecisionBase<"ui.undo_affordance", UiAffordanceValue>;
/** Round summaries, objective pre-scoring queue, "disable pings", the agenda help menu, dismiss-only messages. */
export type UiOptional = DecisionBase<"ui.optional", UiAffordanceValue>;
/** The perpetual info menu carrying action shortcuts (agent, galvanize, trade station…): info, not a question. */
export type UiInfoMenu = DecisionBase<"ui.info_menu", UiAffordanceValue>;

/** Preference questions at any time of the game (survey, auto-pass timers, toggles, statistics opt-in). */
export type PlayerPreference = DecisionBase<
  "player.preference",
  { preference: string; question: string | null; choice: string | null }
>;

/** A message whose only controls are select menus: the typed schema is `inputs` (kind "select"). */
export type ChooseSelect = DecisionBase<"choose.select", { menu: string }>;

export type UiDecision = UiUndoAffordance | UiOptional | UiInfoMenu | PlayerPreference | ChooseSelect;

/** Which kinds are affordances: `AFFORDANCE_KINDS` / `isAffordance(d)` in ../types.ts (used by `awaits`). */
