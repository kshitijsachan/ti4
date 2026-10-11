/**
 * Autopilot policy for the G2 strategy-card kinds. Pure: (decision, state, me, ctx) → option | null (null = leave it).
 *
 * The bugs this is shaped against:
 *  - a multi-part primary resolved halfway (Diplomacy: system AND ready planets; Construction: two structures;
 *    Imperial: public AND Mecatol point / secret): the holder walks the card's `primaryParts` checklist against
 *    `ctx.history` (its own successful answers on that message), one part per call, until every part is pressed;
 *  - following your own card: the holder only ever presses `who: holder|anyone` options; the engine refuses the rest;
 *  - answering a follow twice / after declining: non-holders answer the card once (window.responses + history);
 *  - double token gain: tokens gained are read from pools (current − original), never counted from presses, and an
 *    edit-in-place panel is not answered again until the engine re-captured it (revision moved).
 */
import { researchable, TECH_PREFERENCE } from "../../botplay/techs.js";
import type { Decision, GameState, Option, PlayerState } from "../types.js";
import type {
  ConstructionBuild,
  ConstructionPlace,
  DiplomacySystem,
  PlanetReady,
  PoliticsAgenda,
  PoliticsSpeaker,
  PrimaryPart,
  StrategicAction,
  StrategyCardResolve,
} from "./strategy.js";

export type StrategyChoice = { option: Option<any>; why: string };

export interface PolicyCtx {
  /** Option ids this seat answered successfully on this decision, oldest first. */
  history: string[];
  /** The decision revision at this seat's last successful answer (undefined: never answered). */
  lastRevision?: number;
  /** This seat's other open decisions in the game (to wait for a sub-prompt before the next part). */
  open: Decision[];
  /** Every open decision of the game, all seats (other areas' policies look for windows / pending prompts). */
  all: Decision[];
}

/** Kinds whose prompt is edited in place after each press: wait for the new revision before answering again. */
const EDIT_IN_PLACE = new Set(["command_tokens.adjust", "planet.ready"]);

export const STRATEGY_POLICY_KINDS = new Set([
  "strategy_card.resolve",
  "strategy_card.strategic_action",
  "strategy_card.diplomacy_system",
  "planet.ready",
  "strategy_card.politics_speaker",
  "strategy_card.politics_agenda",
  "strategy_card.construction_place",
  "strategy_card.construction_build",
  "command_tokens.adjust",
]);

const live = <V>(d: { options: Option<V>[] }) => d.options.filter((o) => !o.disabled && !o.needsInput);

export function chooseStrategy(d: Decision, state: GameState | null, me: string, ctx: PolicyCtx): StrategyChoice | null {
  if (EDIT_IN_PLACE.has(d.kind) && ctx.lastRevision !== undefined && ctx.lastRevision === d.revision) return null;
  const self = state?.players.find((p) => p.userId === me) ?? null;
  switch (d.kind as string) {
    case "strategy_card.resolve":
      return resolveCard(d as StrategyCardResolve, state, self, me, ctx);
    case "strategy_card.strategic_action":
      return strategicAction(d as StrategicAction, state, self);
    case "strategy_card.diplomacy_system":
      return diplomacySystem(d as DiplomacySystem);
    case "planet.ready":
      return readyPlanets(d as PlanetReady, ctx);
    case "strategy_card.politics_speaker":
      return speaker(d as PoliticsSpeaker);
    case "strategy_card.politics_agenda":
      return agenda(d as PoliticsAgenda);
    case "strategy_card.construction_place":
      return constructionPlace(d as ConstructionPlace);
    case "strategy_card.construction_build":
      return constructionBuild(d as ConstructionBuild);
    case "command_tokens.adjust":
      return commandTokens(d, state, self, me, ctx);
    default:
      return null;
  }
}

// ---------------------------------------------------------------- the played card

