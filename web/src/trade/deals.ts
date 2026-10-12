import { emptyDraft, type TradeDraft } from "./model";
import type { TradeCounterparty, TradeSelf } from "./types";

/** Who holds the Trade strategy card this round, and whether they have played it. */
export type TradeHolder = { faction: string; name: string; played: boolean };

/** A one-click deal with the selected partner. */
export type Deal = {
  key: string;
  title: string;
  give: string;
  get: string;
  /** Why it is good, or what happens after they accept. */
  hint: string;
  draft: TradeDraft;
};

const comm = (n: number) => `${n} commodit${n === 1 ? "y" : "ies"}`;
const tg = (n: number) => `${n} TG`;

function draftOf(give: Partial<TradeDraft["give"]>, receive: Partial<TradeDraft["receive"]>, note = ""): TradeDraft {
  const d = emptyDraft();
  return { give: { ...d.give, ...give }, receive: { ...d.receive, ...receive }, note };
}

/**
 * The standard commodity deals with one partner. Commodities are worth nothing until traded away: whoever receives
 * them gets trade goods. Notes avoid commas and underscores (the bot strips them) and Trade card deals say
 * "replenish", which autopilot seats look for.
 */
export function dealsWith(me: TradeSelf, cp: TradeCounterparty, holder: TradeHolder | null): Deal[] {
  const out: Deal[] = [];
  const mine = me.canSendCommodities ? me.commodities : 0;
  const theirs = cp.canSendCommodities ? cp.commodities : 0;
  if (mine > 0 && theirs > 0) {
    const k = Math.min(mine, theirs);
    out.push({
      key: "swap",
      title: "Swap commodities",
      give: comm(k),
      get: comm(k),
      hint: `Both of you turn ${k} commodities into trade goods.`,
      draft: draftOf({ commodities: k }, { commodities: k }, `Commodity swap: ${k} each`),
    });
  }
  if (mine >= 2 && cp.tg >= 1) {
    const n = Math.min(mine, cp.tg + 1);
    out.push({
      key: "sell",
      title: `Wash my commodities (${n} for ${n - 1})`,
      give: comm(n),
      get: tg(n - 1),
      hint: `They receive ${tg(n)} for your commodities and keep 1: you turn dead commodities into ${tg(n - 1)}.`,
      draft: draftOf({ commodities: n }, { tg: n - 1 }, `N-1 wash: my ${n} commodities for ${n - 1} TG`),
    });
  }
  if (theirs >= 2 && me.tg >= 1) {
    const n = Math.min(theirs, me.tg + 1);
    out.push({
      key: "buy",
      title: `Wash their commodities (${n} for ${n - 1})`,
      give: tg(n - 1),
      get: comm(n),
      hint: `Their ${n} commodities arrive as ${tg(n)}: you gain 1 TG.`,
      draft: draftOf({ tg: n - 1 }, { commodities: n }, `N-1 wash: your ${n} commodities for ${n - 1} TG`),
    });
  }
  const myRoom = me.canSendCommodities && me.commodities < me.commoditiesTotal;
  if (holder && holder.faction === cp.faction && myRoom) {
    const n = me.commoditiesTotal;
    out.push({
      key: "ask-replenish",
      title: "Ask to be replenished (Trade card)",
      give: `then ${comm(n)}`,
      get: `free replenish, then ${tg(n - 1)}`,
      hint: holder.played
        ? `${cp.userName} replenishes your commodities for free with Trade, then you wash them ${n} for ${n - 1} with them.`
        : `${cp.userName} holds Trade: when they play it they replenish you for free, then you wash ${n} for ${n - 1} with them.`,
      draft: draftOf({}, {}, `Trade card deal: please replenish my commodities for free with Trade. Then I wash them with you: my ${n} commodities for ${n - 1} TG.`),
    });
  }
  const theirRoom = cp.canSendCommodities && cp.commodities < cp.commoditiesTotal;
  if (holder && holder.faction === me.faction && theirRoom) {
    const n = Math.min(cp.commoditiesTotal, me.tg + 1);
    out.push({
      key: "offer-replenish",
      title: "Offer a free replenish (Trade card)",
      give: "free replenish",
      get: `then ${comm(n)} for ${tg(n - 1)}`,
      hint: `When they accept, press ${cp.userName} on Trade's "force players to replenish" prompt; they then wash ${n} for ${n - 1} with you.`,
      draft: draftOf({}, {}, `Trade card deal: accept and I replenish your commodities for free now (no strategy token). Then wash them with me: your ${n} commodities for ${n - 1} TG.`),
    });
  }
  return out;
}

/** The Trade card (initiative 5) holder from the game's player data. */
export function tradeHolderOf(
  players: { faction: string; userName: string; scs?: number[]; exhaustedSCs?: number[] }[] | undefined,
): TradeHolder | null {
  const p = players?.find((x) => (x.scs ?? []).includes(5));
  return p ? { faction: p.faction, name: p.userName, played: (p.exhaustedSCs ?? []).includes(5) } : null;
}
