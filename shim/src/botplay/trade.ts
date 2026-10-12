import type { EngineClient } from "../engine/client.js";
import { mayTransact, proposesTradesIn, washDeal } from "../engine/tradePolicy.js";
import type { TradeCounterparty } from "../engine/types.js";
import { baseId, type Prompt } from "./prompts.js";
import type { Seat } from "./seat.js";

/*
 * Trade initiative for an autopilot seat, on the typed engine API only (docs/ENGINE.md, G11):
 *
 * - Answering offers (trade.offer) and the Trade card's free replenish (trade.force_replenish) is pure policy in
 *   engine/tradePolicy.ts, run by chooseTyped like every typed decision.
 * - Here: N-1 washes, in the action phase only (no unsolicited offers during strategy/status/agenda). At most one
 *   proposal per partner per round, never stacked on an open offer either way, a few seconds apart per seat and once
 *   a minute per partner across all seats; only with partners we may transact with (GameState.trade.mayTransactWith:
 *   neighbours, or anyone with Guild Ships, Trade Convoys, …).
 *   Partners we just replenished with Trade (their commodities went up) get their wash naturally: washDeal offers
 *   "their N commodities for N-1 of our TG" or a swap.
 */

/** Minimum time between two proposals of one seat in a game. */
const PROPOSE_GAP_MS = 25000;
/** Minimum time between two proposals to the same partner, from any seat. */
const PARTNER_GAP_MS = 60000;
/** Bot buttons the legacy rule table must leave alone: answered through typed decisions (or never, for Rescind). */
const OWNED_ID = /^(acceptOffer_|rejectOffer_|resetOffer_|rescindOffer_|forceARefresh_)/;

/** Partner user id → when any seat last proposed to them. */
const lastToPartner = new Map<string, number>();

export class TradeDesk {
  /** `${game}:${faction}` → round we proposed a wash in. */
  private proposed = new Map<string, number>();
  private lastPropose = new Map<string, number>();

  constructor(
    private seat: Seat,
    private engine: () => EngineClient | undefined,
  ) {}

  /**
   * Prompts the rule table must leave alone while the engine answers trades: only while the engine is reachable (its
   * stream is live). Engine off or down: the rule table answers offers as before (bots just don't propose).
   */
  owns(_game: string, p: Prompt): boolean {
    return !!this.engine()?.isLive && p.controls.some((c) => OWNED_ID.test(baseId(c.custom_id)));
  }

  /** One trading step for a game. Returns true when it sent an offer. */
  async tick(game: string): Promise<boolean> {
    const engine = this.engine();
    if (!engine) return false;
    if (Date.now() - (this.lastPropose.get(game) ?? 0) < PROPOSE_GAP_MS) return false;
    this.lastPropose.set(game, Date.now() - PROPOSE_GAP_MS + 8000 + Math.random() * 6000);
    const state = await engine.state(game, this.seat.userId, 2000);
    const trade = state?.trade;
    if (!state || !trade || trade.blockedReason || !proposesTradesIn(state.phase)) return false;
    const me = trade.me;
    if (me.commodities === 0 && me.tg === 0) return false;
    const busy = new Set([...trade.incoming.map((o) => o.from), ...trade.outgoing.map((o) => o.to)]);
    const pick = trade.partners
      .filter((c) => mayTransact(trade, c.faction) && !busy.has(c.faction) && this.proposed.get(`${game}:${c.faction}`) !== state.round)
      .filter((c) => Date.now() - (lastToPartner.get(c.userId) ?? 0) >= PARTNER_GAP_MS)
      .map((c) => ({ c, deal: washDeal(me, c, state) }))
      .find((x): x is { c: TradeCounterparty; deal: NonNullable<ReturnType<typeof washDeal>> } => !!x.deal);
    if (!pick) return false;
    this.proposed.set(`${game}:${pick.c.faction}`, state.round);
    this.lastPropose.set(game, Date.now());
    lastToPartner.set(pick.c.userId, Date.now());
    const note = `Commodity wash: ${pick.deal.text.replace(/\bour\b/g, "my").replace(/\btheir\b/g, "your")}. We both gain.`;
    const res = await engine.proposeTrade(game, { userId: this.seat.userId, to: pick.c.faction, give: pick.deal.give, receive: pick.deal.receive, note });
    this.seat.log(`trade: offered ${pick.c.userName} N-1 wash: ${pick.deal.text}${res?.ok ? "" : ` -> failed: ${res?.error ?? "no answer"}`}`);
    return !!res?.ok;
  }
}
