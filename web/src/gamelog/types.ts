/** Game phases as the log groups them. `setup` covers everything before round 1 (draft, faction setup). */
export type Phase = "setup" | "strategy" | "action" | "status" | "agenda";

export type EventKind =
  | "phase"
  | "setup"
  | "speaker"
  | "sc_pick"
  | "sc_play"
  | "sc_follow"
  | "turn"
  | "pass"
  | "activate"
  | "move"
  | "land"
  | "produce"
  | "combat"
  | "planet"
  | "explore"
  | "tech"
  | "objective"
  | "agenda"
  | "action_card"
  | "transaction"
  | "leader"
  | "relic"
  | "resources"
  | "ability"
  | "edit"
  | "other";

/** A custom emoji the bot used (served at `/emojis/{id}`). */
export type EmojiRef = { id: string; name: string };

/** A player as the bot names them: faction emoji, Discord user, colour. Any part may be missing. */
export type Actor = {
  /** Faction key, lower-cased emoji name (`mentak`, `sol`, `keleres`). */
  faction?: string;
  factionEmoji?: EmojiRef;
  userId?: string;
  name?: string;
  /** Colour display name as the bot prints it (`Gold`, `Vapourwave`). */
  color?: string;
  colorEmoji?: EmojiRef;
};

/** Rich one-line text: plain runs, bold key nouns, inline emoji and nested player names. */
export type Seg =
  | { t: "text"; v: string }
  | { t: "b"; v: string }
  | { t: "emoji"; id: string; name: string }
  | { t: "actor"; actor: Actor };

/** 1 = minor (hidden unless "show all"), 2 = normal, 3 = headline (VP, agenda outcome, combat, round start). */
export type Importance = 1 | 2 | 3;

export type GameEvent = {
  /** Stable id: source message id, plus `#n` when one message yields several events. */
  id: string;
  messageId: string;
  channelId: string;
  /** ISO timestamp of the source message. */
  time: string;
  round: number;
  phase: Phase;
  kind: EventKind;
  importance: Importance;
  actor?: Actor;
  /** Second party: transaction partner, combat opponent. */
  target?: Actor;
  /** The predicate, read after the actor's name ("researched **Gravity Drive**"). */
  summary: Seg[];
  /** Extra lines shown when the row is expanded. */
  details?: Seg[][];
  /** Map position of the system involved (`201`), for map focus. */
  systemPosition?: string;
  /** Victory points gained (objective scored). */
  vp?: number;
  /** The event this one follows from and is shown under (a strategy card play: its primary, follows, declines). */
  parentId?: string;
  /** Strategy card plays: the bot's art file for the card (`base_game_5`, `te_6`), naming the exact variant. */
  scImage?: string;
  /** Plain text of the whole event (actor + summary + details), for search. */
  text: string;
};

/** How the bot's messages were classified, for coverage stats. */
export type Classification =
  | { type: "event"; kind: EventKind }
  | { type: "noise"; rule: string }
  | { type: "other" };
