/**
 * Autopilot trade policy over typed engine data (pure). Used by chooseTyped (answering trade.offer and
 * trade.force_replenish) and by botplay/trade.ts (proposing N-1 washes through the trade.propose action).
 *
 * - Neighbours only: a partner must be in GameState.trade.mayTransactWith (action phase: neighbours or
 *   Guild Ships / Trade Convoys / space stations / Age of Commerce; anyone outside the action phase).
 * - Accept anything fair: every TG or commodity counts 1 (commodities become TG on arrival); when we send
 *   commodities we accept being 1 behind (the N-1 wash). Never give away promissory notes, action cards, relics,
 *   fragments or debt. Dark Pact (Empyrean) adds the +1 TG it pays to a full-value commodity gift.
 */
import type { Decision, DecisionOf, FactionId, GameState, Option, PlayerState } from "./types.js";
import type { TradeCounterparty, TradeItem, TradeSelf, TradeSide, TradeState } from "./kinds/trade.js";

export type Verdict = { accept: boolean; why: string };

/** Whether an offer between `me` and `other` (factions) is fair to us. */
export function judge(items: TradeItem[], me: string, other: string, state: GameState | null): Verdict {
  let gain = 0;
  let cost = 0;
  let commOut = 0;
  let commIn = 0;
  for (const i of items) {
    if (i.kind === "note") continue;
    if (/debt/i.test(i.kind)) return { accept: false, why: "debt is not part of a wash" };
    const toUs = i.from === other && i.to === me;
    if (toUs) {
      gain += i.kind === "tg" || i.kind === "commodities" ? i.amount : Math.max(1, i.amount);
      if (i.kind === "commodities") commIn += i.amount;
      continue;
    }
    if (i.kind === "tg") cost += i.amount;
    else if (i.kind === "commodities") {
      cost += i.amount;
      commOut += i.amount;
    } else return { accept: false, why: `we never give away ${i.label}` };
  }
  gain += darkPactBonus(state, me, other, commOut) + darkPactBonus(state, other, me, commIn);
  const value = gain - cost;
  if (gain === 0) return { accept: false, why: "nothing in it for us" };
  if (value >= 0) return { accept: true, why: `fair (we get ${gain}, give ${cost})` };
  if (commOut > 0 && value >= -1) return { accept: true, why: `N-1 wash (our ${commOut} commodities for ${gain})` };
  return { accept: false, why: `not fair (we get ${gain}, give ${cost})` };
}

/**
 * Dark Pact: when the holder gives the Empyrean player commodities equal to the holder's commodity value, both gain
 * 1 TG. Returns 1 when `sender` giving `n` commodities to `receiver` triggers it.
 */
export function darkPactBonus(state: GameState | null, sender: string, receiver: string, n: number): number {
  if (!state || n <= 0 || receiver !== "empyrean") return 0;
  const s = state.players.find((p) => p.faction === sender);
  return s && s.promissoryNotesInPlayArea.includes("dark_pact") && n === s.commoditiesMax ? 1 : 0;
}

/** The wash we would propose to a partner: both sides plus a description, or null when there is no deal. */
export function washDeal(me: TradeSelf, cp: TradeCounterparty, state: GameState | null): { give: TradeSide; receive: TradeSide; text: string } | null {
  const mine = me.canSendCommodities ? me.commodities : 0;
  const theirs = cp.canSendCommodities ? cp.commodities : 0;
  if (mine > 0 && mine === me.commoditiesTotal && cp.tg >= mine - 1 && darkPactBonus(state, me.faction, cp.faction, mine)) {
    return { give: { commodities: mine }, receive: { tg: mine - 1 }, text: `our ${mine} commodities for ${mine - 1} TG (Dark Pact +1 each)` };
  }
  if (mine > 0 && theirs > 0) {
    const k = Math.min(mine, theirs);
    return { give: { commodities: k }, receive: { commodities: k }, text: `swap ${k} commodities each` };
  }
  if (mine >= 2 && cp.tg >= 1) {
    const n = Math.min(mine, cp.tg + 1);
    return { give: { commodities: n }, receive: { tg: n - 1 }, text: `our ${n} commodities for ${n - 1} TG` };
  }
  if (theirs >= 2 && me.tg >= 1) {
    const n = Math.min(theirs, me.tg + 1);
    return { give: { tg: n - 1 }, receive: { commodities: n }, text: `their ${n} commodities for ${n - 1} of our TG` };
  }
  return null;
}

/** Phases a bot proposes washes in: the action phase only (pbd161: offers during status/agenda were noise). */
export function proposesTradesIn(phase: string | null | undefined): boolean {
  return /^action/i.test(phase ?? "");
}

export function mayTransact(trade: TradeState | null | undefined, faction: FactionId): boolean {
  return !!trade && !trade.blockedReason && trade.mayTransactWith.includes(faction);
}

type Choice = { option: Option<any>; why: string };

/** trade.offer: accept a fair, current offer from a partner we may transact with; reject everything else. */
export function chooseOffer(d: DecisionOf<"trade.offer">, state: GameState | null, self: PlayerState | undefined): Choice | null {
  const accept = d.options.find((o) => !o.disabled && o.value?.action === "accept");
  const reject = d.options.find((o) => !o.disabled && o.value?.action === "reject");
  const offer = (accept ?? reject)?.value;
  if (!offer || !self?.faction || !reject) return null;
  if (!state?.trade) return null;
  const live = state.trade.incoming.some((o) => o.decisionId === d.id);
  if (!offer.current || !live) return { option: reject, why: "offer was replaced or withdrawn" };
  if (!mayTransact(state.trade, offer.from)) return { option: reject, why: "we are not neighbours" };
  const verdict = judge(offer.items, self.faction, offer.from, state);
  if (verdict.accept && accept) return { option: accept, why: verdict.why };
  return { option: reject, why: verdict.why };
}

/**
 * trade.force_replenish (we hold Trade): replenish a partner for free when we can wash with them afterwards (they
 * have room, may send commodities, we may transact and have TG for an N-1 wash); then "Done".
 */
export function chooseForceReplenish(d: DecisionOf<"trade.force_replenish">, state: GameState | null): Choice | null {
  const trade = state?.trade;
  if (!trade) return null;
  for (const o of d.options) {
    const v = o.value;
    if (!v || o.disabled) continue;
    const cp = trade.partners.find((p) => p.faction === v.faction);
    if (!cp || !mayTransact(trade, v.faction) || !cp.canSendCommodities || v.commodities >= v.commoditiesMax) continue;
    if (trade.me.tg < 1 && !(trade.me.canSendCommodities && trade.me.commodities > 0)) continue;
    return { option: o, why: `Trade: free replenish for ${cp.userName}, then wash with them` };
  }
  const done = d.options.find((o) => !o.disabled && !o.value);
  return done ? { option: done, why: "Trade: nobody else worth replenishing" } : null;
}

export function chooseTrade(d: Decision, state: GameState | null, self: PlayerState | undefined): Choice | null {
  if (d.kind === "trade.offer") return chooseOffer(d, state, self);
  if (d.kind === "trade.force_replenish") return chooseForceReplenish(d, state);
  // trade.offer_sent (Rescind): never on our own.
  return null;
}
