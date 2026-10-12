import type {
  EngineChoice,
  PendingOffer,
  PendingResponse,
  ProposeRequest,
  ProposeResponse,
  TradeOptions,
} from "./types";
import type { Decision, GameState, OpenOffer, TradeItem } from "../../../shim/src/engine/types";

/*
 * Trade data from the engine API (docs/ENGINE.md, G11): `GameState.trade` (what I can trade, with whom, open offers),
 * the `trade.offer` / `trade.offer_sent` decisions (answered by option), and the typed `trade.propose` action.
 * Seat routes (`Authorization: Bearer <seat token>`), proxied by the shim under `/bot`.
 */

export class TradeApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function call<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  if (!res.ok) throw new TradeApiError(errorMessage(text, res.status), res.status);
  return JSON.parse(text) as T;
}

function errorMessage(body: string, status: number) {
  try {
    const parsed = JSON.parse(body) as { error?: string; message?: string };
    if (parsed.error && parsed.error !== "Forbidden") return parsed.error;
    if (parsed.message) return parsed.message;
  } catch {
    /* not JSON */
  }
  if (status === 401 || status === 403) return "You're not a player in this game.";
  if (status === 502 || status === 503) return "The bot is offline.";
  return body.slice(0, 200) || `HTTP ${status}`;
}

const engine = (botBase: string, game: string) => `${botBase}/api/game/${encodeURIComponent(game)}/engine`;

export type EngineTrade = { options: TradeOptions; pending: PendingResponse };

/** My trade view and open offers, from one engine state + decisions read. */
export async function fetchEngineTrade(botBase: string, game: string, token: string): Promise<EngineTrade> {
  const [state, decisions] = await Promise.all([
    call<GameState>(`${engine(botBase, game)}/state`, token),
    call<{ decisions: Decision[] }>(`${engine(botBase, game)}/decisions`, token),
  ]);
  const trade = state.trade;
  if (!trade) throw new TradeApiError("Trading opens once you have a seat in this game.", 404);
  const options: TradeOptions = {
    game: state.game,
    phase: trade.phase,
    round: state.round,
    newTransactionModel: trade.newTransactionModel,
    blockedReason: trade.blockedReason,
    version: state.stateVersion,
    me: trade.me,
    // Strict rule (LRR 94): neighbours only, except in the agenda phase or with an ability that lifts it.
    counterparties: trade.partners.map((c) =>
      !c.canTrade || trade.mayTransactWith.includes(c.faction)
        ? c
        : { ...c, canTrade: false, reason: "Not neighbours (only the agenda phase lifts that)" },
    ),
    mayTransactWith: trade.mayTransactWith,
  };
  return { options, pending: pendingFrom(state, decisions.decisions) };
}

function choice(d: Decision, pick: (v: Record<string, unknown> | null, handler: string) => boolean): EngineChoice | null {
  const o = d.options.find((x) => !x.disabled && pick(x.value as Record<string, unknown> | null, x.handler));
  return o ? { decisionId: d.id, optionId: o.id, expectedSeq: d.seq, messageId: d.source.messageId } : null;
}

/** Incoming = my trade.offer decisions; outgoing = GameState.trade.outgoing, with Rescind from my trade.offer_sent. */
function pendingFrom(state: GameState, decisions: Decision[]): PendingResponse {
  const trade = state.trade!;
  const player = (f: string) => state.players.find((p) => p.faction === f);
  const at = (d?: Decision) => new Date(d?.createdAt ?? Date.now()).toISOString();
  const live = new Set(trade.incoming.map((o) => o.decisionId));
  const incoming: PendingOffer[] = [];
  for (const d of decisions) {
    if (d.kind !== "trade.offer") continue;
    const v = d.options.find((o) => o.value)?.value;
    if (!v) continue;
    const from = player(v.from);
    const accept = d.options.find((o) => o.value?.action === "accept")?.value;
    incoming.push({
      direction: "incoming",
      decisionId: d.id,
      otherFaction: v.from,
      otherUserId: v.fromUserId,
      otherUserName: from?.userName ?? v.from,
      otherColor: from?.color ?? "",
      offerNumber: accept?.offerNumber ?? 0,
      current: live.has(d.id),
      text: d.prompt,
      items: (trade.incoming.find((o) => o.decisionId === d.id)?.items ?? v.items),
      accept: choice(d, (x) => x?.action === "accept"),
      reject: choice(d, (x) => x?.action === "reject"),
      counter: choice(d, (x, h) => !x && h.startsWith("resetOffer_")),
      createdAt: at(d),
    });
  }
  const sent = decisions.filter((d) => d.kind === "trade.offer_sent");
  const outgoing: PendingOffer[] = trade.outgoing.map((o: OpenOffer) => {
    const to = player(o.to);
    const rescindOf = [...sent].reverse().find((d) => d.options.some((x) => x.value?.to === o.to));
    return {
      direction: "outgoing",
      decisionId: o.decisionId,
      otherFaction: o.to,
      otherUserId: to?.userId ?? "",
      otherUserName: to?.userName ?? o.to,
      otherColor: to?.color ?? "",
      offerNumber: o.offerNumber,
      current: true,
      text: "",
      items: o.items,
      rescind: rescindOf ? choice(rescindOf, (x) => x?.action === "rescind") : null,
      createdAt: at(rescindOf),
    };
  });
  return { incoming, outgoing };
}

/** My trade view and open offers (the engine's; while it is unavailable the panel shows the error and retries). */
export const fetchTrade = fetchEngineTrade;

export const fetchTradeOptions = async (botBase: string, game: string, token: string) =>
  (await fetchTrade(botBase, game, token)).options;

export const fetchPendingTrades = async (botBase: string, game: string, token: string) =>
  (await fetchTrade(botBase, game, token)).pending;

/** Answers an offer decision (Accept / Reject / Rescind). */
export const answerTrade = (botBase: string, game: string, token: string, c: EngineChoice) =>
  call<{ ok: boolean; status: string; error: string | null }>(
    `${engine(botBase, game)}/decisions/${encodeURIComponent(c.decisionId)}/answer`,
    token,
    { method: "POST", body: JSON.stringify({ optionId: c.optionId, expectedSeq: c.expectedSeq, requestId: `${c.decisionId}:${c.optionId}` }) },
  );

/** The typed `trade.propose` action; replaces an open offer to the same player. */
export async function proposeTrade(botBase: string, game: string, token: string, body: ProposeRequest): Promise<ProposeResponse> {
  const res = await call<{ ok: boolean; error: string | null; offerNumber: number | null; to: string | null; items: TradeItem[] }>(
    `${engine(botBase, game)}/actions/trade.propose`,
    token,
    { method: "POST", body: JSON.stringify(body) },
  );
  if (!res.ok) throw new TradeApiError(res.error ?? "The offer was refused.", 422);
  return { ok: true, offerNumber: res.offerNumber ?? 0, to: res.to ?? body.to, items: res.items, warnings: [] };
}
