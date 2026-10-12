/**
 * Shared faction kinds (phase C, c1..c5 faction agents). Mirrors bot ti4/selfhost/engine/kinds/{LeaderUseKind,
 * FactionAbilityKind,FactionSteps*}.java. One kind for every faction's leaders and one for every faction ability /
 * faction tech / faction promissory-note resolution / mech / flagship / breakthrough; per-faction steps are told
 * apart by `leader` / `id` + `step`. Ids only (planet ids, tile positions, unit async ids, factions), never labels.
 *
 * A message is one of these kinds only when every option is a faction step or chrome (Decline / Done / UNDO):
 * options that sit on other areas' menus (turn menu, combat controls, cards-info menu) stay with those kinds.
 */
import type { DecisionBase, FactionId } from "../types.js";

/** Fields shared by both kinds. Only fields present in the option id are set. */
export type FactionStepFields = {
  /** Faction the component belongs to (the leader's / ability's faction; for a note, its owner faction). */
  faction: FactionId | null;
  /** Engine step (handler prefix), e.g. "mitosis", "exhaustAgent", "starforge". */
  step: string;
  /** use = start / accept an optional effect; target = a choice inside an effect under way; skip = finish early. */
  action: "use" | "target" | "skip";
  /** True when the effect may be declined (a Decline/Done option is offered or this is an offer). */
  optional: boolean;
  /** Another player the step targets (faction). */
  target?: FactionId;
  /** Tile position. */
  tile?: string;
  planet?: string;
  /** "space" or a planet id. */
  holder?: string;
  /** Unit async id (gf, mf, dd, ff, ...). */
  unit?: string;
  damaged?: boolean;
  count?: number;
  amount?: number;
  /** Cost in trade goods / resources the step charges. */
  cost?: number;
  free?: boolean;
  from?: string;
  hits?: number;
  /** Dice still eligible (Hacan flagship). */
  remaining?: number;
  /** "Start over" (Hacan flagship). */
  reset?: boolean;
  strategyCard?: number;
  ownStrategyCard?: number;
  /** Raw id segments the kind does not type further. */
  args?: string[];
  /** Group C: Jol-Nar hero swap (tech in / out), Yssaril commander (what) / Spy Net (who) / hand cards, Yin hits. */
  tech?: string;
  techOut?: string;
  /** Yssaril-style look (ac / pn / so: whose cards to look at); Mentak pillage (tg / commodity: what to take). */
  what?: "ac" | "pn" | "so" | "tg" | "commodity";
  who?: "self" | "yssaril";
  actionCard?: string;
  cardName?: string;
  exo?: boolean;
};

/** Agents, commanders, heroes. Generic ids: exhaustAgent_<agent>[_<target>], getAgentSelection_<agent>. */
export type LeaderUse = DecisionBase<
  "leader.use",
  FactionStepFields & {
    leader: string;
    leaderType: "agent" | "commander" | "hero" | string;
  }
>;

/** Faction abilities, faction techs, faction promissory-note resolutions, mech / flagship abilities, breakthroughs. */
export type FactionAbility = DecisionBase<
  "faction.ability",
  FactionStepFields & {
    source: "ability" | "tech" | "promissory" | "mech" | "flagship" | "breakthrough" | string;
    /** Ability id / tech id / promissory note id / unit id / breakthrough id. */
    id: string;
  }
>;

export type FactionDecision = LeaderUse | FactionAbility;
