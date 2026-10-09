import { usePlayConnection } from "@/discord";
import type { PlayConnection } from "@/discord";
import { usePressButton, type PressResult } from "@/play/usePressButton";
import type { HandCard } from "./model";
import { findNewButton, type BotButton } from "./botThread";
import type { HandState } from "./useHand";

const FOLLOW_TIMEOUT_MS = 15_000;

type Step =
  | { type: "press"; button: BotButton }
  | { type: "chain"; opener: BotButton; match: (customId: string) => boolean }
  | { type: "show"; command: "ac" | "so" | "pn"; option: string; number: number };

export type CardActionId = "play" | "score" | "discard" | "show" | "sync";

export type CardAction = {
  id: CardActionId;
  label: string;
  tone: "go" | "neutral" | "danger";
  hint?: string;
  step: Step;
};

export type ActionOutcome = PressResult & {
  /** Newest message id (thread or actions channel) before the action, to pick out the bot's replies. */
  baseline?: string;
};

const exact = (id: string) => (customId: string) => customId === id;

/** The bot buttons behind each thing the player can do with a card. */
export function actionsFor(card: HandCard, hand: HandState): CardAction[] {
  const { index } = hand;
  const n = hand.numbers.get(card.key);
  const out: CardAction[] = [];
  const sync = (): CardAction[] =>
    index.refresh
      ? [{
          id: "sync",
          label: "Sync with bot",
          tone: "neutral",
          hint: "The bot has not listed this card yet; ask it to refresh your hand.",
          step: { type: "press", button: index.refresh },
        }]
      : [];

  if (card.kind === "ac") {
    if (n === undefined) return sync();
    const play = index.acPlay.get(n);
    if (play) out.push({ id: "play", label: "Play", tone: "go", step: { type: "press", button: play } });
    else if (index.refresh)
      out.push({ id: "play", label: "Play", tone: "go",
        step: { type: "chain", opener: index.refresh, match: exact(`ac_play_from_hand_${n}`) } });
    const discard = index.acDiscard.get(n);
    if (discard) out.push({ id: "discard", label: "Discard", tone: "danger", step: { type: "press", button: discard } });
    else if (index.openAcDiscard)
      out.push({ id: "discard", label: "Discard", tone: "danger",
        step: { type: "chain", opener: index.openAcDiscard, match: exact(`ac_discard_from_hand_${n}`) } });
    out.push({ id: "show", label: "Show to…", tone: "neutral",
      step: { type: "show", command: "ac", option: "action_card_id", number: n } });
    return out;
  }

  if (card.kind === "so") {
    if (card.scored) return [];
    if (n === undefined) return sync();
    const score = index.soScore.get(n);
    if (score) out.push({ id: "score", label: "Score", tone: "go", step: { type: "press", button: score } });
    else if (index.openSoScore)
      out.push({ id: "score", label: "Score", tone: "go",
        step: { type: "chain", opener: index.openSoScore, match: exact(`so_score_hand_${n}`) } });
    const discard = index.soDiscard.get(n);
    if (discard) out.push({ id: "discard", label: "Discard", tone: "danger", step: { type: "press", button: discard } });
    else if (index.openSoDiscard)
      out.push({ id: "discard", label: "Discard", tone: "danger",
        step: { type: "chain", opener: index.openSoDiscard,
          match: (id) => id === `discardSecret_${n}` || id === `SODISCARD_${n}` } });
    out.push({ id: "show", label: "Show to…", tone: "neutral",
      step: { type: "show", command: "so", option: "secret_objective_id", number: n } });
    return out;
  }

  if (card.kind === "pn") {
    const play = index.pnPlay.get(card.alias);
    if (play && !card.inPlayArea)
      out.push({ id: "play", label: "Play", tone: "go", step: { type: "press", button: play } });
    if (n !== undefined && !card.inPlayArea)
      out.push({ id: "show", label: "Show to…", tone: "neutral",
        step: { type: "show", command: "pn", option: "promissory_note_id", number: n } });
    return out;
  }
  return out;
}

function newestId(connection: PlayConnection, channelId: string): string | undefined {
  const channel = connection.store.getState().messages[channelId];
  return channel?.ids[channel.ids.length - 1];
}

function waitForButton(
  connection: PlayConnection,
  channelId: string,
  baseline: string | undefined,
  match: (customId: string) => boolean,
): Promise<BotButton | undefined> {
  return new Promise((resolve) => {
    const look = () => findNewButton(connection.store.getState().messages[channelId], baseline, match);
    const found = look();
    if (found) return resolve(found);
    const unsubscribe = connection.store.subscribe(() => {
      const hit = look();
      if (!hit) return;
      settle(hit);
    });
    const timer = window.setTimeout(() => settle(undefined), FOLLOW_TIMEOUT_MS);
    function settle(value: BotButton | undefined) {
      unsubscribe();
      window.clearTimeout(timer);
      resolve(value);
    }
  });
}

function waitForNonce(connection: PlayConnection, nonce: string | null): Promise<PressResult> {
  return new Promise((resolve) => {
    if (!nonce) return resolve({ error: "Not connected to the game server." });
    const check = () => {
      const results = connection.store.getState().results;
      if (!(nonce in results)) return false;
      settle(results[nonce] ? { error: results[nonce] } : {});
      return true;
    };
    const unsubscribe = connection.store.subscribe(() => void check());
    const timer = window.setTimeout(() => settle({}), 20_000);
    function settle(result: PressResult) {
      unsubscribe();
      window.clearTimeout(timer);
      resolve(result);
    }
    check();
  });
}

/** Runs a card action against the bot: a press, an opener-then-press chain, or a show command. */
export function useRunCardAction(threadId: string | undefined, actionsId?: string) {
  const connection = usePlayConnection();
  const press = usePressButton();

  return async (action: CardAction, target?: string): Promise<ActionOutcome> => {
    const step = action.step;
    const channelId = step.type === "show" ? threadId : step.type === "press" ? step.button.channelId : step.opener.channelId;
    if (!channelId) return { error: "Your cards thread is not open yet." };
    const ids = [newestId(connection, channelId), actionsId && newestId(connection, actionsId)].filter(
      (id): id is string => !!id,
    );
    const baseline = ids.reduce<string | undefined>((a, b) => (!a || BigInt(b) > BigInt(a) ? b : a), undefined);

    if (step.type === "press") {
      const result = await press(step.button.channelId, step.button.messageId, step.button.customId);
      return { ...result, baseline };
    }
    if (step.type === "chain") {
      const opened = await press(step.opener.channelId, step.opener.messageId, step.opener.customId);
      if (opened.error) return { ...opened, baseline };
      const next = await waitForButton(connection, channelId, baseline, step.match);
      if (!next) return { error: "The bot did not offer that option right now.", baseline };
      const result = await press(next.channelId, next.messageId, next.customId);
      return { ...result, baseline };
    }
    const sub = target ? "show" : "show_to_all";
    const options = [
      { type: 4, name: step.option, value: step.number },
      ...(target ? [{ type: 3, name: "target_faction_or_color", value: target }] : []),
    ];
    const nonce = connection.runCommand(channelId, step.command, [{ type: 1, name: sub, options }]);
    const result = await waitForNonce(connection, nonce);
    return { ...result, baseline };
  };
}
