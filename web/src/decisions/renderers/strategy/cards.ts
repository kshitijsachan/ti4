import { baseId, type Choice } from "../../model/controls";

/**
 * What each strategy card does, in plain words, and which of the bot's buttons resolve it. The bot's "Spend A
 * Strategy Token" (`sc_follow_N`) only takes the token: the card's own action button (draw, research, ready …)
 * takes the token too when you have not followed yet, *and* starts the effect. So "Follow" always presses the
 * action button.
 */
export type FollowAction = {
  /** Base custom id (without `FFCC_x_`) of the bot's button. */
  id: RegExp;
  /** Button label in the popup. */
  label: string;
  /** What the player gets, one line. */
  effect: string;
};

export type CardSpec = {
  initiative: number;
  name: string;
  /** The primary in one plain sentence. */
  primary: string;
  /** The secondary in one plain sentence (without the token cost). */
  secondary: string;
  /** Following costs a strategy token (Leadership costs influence instead). */
  token: boolean;
  /** One or more ways to follow, each one press. */
  follow: FollowAction[];
};

export const CARDS: Record<number, CardSpec> = {
  1: {
    initiative: 1,
    name: "Leadership",
    primary: "Gain 3 command tokens, then spend any amount of influence to gain 1 more per 3 influence.",
    secondary: "Spend any amount of influence to gain 1 command token per 3 influence.",
    token: false,
    follow: [{ id: /^leadershipGenerateCCButtons$/, label: "Follow — buy tokens with influence", effect: "Exhaust planets for influence; every 3 buys a command token." }],
  },
  2: {
    initiative: 2,
    name: "Diplomacy",
    primary: "Choose a system other than Mecatol Rex with a planet you control: every other player puts a token there. Ready up to 2 exhausted planets.",
    secondary: "Ready up to 2 exhausted planets.",
    token: true,
    follow: [{ id: /^diploRefresh2$/, label: "Follow — ready 2 planets", effect: "Ready up to 2 of your exhausted planets." }],
  },
  3: {
    initiative: 3,
    name: "Politics",
    primary: "Choose a new speaker (not you), draw 2 action cards, look at the top 2 agendas and put each on the top or bottom.",
    secondary: "Draw 2 action cards.",
    token: true,
    follow: [{ id: /^sc_ac_draw$/, label: "Follow — draw 2 action cards", effect: "Draw 2 action cards." }],
  },
  4: {
    initiative: 4,
    name: "Construction",
    primary: "Place 1 PDS or 1 space dock on a planet you control, then 1 more PDS on a planet you control.",
    secondary: "Place 1 PDS or 1 space dock on a planet you control, and put a command token in its system.",
    token: true,
    follow: [
      { id: /^construction_pds$/, label: "Follow — place a PDS", effect: "Place 1 PDS on one of your planets (a token goes in its system)." },
      { id: /^construction_spacedock$/, label: "Follow — place a space dock", effect: "Place 1 space dock on one of your planets (a token goes in its system)." },
    ],
  },
  5: {
    initiative: 5,
    name: "Trade",
    primary: "Gain 3 trade goods and replenish your commodities. Choose any players to replenish theirs for free.",
    secondary: "Replenish your commodities.",
    token: true,
    follow: [{ id: /^(sc_trade_follow|sc_follow_trade)$/, label: "Follow — replenish commodities", effect: "Your commodities go back up to your faction's maximum." }],
  },
  6: {
    initiative: 6,
    name: "Warfare",
    primary: "Remove one of your command tokens from the board (it returns to your pools), then redistribute your tokens.",
    secondary: "Use the PRODUCTION of one space dock in your home system.",
    token: true,
    follow: [{ id: /^(warfareBuild|warfareTeBuild)$/, label: "Follow — produce at home", effect: "Produce units at a space dock in your home system." }],
  },
  7: {
    initiative: 7,
    name: "Technology",
    primary: "Research 1 technology, then you may spend 6 resources to research 1 more.",
    secondary: "Spend 4 resources to research 1 technology.",
    token: true,
    follow: [{ id: /^acquireATechWithSC(_first)?$/, label: "Follow — research a technology", effect: "Research 1 technology for 4 resources." }],
  },
  8: {
    initiative: 8,
    name: "Imperial",
    primary: "Score 1 public objective you meet. Gain 1 victory point if you control Mecatol Rex; otherwise draw a secret objective.",
    secondary: "Draw 1 secret objective.",
    token: true,
    follow: [{ id: /^sc_draw_so$/, label: "Follow — draw a secret objective", effect: "Draw 1 secret objective." }],
  },
};

/** Thunder's Edge reprints that play differently (keyed by the game's strategy card id, not the initiative). */
const TE: Record<string, Partial<CardSpec>> = {
  te4construction: {
    primary: "Place 1 structure (PDS or space dock) on a planet you control, or use the PRODUCTION of 1 of your space docks. Then place 1 more structure.",
    secondary: "Place 1 structure (PDS or space dock) on a planet you control.",
  },
  te6warfare: {
    primary: "Take a tactical action in any system without placing a command token there (even one that already has yours). Redistribute your tokens before and after.",
    secondary: "Use the PRODUCTION of the units in your home system (no token goes there).",
  },
};

/** The card as this game plays it: the base/PoK spec with Thunder's Edge changes applied. */
export function cardSpec(sc: number, scId?: string): CardSpec | undefined {
  const base = CARDS[sc];
  if (!base) return undefined;
  const te = scId ? TE[scId] : undefined;
  return te ? { ...base, ...te } : base;
}

export const DECLINE = /^sc_no_follow_\d+$/;
export const SPEND_ONLY = /^(sc_follow_\d+|sc_follow_trade)$/;

export function findChoice(choices: Choice[], re: RegExp) {
  return choices.find((c) => re.test(baseId(c.customId)) && !c.disabled);
}
