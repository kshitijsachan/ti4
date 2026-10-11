/**
 * Components (C6): the component action menu, relic uses, the generic agent exhaust step, and the generic
 * single-choice kinds choose.{planet,system,player,unit,amount,card,confirm}. Mirrors bot
 * ti4.selfhost.engine.kinds.{ComponentAction,RelicUse,LeaderAgent,Choose*}Kind. Ids only for logic; *Name/*Text are
 * for display.
 *
 * The choose.* kinds are reusable building blocks: one value shape per kind, `source` names the card / ability /
 * relic asking. Add a rule to the bot's Choose*Kind.RULES to type another one-step prompt; the bot policy
 * (policy/components.ts) and the web renderer (renderers/components) then handle it with no further change.
 */
import type { DecisionBase } from "../types.js";

/** Fields every choose.* value carries. */
export interface ChooseBase {
  /** What asks: relic / ability / card id ("stellarconverter", "nanoforge", "commodities", ...). */
  source: string;
  /** Rule-specific fixed entries (e.g. effect, cardType, step). */
  effect?: string;
}

export type ChoosePlanet = DecisionBase<
  "choose.planet",
  ChooseBase & { planet: string; planetName?: string; tile?: string | null }
>;

export type ChooseSystem = DecisionBase<
  "choose.system",
  ChooseBase & {
    /** Tile position on the map (absent when the tile is not on the map yet, see tileId). */
    tile?: string;
    /** Tile id from the tile data (Star Charts: a tile still to be placed). */
    tileId?: string;
    tileName?: string | null;
  }
>;

export type ChoosePlayer = DecisionBase<"choose.player", ChooseBase & { faction: string; color?: string | null }>;

export type ChooseUnit = DecisionBase<
  "choose.unit",
  ChooseBase & { unit: string; tile?: string; planet?: string; planetName?: string }
>;

export type ChooseAmount = DecisionBase<
  "choose.amount",
  ChooseBase & {
    amount: number | null;
    /** commodities: "gain_commodities" | "convert_commodities". */
    effect?: "gain_commodities" | "convert_commodities" | string;
  }
>;

export type ChooseCard = DecisionBase<
  "choose.card",
  ChooseBase & {
    cardType: "relic" | "explore_deck" | "action_card" | "card" | string;
    relic?: string;
    relicName?: string;
    relicText?: string;
    relic2?: string;
    relic2Name?: string;
    card?: string;
    trait?: string;
    position?: number | null;
    faction?: string;
    faction2?: string;
    choice?: string;
    step?: number;
  }
>;

export type ChooseConfirm = DecisionBase<
  "choose.confirm",
  ChooseBase & { confirm: boolean; choice?: string }
>;

export type ChooseDecision =
  | ChoosePlanet
  | ChooseSystem
  | ChoosePlayer
  | ChooseUnit
  | ChooseAmount
  | ChooseCard
  | ChooseConfirm;

/** The component action menu (ephemeral reply to the acting player). Cancel has value null. */
export type ComponentAction = DecisionBase<
  "component.action",
  {
    /** tech | leader | relic | pn | ability | getRelic | generic | exhaustBT | doStarCharts | ... */
    component: string;
    id: string | null;
    name?: string | null;
    /** leader only: agent | commander | hero. */
    leaderType?: string | null;
  }
>;

/** Using a relic outside the component-action menu. Declines have value null. */
export type RelicUse = DecisionBase<
  "relic.use",
  {
    relic: string | null;
    relicName?: string;
    relicText?: string;
    effect:
      | "exhaust"
      | "use"
      | "draw_action_card"
      | "tech_skip"
      | "look_explore_decks"
      | "look_relic_deck"
      | "move_from_command_token_systems"
      | "ready_agent"
      | string;
    leader?: string;
    faction?: string;
  }
>;

/** The generic "use an agent" step: optional offers and the "choose the user of the agent" menu. */
export type LeaderAgent = DecisionBase<
  "leader.agent",
  {
    leader: string;
    leaderName: string;
    /** The seated faction named in the id (the player the agent is used on/for), if any. */
    faction: string | null;
    args: string[];
    /** getAgentSelection_: opens the "who uses it" menu. */
    select?: boolean;
  }
>;

export type ComponentsDecision = ChooseDecision | ComponentAction | RelicUse | LeaderAgent;

export const COMPONENT_KINDS: ReadonlySet<string> = new Set([
  "choose.planet",
  "choose.system",
  "choose.player",
  "choose.unit",
  "choose.amount",
  "choose.card",
  "choose.confirm",
  "component.action",
  "relic.use",
  "leader.agent",
]);
