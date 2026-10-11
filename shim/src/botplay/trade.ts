import type { Json } from "../store.js";
import { playerOf } from "./board.js";
import { baseId, type Control, type Prompt } from "./prompts.js";
import type { Seat } from "./seat.js";

/*
 * Trading for an autopilot seat, through the bot's selfhost trade API (`/api/game/{g}/trade/{options,propose,pending}`)
 * and the bot's own offer buttons (Accept / Reject in the seat's cards-info thread):
 *
 * - Offers to us: accept anything fair (we end up at most 1 behind when we send commodities, the "N for N-1" wash,
 *   otherwise not behind at all); reject the rest. Never give away promissory notes, action cards, relics, fragments
 *   or debt.
 * - N-1 washes: at most one proposal per partner per round (neighbours in the action phase, anyone outside it), a few seconds apart at most once per ~25s per seat and
 *   once a minute per partner across all seats: swap commodities when both have some, else "N commodities for N-1 TG".
 * - The Trade strategy card: when we hold it and it has been played, offer each player we may force-replenish a free
 *   replenish in exchange for an N-1 wash with us; when they accept (or ask us), press their faction on the bot's
 *   "force players to replenish" prompt and propose the wash. When the Trade holder offers us that deal we accept and
 *   wash with them once replenished.
 *
 * Deal-term notes carry the word "replenish" for the Trade card deal; the bot strips commas and underscores from notes.
 */

export const REPLENISH_NOTE = /\breplenish/i;
const OFFER_ID = /^(acceptOffer_|rejectOffer_|resetOffer_|rescindOffer_)/;
const FORCE_ID = /^forceARefresh_/;
/** Minimum time between two proposals of one seat in a game. */
const PROPOSE_GAP_MS = 25000;
/** Minimum time between two proposals to the same partner, from any seat. */
const PARTNER_GAP_MS = 60000;
/** A wash offered to a partner this recently (by our cards-info thread) counts as this round's, even after a restart. */
const RECENT_OFFER_MS = 25 * 60000;
/** How long a deal made around the Trade card stays good. */
const DEAL_MS = 20 * 60000;
/** A non-holder washes with the holder it owes this long after being replenished, unless the holder proposed first. */
const OWE_WAIT_MS = 15000;

type Item = { from: string; to: string; kind: string; amount: number; id?: string | null; label: string };
type ButtonRef = { channelId: string; messageId: string; customId: string };
type Offer = {
  direction: "incoming" | "outgoing";
  otherFaction: string;
  otherUserId: string;
  otherUserName: string;
  current: boolean;
  items: Item[];
  accept?: ButtonRef | null;
  reject?: ButtonRef | null;
};
type Pending = { incoming: Offer[]; outgoing: Offer[] };
type Party = { userId: string; userName: string; faction: string; color: string; tg: number; commodities: number; commoditiesTotal: number; canSendCommodities: boolean };
type Counterparty = Party & { canTrade: boolean; neighbor: boolean };
type Options = { phase: string; round: number; blockedReason?: string | null; me: Party; counterparties: Counterparty[] };
type Side = { tg?: number; commodities?: number };

/** Partner user id → when any seat last proposed to them. */
const lastToPartner = new Map<string, number>();

export type Verdict = { accept: boolean; why: string; replenish: boolean };

/**
 * Whether an offer is fair to us. Value: every TG or commodity we get counts 1 (commodities become TG on arrival),
 * every one we send counts 1; when we send commodities we accept being 1 behind (the N-1 wash). Anything else we
 * would give (PNs such as Support for the Throne, action cards, relics, fragments, debt) is refused.
 */
