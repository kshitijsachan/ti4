import type {
  FragmentCounts,
  FragmentTrait,
  ProposeRequest,
  TradeCounterparty,
  TradeSelf,
  TradeSide,
} from "./types";

export const FRAGMENT_TRAITS: FragmentTrait[] = [
  "cultural",
  "hazardous",
  "industrial",
  "frontier",
];

export const ANY_PN = "any";

/** One side of the offer being built. */
export type SideDraft = {
  tg: number;
  commodities: number;
  promissoryNote: string | null;
  actionCards: string[];
  actionCardCount: number;
  fragments: FragmentCounts;
  relics: string[];
  sendDebt: number;
  clearDebt: number;
};

export type TradeDraft = { give: SideDraft; receive: SideDraft; note: string };

const zeroFragments = (): FragmentCounts => ({
  cultural: 0,
  hazardous: 0,
  industrial: 0,
  frontier: 0,
});

export const emptySide = (): SideDraft => ({
  tg: 0,
  commodities: 0,
  promissoryNote: null,
  actionCards: [],
  actionCardCount: 0,
  fragments: zeroFragments(),
  relics: [],
  sendDebt: 0,
  clearDebt: 0,
});

export const emptyDraft = (): TradeDraft => ({
  give: emptySide(),
  receive: emptySide(),
  note: "",
});

/** The most the holder can put into each counter, given the bot's rules. */
export type SideLimits = {
  tg: number;
  commodities: number;
  actionCardCount: number;
  fragments: FragmentCounts;
  clearDebt: number;
  sendDebt: number;
};

export const MAX_DEBT = 9;
export const MAX_GENERIC_ACS = 7;

export function giveLimits(me: TradeSelf, cp: TradeCounterparty): SideLimits {
  return {
    tg: me.tg,
    commodities: me.canSendCommodities ? me.commodities : 0,
    actionCardCount: 0,
    fragments: capFragments(me.fragments),
    clearDebt: cp.debtIHold,
    sendDebt: MAX_DEBT,
  };
}

export function receiveLimits(cp: TradeCounterparty): SideLimits {
  return {
    tg: cp.tg,
    commodities: cp.canSendCommodities ? cp.commodities : 0,
    actionCardCount: cp.canTradeActionCards ? Math.min(MAX_GENERIC_ACS, cp.acCount) : 0,
    fragments: capFragments(cp.fragments),
    clearDebt: cp.debtTheyHold,
    sendDebt: MAX_DEBT,
  };
}

function capFragments(f: FragmentCounts): FragmentCounts {
  const out = zeroFragments();
  for (const t of FRAGMENT_TRAITS) out[t] = Math.min(9, f[t] ?? 0);
  return out;
}

/** Clamps a side to new limits (the counterparty changed, or a poll moved the numbers). */
export function clampSide(side: SideDraft, limits: SideLimits): SideDraft {
  const fragments = zeroFragments();
  for (const t of FRAGMENT_TRAITS) fragments[t] = Math.min(side.fragments[t], limits.fragments[t]);
  return {
    ...side,
    tg: Math.min(side.tg, limits.tg),
    commodities: Math.min(side.commodities, limits.commodities),
    actionCardCount: Math.min(side.actionCardCount, limits.actionCardCount),
    fragments,
    clearDebt: Math.min(side.clearDebt, limits.clearDebt),
  };
}

export function sideCount(s: SideDraft) {
  const frags = FRAGMENT_TRAITS.reduce((n, t) => n + s.fragments[t], 0);
  return (
    s.tg +
    s.commodities +
    (s.promissoryNote ? 1 : 0) +
    s.actionCards.length +
    s.actionCardCount +
    frags +
    s.relics.length +
    s.sendDebt +
    s.clearDebt
  );
}

const nonZero = (n: number) => (n > 0 ? n : undefined);
const nonEmpty = <T>(a: T[]) => (a.length ? a : undefined);

function toSide(s: SideDraft): TradeSide {
  const fragments: Partial<FragmentCounts> = {};
  for (const t of FRAGMENT_TRAITS) if (s.fragments[t] > 0) fragments[t] = s.fragments[t];
  return {
    tg: nonZero(s.tg),
    commodities: nonZero(s.commodities),
    promissoryNotes: s.promissoryNote ? [s.promissoryNote] : undefined,
    actionCards: nonEmpty(s.actionCards),
    actionCardCount: nonZero(s.actionCardCount),
    fragments: Object.keys(fragments).length ? fragments : undefined,
    relics: nonEmpty(s.relics),
    sendDebt: nonZero(s.sendDebt),
    clearDebt: nonZero(s.clearDebt),
  };
}

export function toRequest(to: string, d: TradeDraft): ProposeRequest {
  const note = d.note.trim();
  return {
    to,
    give: toSide(d.give),
    receive: toSide(d.receive),
    note: note || undefined,
  };
}
