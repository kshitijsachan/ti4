import type { Decision, GameState } from "./contract";

/**
 * Strategy-card follow windows (rules: after a card is played every other player follows or declines it before the
 * next turn begins; the engine's ScFollowGate refuses the holder's end turn until they have). Pure helpers for the
 * queue order, the header and the turn menu.
 */

export type OwedFollow = { strategyCard: number; name: string; holderFaction: string | null };
export type FollowHold = {
  strategyCard: number;
  name: string;
  holder: string | null;
  /** Players still to follow or decline (seat order). */
  pending: { userId: string; userName: string; faction: string; self: boolean }[];
};

const actionPhase = (state: GameState) => /^action/i.test(state.phase ?? "");

/** Played cards (not mine) that I have not followed or declined yet. */
export function followsOwed(state: GameState | null | undefined, myId?: string | null): OwedFollow[] {
  if (!state || !actionPhase(state)) return [];
  const me = myId ? state.players.find((p) => p.userId === myId) : state.players.find((p) => p.self);
  if (!me) return [];
  return state.strategyCards
    .filter((c) => c.played && c.holder !== me.userId && (c.reactions ?? []).some((r) => r.faction === me.faction && r.status === "pending"))
    .map((c) => ({ strategyCard: c.number, name: c.name, holderFaction: c.holderFaction }));
}

/** Cards whose follow window holds the active player's turn right now, with who is still to answer. */
export function followHolds(state: GameState | null | undefined): FollowHold[] {
  if (!state || !actionPhase(state)) return [];
  return state.strategyCards
    .filter((c) => c.played && c.blocksTurn)
    .map((c) => ({
      strategyCard: c.number,
      name: c.name,
      holder: c.holder,
      pending: (c.reactions ?? [])
        .filter((r) => r.status === "pending")
        .map((r) => {
          const p = state.players.find((x) => x.faction === r.faction);
          return { userId: p?.userId ?? "", userName: p?.userName ?? r.faction, faction: r.faction, self: !!p?.self };
        }),
    }))
    .filter((h) => h.pending.length > 0);
}

/** "Alice", "Alice and Bob", "Alice, Bob and Carol". */
export function namesList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** A follow window that waits on me: its strategy_card.resolve decision lists me as eligible and not responded. */
export function owesFollow(d: Decision, myId: string | null | undefined, myFaction: string | null | undefined): boolean {
  if (d.kind !== "strategy_card.resolve" || !d.window || !myId) return false;
  if (myFaction && d.window.subject?.holder === myFaction) return false;
  return d.window.eligible.includes(myId) && !d.window.responded.includes(myId);
}

/** The header's line for a follow window, or null: mine to answer first, else who the table waits on. */
export function followHeader(state: GameState | null | undefined, myId?: string | null): { mine: string | null; others: string | null } {
  const owed = followsOwed(state, myId);
  const mine = owed.length ? `follow ${namesList(owed.map((o) => o.name))}` : null;
  const holds = followHolds(state).map((h) => ({ ...h, pending: h.pending.filter((p) => p.userId !== myId) })).filter((h) => h.pending.length);
  const others = holds.length
    ? holds.map((h) => `Waiting for ${namesList(h.pending.map((p) => p.userName))} to follow ${h.name}`).join("; ")
    : null;
  return { mine, others };
}