export function judge(items: Item[], other: string, opts: { holderAsks: boolean; holderOffers: boolean }): Verdict {
  let gain = 0;
  let cost = 0;
  let commOut = 0;
  let note = "";
  for (const i of items) {
    const toUs = i.from === other;
    if (i.kind === "note") {
      note += ` ${i.label}`;
      continue;
    }
    if (/debt/i.test(i.kind)) return { accept: false, why: "debt is not part of a wash", replenish: false };
    if (!toUs) {
      if (i.kind === "tg") cost += i.amount;
      else if (i.kind === "commodities") {
        cost += i.amount;
        commOut += i.amount;
      } else return { accept: false, why: `we never give away ${i.label}`, replenish: false };
      continue;
    }
    gain += i.kind === "tg" || i.kind === "commodities" ? i.amount : Math.max(1, i.amount);
  }
  const replenish = REPLENISH_NOTE.test(note);
  const value = gain - cost;
  if (replenish && opts.holderAsks && value >= 0) return { accept: true, why: "they ask us (the Trade holder) to replenish them; we get the N-1 wash", replenish };
  if (replenish && opts.holderOffers && value >= -1) return { accept: true, why: "the Trade holder replenishes us for an N-1 wash", replenish };
  if (gain === 0) return { accept: false, why: "nothing in it for us", replenish };
  if (value >= 0) return { accept: true, why: `fair (we get ${gain}, give ${cost})`, replenish };
  if (commOut > 0 && value >= -1) return { accept: true, why: `N-1 wash (our ${commOut} commodities for ${gain})`, replenish };
  return { accept: false, why: `not fair (we get ${gain}, give ${cost})`, replenish };
}