function resolveCard(d: StrategyCardResolve, state: GameState | null, self: PlayerState | null, me: string, ctx: PolicyCtx): StrategyChoice | null {
  const opts = live(d).filter((o) => o.value);
  const any = opts[0]?.value;
  if (!any || !self) return null;
  const sc = any.strategyCard;
  // The thread copy carries the same buttons: answer the main message when it is open too.
  if (any.copy && ctx.open.some((x) => x.kind === "strategy_card.resolve" && x.id !== d.id && x.options.some((o) => o.value && !o.value.copy && o.value.strategyCard === sc))) return null;
  const holder = self.strategyCards.includes(sc) || any.holder === self.faction;
  if (holder) return holderPart(d, opts, self, ctx);
  // A follower answers the card once: decline, or press the secondary directly (it spends the token itself).
  const status = d.window?.responses?.[me] ?? state?.strategyCards.find((c) => c.number === sc)?.reactions.find((r) => r.faction === self.faction)?.status;
  if (ctx.history.length || (status && status !== "pending")) return null;
  const reaction = state?.strategyCards.find((c) => c.number === sc)?.reactions.find((r) => r.faction === self.faction);
  const decline = opts.find((o) => o.value!.action === "decline");
  const tokens = self.commandTokens.strategy;
  const canFollow = reaction ? reaction.canFollow : tokens > 0;
  const secondary = (action: string) => opts.find((o) => o.value!.action === action && o.value!.who !== "holder");
  if (canFollow && tokens >= 2) {
    const card = any.card ?? "";
    let pick: Option<StrategyCardResolve["options"][number]["value"]> | undefined;
    let why = "";
    if (card === "pok5trade" && self.commodities < self.commoditiesMax) {
      pick = opts.find((o) => o.value!.action === "follow");
      why = `follow Trade: replenish commodities (${self.commodities}/${self.commoditiesMax})`;
    } else if (card === "pok8imperial" && self.secretObjectiveCount + Object.keys(self.secretsScored ?? {}).length < 3) {
      pick = secondary("draw_secret");
      why = "follow Imperial: draw a secret objective";
    } else if (card === "pok3politics") {
      pick = secondary("draw_action_cards");
      why = "follow Politics: draw 2 action cards";
    }
    if (pick) return { option: pick, why };
  }
  return decline ? { option: decline, why: canFollow ? "strategy card: not following" : `strategy card: cannot follow (${reaction?.cantFollowReason ?? "no strategy token"})` } : null;
}

/** The holder: the next primary part not yet pressed on this message, in the card's checklist order. */
function holderPart(d: StrategyCardResolve, opts: Option<StrategyCardResolve["options"][number]["value"]>[], self: PlayerState, ctx: PolicyCtx): StrategyChoice | null {
  const v = opts[0].value!;
  const mine = opts.filter((o) => o.value!.who !== "others");
  const pressed = (part: PrimaryPart) => ctx.history.filter((id) => mine.find((o) => o.id === id)?.value?.part === part).length;
  // Wait for the sub-prompt a previous part opened (a system to choose, a planet for a structure).
  if (ctx.open.some((x) => x.kind === "strategy_card.diplomacy_system" || x.kind === "strategy_card.construction_place" || x.kind === "strategy_card.construction_build")) return null;
  const needed: Record<string, number> = {};
  for (const p of v.primaryParts) needed[p] = (needed[p] ?? 0) + 1;
  const holdsMecatol = self.planets.some((p) => /^(mr|mrte)$/i.test(p));
  for (const part of v.primaryParts) {
    if (pressed(part) >= (needed[part] ?? 1)) continue;
    let candidates = mine.filter((o) => o.value!.part === part);
    if (part === "structure") {
      // Space dock first when there is room to build one away from home, then a PDS (the second structure is
      // always a PDS).
      const first = pressed("structure") === 0;
      const want = first && self.planets.length >= 4 ? "spacedock" : "pds";
      candidates = candidates.filter((o) => o.value!.unit === want).concat(candidates.filter((o) => o.value!.unit === "pds"));
    }
    if (part === "imperial") candidates = candidates.filter((o) => (holdsMecatol ? o.value!.action === "score_imperial" : o.value!.action === "draw_secret"));
    if (part === "warfare_primary") continue; // removing a command token from the board is not planned yet
    const pick = candidates[0];
    if (pick) return { option: pick, why: `${v.name} primary: ${part}${needed[part] > 1 ? ` ${pressed(part) + 1}/${needed[part]}` : ""}` };
    // Parts answered by other prompts (Politics speaker / agendas) or not offered here: skip them.
  }
  return null;
}

