/**
 * Components (C6): the component action menu, relic uses and the generic single-choice kinds
 * choose.{planet,system,player,unit,card,confirm}. Mirrors bot ti4.selfhost.engine.kinds.{ComponentAction,RelicUse,
 * Choose*}Kind. Agent exhaust steps are leader.use (kinds/faction.ts); commodity gain/convert is commodities.gain.
 * Ids only for logic; *Name/*Text are
 * for display.
 *
 * The choose.* kinds are reusable building blocks: one value shape per kind, `source` names the card / ability /
 * relic asking. Add a rule to the bot's Choose*Kind.RULES to type another one-step prompt; the bot policy
 * (policy/components.ts) and the web renderer (renderers/components) then handle it with no further change.
 */
import type { DecisionBase, FactionId, PlanetId, RelicId, TileId, TilePosition } from "../types.js";

/** Fields every choose.* value carries. */
export interface ChooseBase {
  /** What asks: relic / ability / card id ("stellarconverter", "nanoforge", "commodities", ...). */
  source: string;
  /** Rule-specific fixed entries (e.g. effect, cardType, step). */
  effect?: string;
}

export type ChoosePlanet = DecisionBase<
  "choose.planet",
  ChooseBase & { planet: PlanetId; planetName?: string; tile?: TilePosition | null }
>;

export type ChooseSystem = DecisionBase<
  "choose.system",
  ChooseBase & {
    /** Tile position on the map (absent when the tile is not on the map yet, see tileId). */
    tile?: TilePosition;
    /** Tile id from the tile data (Star Charts: a tile still to be placed). */
    tileId?: TileId;
    tileName?: string | null;
  }
>;

export type ChoosePlayer = DecisionBase<"choose.player", ChooseBase & { faction: FactionId; color?: string | null }>;

export type ChooseUnit = DecisionBase<
  "choose.unit",
  ChooseBase & {
    unit: string;
    tile?: TilePosition;
    planet?: PlanetId;
    planetName?: string;
    /** source "remove_unit_type" (remove one unit of a type: the plastic-limit warning): "space" or a planet id. */
    holder?: string;
    /** remove_unit_type: the units' owner color; destroy: "destroy" when the removal destroys. */
    color?: string;
    destroy?: string;
  }
>;

export type ChooseCard = DecisionBase<
  "choose.card",
  ChooseBase & {
    cardType: "relic" | "explore_deck" | "action_card" | "card" | string;
    relic?: RelicId;
    relicName?: string;
    relicText?: string;
    relic2?: RelicId;
    relic2Name?: string;
    card?: string;
    trait?: string;
    position?: number | null;
    faction?: FactionId;
    faction2?: FactionId;
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
    relic: RelicId | null;
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
      | "purge_for_technology"
      | "purge_for_point"
      | string;
  }
>;

/**
 * A generic technology's follow-up step (bot TechStepKind). source = tech alias ("bs", "td", "sr", "sar", "ie", "md",
 * "dxa", "pa"; "research" for "Get a Technology"; "entropicscar"; "ground_hit" for the unit a Magen / Ruthless hit
 * targets). step:
 *  - exhaust: a standalone "exhaust <tech>" offer (source = that tech)
 *  - ready (Bio-Stims: target "tech" | "planet"), destination (Transit Diodes), system (Sling Relay),
 *    planet (Self-Assembly Routines), use (Integrated Economy / Magen / Dacxive offers), target (ground hit),
 *    open / exhaust_planet (Psychoarchaeology), research (Get a Technology), gain (Entropic Scar faction tech)
 * Declines / Done have value null.
 */
export type TechStep = DecisionBase<
  "tech.step",
  ChooseBase & {
    step: "exhaust" | "ready" | "destination" | "system" | "planet" | "use" | "target" | "open" | "exhaust_planet" | "research" | "gain" | string;
    techName?: string;
    /** The technology named in the id (exhaust: the source itself; Bio-Stims: the tech to ready; Entropic Scar: the tech gained). */
    tech?: string;
    targetTechName?: string;
    /** Bio-Stims: what gets readied. */
    target?: "tech" | "planet";
    planet?: string;
    planetName?: string;
    tile?: string | null;
    tileName?: string | null;
    /** ground_hit: the opposing unit (async id, "damaged"/"galvanized" suffixes) and its color; choice = the ability. */
    unit?: string;
    color?: string;
    choice?: string;
    unitUpgradeOnly?: boolean;
  }
>;

export type ComponentsDecision = ChooseDecision | ComponentAction | RelicUse | TechStep;

export const COMPONENT_KINDS: ReadonlySet<string> = new Set([
  "choose.planet",
  "choose.system",
  "choose.player",
  "choose.unit",
  "choose.card",
  "choose.confirm",
  "component.action",
  "relic.use",
  "tech.step",
]);