/** The wash we would propose: both directions plus a one-line description, or null when there is no deal. */
export function washDeal(me: Party, cp: Party): { give: Side; receive: Side; text: string } | null {
  const mine = me.canSendCommodities ? me.commodities : 0;
  const theirs = cp.canSendCommodities ? cp.commodities : 0;
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

type Promise_ = { faction: string; name: string; at: number };

export class TradeDesk {
  /** Offer prompts (message id) answered. */
  private handled = new Set<string>();
  /** Offer prompts the trade API did not list (yet): given up on after a few looks. */
  private misses = new Map<string, number>();
  /** `${game}:${faction}` → round we proposed a wash in. */
  private proposed = new Map<string, number>();
  private lastPropose = new Map<string, number>();
  /** Holder: players we must force-replenish (they accepted our offer or asked us), per game. */
  private promised = new Map<string, Map<string, Promise_>>();
  /** Holder: replenish offers sent and not answered yet, per game. */
  private awaiting = new Map<string, Map<string, Promise_>>();
  /** Holder: `${game}:${force prompt id}:${faction}` offered already. */
  private offeredReplenish = new Set<string>();
  /** Holder: washes to propose after a forced replenish, per game: faction → not before. */
  private washDue = new Map<string, Map<string, number>>();
  /** Non-holder: the Trade holder (faction) we owe a wash to, per game. */
  private owe = new Map<string, { faction: string; at: number; ready?: number }>();

  constructor(
    private seat: Seat,
    private botApi: string,
    private token: () => string | undefined,
  ) {}

  /** Prompts the rule table must leave alone: offers to and from us (never Rescind on its own), our force-replenish prompt. */
  owns(_game: string, p: Prompt): boolean {
    if (p.controls.some((c) => OFFER_ID.test(baseId(c.custom_id)))) return true;
    return p.controls.some((c) => FORCE_ID.test(baseId(c.custom_id))) && this.mentionsMe(p);
  }

  /** One trading step for a game. Returns true when it pressed something or sent an offer. */
  async tick(game: string): Promise<boolean> {
    if (await this.answerOffers(game)) return true;
    if (await this.holderDuties(game)) return true;
    return this.propose(game);
  }

  // ---- offers to us ----

  private async answerOffers(game: string): Promise<boolean> {
    const open = this.seat.prompts(game).filter((p) => !this.handled.has(p.m.id) && p.controls.some((c) => /^acceptOffer_/.test(baseId(c.custom_id))));
    if (!open.length) return false;
    let pending: Pending | null = null;
    // The bot reads its thread history with a short cache: a brand-new offer can take a moment to show up.
    for (let attempt = 0; attempt < 3 && !pending?.incoming.some((o) => open.some((p) => p.m.id === o.accept?.messageId)); attempt++) {
      if (attempt) await sleep(1200);
      pending = (await this.call(game, "GET", "pending")) as Pending | null;
    }
    if (!pending) return false;
    for (const p of open) {
      if (pending.incoming.some((o) => o.accept?.messageId === p.m.id)) continue;
      const n = (this.misses.get(p.m.id) ?? 0) + 1;
      this.misses.set(p.m.id, n);
      if (n >= 3) this.handled.add(p.m.id);
    }
    const board = await this.seat.board(game);
    const holder = board?.players.find((p) => p.scs.includes(5));
    const me = board ? playerOf(board, this.seat.userId) : undefined;
    for (const p of open) {
      const offer = pending.incoming.find((o) => o.accept?.messageId === p.m.id);
      if (!offer) continue;
      this.handled.add(p.m.id);
      if (!offer.current) continue;
      const iHold = !!me && holder?.userId === me.userId;
      const theyHold = holder?.faction === offer.otherFaction;
      const verdict = judge(offer.items, offer.otherFaction, {
        holderAsks: iHold && this.canStillForce(game, offer.otherFaction, board),
        holderOffers: theyHold && !!me && me.commodities < commTotal(me.raw),
      });
      const button = verdict.accept ? findControl(p, /^acceptOffer_/) : findControl(p, /^rejectOffer_/);
      if (!button) continue;
      const err = await this.seat.press(p, button, `trade: ${verdict.accept ? "accept" : "reject"} offer from ${offer.otherUserName} (${verdict.why})`);
      if (err || !verdict.accept) return true;
      if (verdict.replenish && iHold) this.map(this.promised, game).set(offer.otherFaction, { faction: offer.otherFaction, name: offer.otherUserName, at: Date.now() });
      else if (verdict.replenish && theyHold) this.owe.set(game, { faction: offer.otherFaction, at: Date.now() });
      else if (this.owe.get(game)?.faction === offer.otherFaction) this.owe.delete(game);
      return true;
    }
    return false;
  }

  /** We hold Trade and either its force-replenish prompt is up or the card is not played yet (we can still honour it). */
  private canStillForce(game: string, faction: string, board: Awaited<ReturnType<Seat["board"]>>): boolean {
    const force = this.forcePrompt(game);
    if (force) return force.controls.some((c) => baseId(c.custom_id) === `forceARefresh_${faction}`);
    const me = board ? playerOf(board, this.seat.userId) : undefined;
    return !!me && me.scs.includes(5) && !me.exhaustedSCs.includes(5);
  }

  // ---- holding the Trade card ----

  private forcePrompt(game: string): Prompt | undefined {
    return [...this.seat.prompts(game)].reverse().find((p) => p.controls.some((c) => FORCE_ID.test(baseId(c.custom_id))) && this.mentionsMe(p));
  }

  private async holderDuties(game: string): Promise<boolean> {
    const force = this.forcePrompt(game);
    if (await this.proposeDueWashes(game)) return true;
    if (!force) return false;
    if (Date.now() - Date.parse(force.m.timestamp) > DEAL_MS) return false;
    const factions = force.controls.map((c) => /^forceARefresh_(.+)$/.exec(baseId(c.custom_id))?.[1]).filter((f): f is string => !!f);
    this.readAnswers(game);
    // Honour accepted deals first.
    const promised = this.map(this.promised, game);
    for (const [faction, deal] of promised) {
      promised.delete(faction);
      if (Date.now() - deal.at > DEAL_MS || !factions.includes(faction)) continue;
      const control = force.controls.find((c) => baseId(c.custom_id) === `forceARefresh_${faction}`)!;
      const err = await this.seat.press(force, control, `trade: replenish ${deal.name} for free with Trade, as agreed`);
      if (!err) this.map(this.washDue, game).set(faction, Date.now() + 2500);
      return true;
    }
    // Offer the deal to everyone we may force-replenish who has room for commodities.
    const fresh = factions.filter((f) => !this.offeredReplenish.has(`${game}:${force.m.id}:${f}`) && !this.map(this.awaiting, game).has(f));
    if (!fresh.length) return false;
    if (Date.now() - (this.lastPropose.get(game) ?? 0) < 4000) return false;
    const opts = (await this.call(game, "GET", "options")) as Options | null;
    if (!opts || opts.blockedReason || !opts.me || !opts.counterparties) return false;
    for (const faction of fresh) {
      this.offeredReplenish.add(`${game}:${force.m.id}:${faction}`);
      const cp = opts.counterparties.find((c) => c.faction === faction);
      if (!cp || !cp.canTrade || cp.commodities >= cp.commoditiesTotal || !cp.canSendCommodities) continue;
      const n = Math.min(cp.commoditiesTotal, opts.me.tg + 1);
      const note = `Trade card deal: accept and I replenish your commodities for free now (no strategy token). Then wash them with me: your ${n} commodities for ${n - 1} TG.`;
      const ok = await this.send(game, cp, { give: {}, receive: {}, note }, `free replenish for an N-1 wash (${n} for ${n - 1})`);
      if (ok) this.map(this.awaiting, game).set(faction, { faction, name: cp.userName, at: Date.now() });
      return ok;
    }
    return false;
  }

  /** Our replenish offers: accepted ones become promises, rejected ones are dropped (from our cards-info thread). */
  private readAnswers(game: string) {
    const awaiting = this.map(this.awaiting, game);
    if (!awaiting.size) return;
    const msgs = this.seat.messages(game).filter((p) => p.ch.type === 12);
    for (const [faction, deal] of awaiting) {
      for (const p of msgs) {
        if (Date.parse(p.m.timestamp) < deal.at - 1000) continue;
        const text = String(p.m.content ?? "");
        if (/has been accepted/.test(text) && text.includes(`>${deal.name} gives:`) && REPLENISH_NOTE.test(text)) {
          awaiting.delete(faction);
          this.map(this.promised, game).set(faction, { ...deal, at: Date.now() });
          break;
        }
        if (/your offer to .* has been rejected/.test(text) && text.includes(`>${deal.name} `)) {
          awaiting.delete(faction);
          this.seat.log(`trade: ${deal.name} declined the free replenish deal`);
          break;
        }
      }
      if (awaiting.has(faction) && Date.now() - deal.at > DEAL_MS) awaiting.delete(faction);
    }
  }

  private async proposeDueWashes(game: string): Promise<boolean> {
    const due = this.map(this.washDue, game);
    const ready = [...due].find(([, at]) => Date.now() >= at);
    if (!ready) return false;
    const [faction] = ready;
    due.delete(faction);
    const opts = (await this.call(game, "GET", "options")) as Options | null;
    const cp = opts?.counterparties?.find((c) => c.faction === faction);
    if (!opts || !opts.me || !cp || !cp.canTrade || !cp.canSendCommodities || cp.commodities < 2 || opts.me.tg < 1) return false;
    const n = Math.min(cp.commodities, opts.me.tg + 1);
    this.proposed.set(`${game}:${faction}`, opts.round);
    return this.send(game, cp, { give: { tg: n - 1 }, receive: { commodities: n }, note: `The wash for the free replenish: your ${n} commodities for ${n - 1} TG.` }, `the wash for the free replenish (${n} for ${n - 1})`);
  }

  // ---- proposing washes ----

  private async propose(game: string): Promise<boolean> {
    if (Date.now() - (this.lastPropose.get(game) ?? 0) < PROPOSE_GAP_MS) return false;
    this.lastPropose.set(game, Date.now() - PROPOSE_GAP_MS + 8000 + Math.random() * 6000);
    const board = await this.seat.board(game);
    if (!board || !/^(action|strategy|status|agenda)/.test(board.phase)) return false;
    // Neighbours only in the action phase; outside it anyone may trade.
    const anyone = !/^action/.test(board.phase);
    const opts = (await this.call(game, "GET", "options")) as Options | null;
    if (!opts || opts.blockedReason || !opts.me) return false;
    const me = opts.me;
    if (me.commodities === 0 && me.tg === 0) return false;
    const pending = this.seat.prompts(game).filter((p) => p.controls.some((c) => /^acceptOffer_/.test(baseId(c.custom_id))));
    const offering = new Set(pending.map((p) => /^acceptOffer_([^_]+)/.exec(baseId(p.controls.find((c) => /^acceptOffer_/.test(baseId(c.custom_id)))!.custom_id))?.[1]));
    // A wash we owe the Trade holder who replenished us goes first.
    const owed = this.owe.get(game);
    if (owed && Date.now() - owed.at > DEAL_MS) this.owe.delete(game);
    else if (owed && me.commodities > 0) {
      owed.ready ??= Date.now();
      const cp = opts.counterparties.find((c) => c.faction === owed.faction);
      if (cp && Date.now() - owed.ready > OWE_WAIT_MS && !offering.has(cp.color)) {
        this.owe.delete(game);
        const n = Math.min(me.commodities, cp.tg + 1);
        if (cp.canTrade && n >= 2) {
          this.proposed.set(`${game}:${cp.faction}`, opts.round);
          return this.send(game, cp, { give: { commodities: n }, receive: { tg: n - 1 }, note: `The wash for your free replenish: my ${n} commodities for ${n - 1} TG.` }, `the wash we owe the Trade holder (${n} for ${n - 1})`);
        }
      }
      return false;
    }
    const outgoing = new Set<string>();
    const candidates = opts.counterparties
      .filter((c) => c.canTrade && (c.neighbor || anyone) && this.proposed.get(`${game}:${c.faction}`) !== opts.round && !offering.has(c.color))
      .filter((c) => Date.now() - (lastToPartner.get(c.userId) ?? 0) >= PARTNER_GAP_MS && !this.offeredLately(game, c.userName))
      .map((c) => ({ c, deal: washDeal(me, c) }))
      .filter((x): x is { c: Counterparty; deal: NonNullable<ReturnType<typeof washDeal>> } => !!x.deal);
    if (!candidates.length) return false;
    // Don't stack offers: skip partners we already have an offer out to.
    const out = (await this.call(game, "GET", "pending")) as Pending | null;
    for (const o of out?.outgoing ?? []) outgoing.add(o.otherFaction);
    const pick = candidates.find((x) => !outgoing.has(x.c.faction));
    if (!pick) return false;
    this.proposed.set(`${game}:${pick.c.faction}`, opts.round);
    return this.send(game, pick.c, { give: pick.deal.give, receive: pick.deal.receive, note: `Commodity wash: ${pick.deal.text.replace(/\bour\b/g, "my").replace(/\btheir\b/g, "your")}. We both gain.` }, `N-1 wash: ${pick.deal.text}`);
  }

  // ---- plumbing ----

  private async send(game: string, cp: Party, body: { give: Side; receive: Side; note?: string }, why: string): Promise<boolean> {
    this.lastPropose.set(game, Date.now());
    lastToPartner.set(cp.userId, Date.now());
    const res = await this.call(game, "POST", "propose", { to: cp.faction, give: body.give, receive: body.receive, note: body.note?.replace(/[,_]/g, "") });
    this.seat.log(`trade: offered ${cp.userName} ${why}${res && (res as Json).ok ? "" : ` -> failed: ${(res as Json)?.error ?? "no answer"}`}`);
    return !!res && !!(res as Json).ok;
  }

  private async call(game: string, method: "GET" | "POST", path: string, body?: Json): Promise<Json | null> {
    const token = this.token();
    if (!token) return null;
    try {
      const res = await fetch(`${this.botApi}/api/game/${encodeURIComponent(game)}/trade/${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10000),
      });
      const text = await res.text();
      const json = text ? (JSON.parse(text) as Json) : {};
      if (res.ok) return json;
      return method === "POST" ? { ok: false, error: json.error ?? `HTTP ${res.status}` } : null;
    } catch (e) {
      return method === "POST" ? { ok: false, error: (e as Error).message } : null;
    }
  }

  /**
   * We sent this partner an offer recently, by our cards-info thread ("you sent a transaction offer to …"): keeps
   * "once per round" across shim restarts, which forget `proposed`.
   */
  private offeredLately(game: string, name: string) {
    return this.seat
      .messages(game)
      .some((p) => p.ch.type === 12 && Date.now() - Date.parse(p.m.timestamp) < RECENT_OFFER_MS && /you sent a transaction offer to/.test(String(p.m.content ?? "")) && String(p.m.content).includes(`>${name} `));
  }

  private mentionsMe(p: Prompt) {
    return String(p.m.content ?? "").includes(`<@${this.seat.userId}>`);
  }

  private map<V>(m: Map<string, Map<string, V>>, game: string): Map<string, V> {
    let v = m.get(game);
    if (!v) m.set(game, (v = new Map()));
    return v;
  }
}

function findControl(p: Prompt, re: RegExp): Control | undefined {
  return p.controls.find((c) => re.test(baseId(c.custom_id)));
}

function commTotal(raw: Json): number {
  return Number(raw?.commoditiesTotal ?? raw?.commodityTotal ?? 0) || 99;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