function strategicAction(d: StrategicAction, state: GameState | null, self: PlayerState | null): StrategyChoice | null {
  if (!self || (state?.activePlayer && state.activePlayer !== self.userId && state.activePlayer !== self.color && state.activePlayer !== self.faction)) return null;
  const o = live(d).find((x) => x.value && self.strategyCards.includes(x.value.strategyCard) && !state?.strategyCards.find((c) => c.number === x.value!.strategyCard)?.played);
  return o ? { option: o, why: `play ${o.value!.name}` } : null;
}

// ---------------------------------------------------------------- sub-prompts

function diplomacySystem(d: DiplomacySystem): StrategyChoice | null {
  const opts = live(d).filter((o) => o.value && !o.value.mahact);
  // The best system that is not the home system (home is safe enough early), else home.
  const score = (o: (typeof opts)[number]) => (o.value!.home ? -100 : 0) + o.value!.resources + o.value!.influence + o.value!.planets.length;
  const best = [...opts].sort((a, b) => score(b) - score(a))[0];
  return best ? { option: best, why: `Diplomacy: protect ${best.value!.tile} (${best.value!.planets.join(", ")})` } : null;
}

function readyPlanets(d: PlanetReady, ctx: PolicyCtx): StrategyChoice | null {
  const opts = live(d);
  const done = opts.find((o) => o.value?.done) ?? opts.find((o) => /^deleteButtons/.test(o.handler));
  const limit = done?.value?.done ? done.value.limit : 2;
  const readied = ctx.history.filter((id) => id !== done?.id).length;
  const worth = (o: (typeof opts)[number]) => (o.value && !o.value.done ? o.value.resources + o.value.influence : -1);
  const planets = opts.filter((o) => worth(o) >= 0).sort((a, b) => worth(b) - worth(a));
  if (readied < limit && planets[0]) return { option: planets[0], why: `ready ${planets[0].value!.planet} (${readied + 1}/${limit})` };
  return done ? { option: done, why: `done readying planets (${readied})` } : null;
}

function speaker(d: PoliticsSpeaker): StrategyChoice | null {
  const opts = live(d).filter((o) => o.value);
  const o = opts.find((x) => x.value!.self) ?? opts[0];
  return o ? { option: o, why: `Politics: speaker to ${o.value!.faction}` } : null;
}

function agenda(d: PoliticsAgenda): StrategyChoice | null {
  const opts = live(d).filter((o) => o.value);
  const draw = opts.find((o) => o.value!.action === "draw");
  if (draw) return { option: draw, why: "Politics: look at the top 2 agendas" };
  const top = opts.find((o) => o.value!.action === "top");
  const v = top?.value;
  return top && v && v.action !== "draw" ? { option: top, why: `Politics: ${v.agenda ?? "agenda"} on top` } : null;
}

function constructionPlace(d: ConstructionPlace): StrategyChoice | null {
  const opts = live(d).filter((o) => o.value);
  if (!opts.length) return null;
  const unit = opts[0].value!.unit;
  const score = (o: (typeof opts)[number]) => {
    const v = o.value!;
    if (unit === "spacedock") return (v.home ? -50 : 0) - v.spaceDock * 100 + v.resources * 2 + v.influence;
    return -v.pds * 10 + (v.home ? 5 : 0) + v.resources + v.influence;
  };
  const best = [...opts].sort((a, b) => score(b) - score(a))[0];
  return { option: best, why: `Construction: ${unit} on ${best.value!.planet}` };
}

