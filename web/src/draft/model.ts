import type {
  DraftChoice,
  DraftPlayer,
  DraftState,
  PickCategory,
} from "./types";

export type Focus = {
  kind: "slice" | "faction" | "order" | "seat";
  key: string;
} | null;

export type PendingPick = {
  category: PickCategory;
  key: string;
  customId: string;
};

export type PickAvailability =
  | { ok: true }
  | { ok: false; reason: string; taken?: DraftPlayer };

export const CATEGORY_LABEL: Record<string, string> = {
  slice: "slice",
  faction: "faction",
  speakerOrder: "speaker order",
  seat: "seat",
};

export function playerById(
  draft: DraftState,
  userId: string | null | undefined,
) {
  if (!userId) return undefined;
  return draft.players.find((p) => p.userId === userId);
}

export function hasPicked(
  player: DraftPlayer | undefined,
  category: PickCategory,
) {
  if (!player) return false;
  return player.picks.some((p) => p.type === category);
}

/** Whether `myUserId` may press this choice right now, and if not, why. */
export function availability(
  draft: DraftState,
  myUserId: string,
  category: PickCategory,
  choice: DraftChoice,
  pending: PendingPick | null,
): PickAvailability {
  const taken = playerById(draft, choice.pickedBy);
  if (choice.pickedBy)
    return {
      ok: false,
      reason: `Taken by ${taken?.name ?? "another player"}`,
      taken,
    };
  if (draft.status !== "drafting")
    return { ok: false, reason: "The draft is over" };
  const me = playerById(draft, myUserId);
  if (!me) return { ok: false, reason: "You are not in this draft" };
  if (draft.currentPlayer !== myUserId) {
    const current = playerById(draft, draft.currentPlayer);
    return {
      ok: false,
      reason: current ? `${current.name} is picking` : "Not your turn",
    };
  }
  if (pending) return { ok: false, reason: "Sending your pick…" };
  if (hasPicked(me, category))
    return {
      ok: false,
      reason: `You already have a ${CATEGORY_LABEL[category] ?? category}`,
    };
  if (!choice.customId || !choice.channelId)
    return { ok: false, reason: "No button for this pick" };
  if (!choice.messageId)
    return {
      ok: false,
      reason:
        "Draft buttons not found — press “Show draft again” in the game channel",
    };
  return { ok: true };
}

/** Applies a not-yet-confirmed pick of mine so the UI responds instantly; the next poll replaces it. */
export function withPending(
  draft: DraftState,
  myUserId: string,
  pending: PendingPick | null,
): DraftState {
  if (!pending) return draft;
  const mark = (c: DraftChoice) =>
    c.customId === pending.customId ? { ...c, pickedBy: myUserId } : c;
  const nextIndex = draft.pickIndex + 1;
  const nextCurrent = draft.pickOrder[nextIndex] ?? null;
  return {
    ...draft,
    slices: draft.slices.map((s) => ({ ...s, choice: mark(s.choice) })),
    factions: draft.factions.map((f) => ({ ...f, choice: mark(f.choice) })),
    speakerOrder: draft.speakerOrder.map((o) => ({
      ...o,
      choice: mark(o.choice),
    })),
    seats: draft.seats.map((o) => ({ ...o, choice: mark(o.choice) })),
    pickIndex: nextIndex,
    currentPlayer: nextCurrent,
    nextPlayer: draft.pickOrder[nextIndex + 1] ?? null,
    players: draft.players.map((p) => {
      const isMe = p.userId === myUserId;
      const picks = isMe
        ? [
            ...p.picks,
            { type: pending.category, key: pending.key, label: pending.key },
          ]
        : p.picks;
      return {
        ...p,
        picks,
        current: p.userId === nextCurrent,
        next: p.userId === draft.pickOrder[nextIndex + 1],
        slice: isMe && pending.category === "slice" ? pending.key : p.slice,
        faction:
          isMe && pending.category === "faction" ? pending.key : p.faction,
        speakerOrder:
          isMe && pending.category === "speakerOrder"
            ? Number(pending.key) || p.speakerOrder
            : p.speakerOrder,
      };
    }),
  };
}

/** The template seat a player's slice lands in: the seat pick if the draft has seats, else speaker order. */
export function seatOf(draft: DraftState, player: DraftPlayer | undefined) {
  if (!player) return null;
  if (draft.seats.length > 0) return player.seat;
  return player.speakerOrder;
}

export function techColor(skip: string) {
  switch (skip) {
    case "propulsion":
      return "blue";
    case "biotic":
      return "green";
    case "cybernetic":
      return "yellow";
    case "warfare":
      return "red";
    default:
      return "gray";
  }
}