type Pools = { tactic: number; fleet: number; strategy: number };
const sum = (p: Pools | null | undefined) => (p ? p.tactic + p.fleet + p.strategy : 0);
const isPools = (x: unknown): x is Pools => !!x && typeof (x as Pools).tactic === "number" && typeof (x as Pools).fleet === "number";

/**
 * The command-token panel (kind command_tokens.adjust, owned by G7: value {action:"adjust", pool, delta} | {action:
 * "reset"}, progress.accumulated = current pools). Only the Leadership panel (Done = deleteButtons_leadership) is
 * answered here: gain up to 3 (holder), by pools — current − original when the engine supplies the original pools
 * (progress.required.original or value.original), else by our own answers on this panel, one per revision.
 */
function commandTokens(d: Decision, state: GameState | null, self: PlayerState | null, me: string, ctx: PolicyCtx): StrategyChoice | null {
  const opts = (d.options as Option<any>[]).filter((o) => !o.disabled && !o.needsInput);
  const done = opts.find((o) => o.handler === "deleteButtons_leadership");
  if (!done || !self) return null;
  const isGain = (o?: Option<any>) => !!o?.value && (o.value.action === "gain" || (o.value.action === "adjust" && o.value.delta === 1));
  const acc = d.progress?.accumulated;
  const current: Pools = isPools(acc) ? acc : isPools(opts.find((o) => isPools(o.value?.current))?.value?.current) ? opts.find((o) => isPools(o.value?.current))!.value.current : self.commandTokens;
  const origRaw = d.progress?.required?.original ?? opts.find((o) => isPools(o.value?.original))?.value?.original;
  const original = isPools(origRaw) ? origRaw : null;
  const gained = original ? sum(current) - sum(original) : ctx.history.filter((id) => isGain(opts.find((o) => o.id === id))).length;
  const reinforcements = Number(opts.find((o) => typeof o.value?.reinforcements === "number")?.value?.reinforcements ?? Infinity);
  const leadership = state?.strategyCards.find((c) => c.card === "pok1leadership" && c.played && c.holder === me);
  const allowance = leadership ? 3 : 0;
  if (gained < allowance && reinforcements > 0) {
    const pool: keyof Pools = current.fleet < 3 && gained === 2 ? "fleet" : current.strategy < 2 && gained === 1 ? "strategy" : "tactic";
    const o = opts.find((x) => isGain(x) && x.value.pool === pool) ?? opts.find((x) => isGain(x) && x.value.pool === "tactic");
    if (o) return { option: o, why: `Leadership: gain a ${o.value.pool} token (${gained + 1}/${allowance})` };
  }
  return { option: done, why: `Leadership: done, gained ${gained} command tokens` };
}

// ---------------------------------------------------------------- technology (Technology primary)

/** Technology primary: the next preferred technology among those offered whose prerequisites are met. */
export function chooseResearch(options: Option<any>[], owned: string[]): Option<any> | null {
  const rank = (a: string) => (TECH_PREFERENCE.indexOf(a) < 0 ? 99 : TECH_PREFERENCE.indexOf(a));
  const offered = options.filter((o) => !o.disabled && o.value?.tech && !owned.includes(o.value.tech) && researchable(o.value.tech, owned));
  offered.sort((a, b) => rank(a.value.tech) - rank(b.value.tech));
  return offered[0] ?? null;
}

/** Construction "produce" (Thunder's Edge): no decline here, so use the dock with the most PRODUCTION (home last). */
function constructionBuild(d: ConstructionBuild): StrategyChoice | null {
  const opts = live(d).filter((o) => o.value);
  const score = (o: (typeof opts)[number]) => (o.value!.productionLimit ?? 0) * 10 + o.value!.spaceDocks - (o.value!.home ? 1 : 0);
  const best = [...opts].sort((a, b) => score(b) - score(a))[0];
  return best ? { option: best, why: `Construction: produce at ${best.value!.tile}` } : null;
}
