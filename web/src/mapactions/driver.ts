import type { Message, PlayConnection, PlayState } from "@/discord";
import { compareSnowflakes } from "@/discord/shared/snowflake";
import { baseId, choicesOf, idFaction } from "@/decisions/model/controls";

/**
 * Drives the bot's own buttons from the map, exactly as if the player pressed them in the popup: find the button
 * in a bot message, press it over the play connection, wait for the bot to acknowledge, then wait for the next
 * prompt to appear. All rules stay the bot's.
 */

export type FoundButton = {
  channelId: string;
  messageId: string;
  customId: string;
  label: string;
};

export type ButtonMatch = (
  base: string,
  label: string,
  customId: string,
) => boolean;

export type Scope = {
  /** Channels to look in (the game's action log, my hand thread, recent threads). */
  channelIds: string[];
  /** My faction: buttons locked to another faction (`FFCC_<other>_`) are never mine. */
  faction?: string;
};

const PRESS_TIMEOUT_MS = 20000;
const PROMPT_TIMEOUT_MS = 20000;

function mine(customId: string | undefined, faction?: string) {
  const f = idFaction(customId);
  return !f || !faction || f === faction;
}

/** The newest bot message in scope (newer than `after`, if given) with an enabled button matching `match`. */
export function findButton(
  state: PlayState,
  scope: Scope,
  match: ButtonMatch,
  after?: string,
): FoundButton | null {
  let best: FoundButton | null = null;
  for (const channelId of scope.channelIds) {
    const data = state.messages[channelId];
    if (!data) continue;
    for (let i = data.ids.length - 1; i >= 0; i--) {
      const id = data.ids[i];
      if (after && compareSnowflakes(id, after) <= 0) break;
      if (best && compareSnowflakes(id, best.messageId) <= 0) break;
      const m = data.byId[id];
      if (!m?.author?.bot) continue;
      const hit = choicesOf(m).find(
        (c) =>
          c.kind === "button" &&
          !c.disabled &&
          !!c.customId &&
          mine(c.customId, scope.faction) &&
          match(baseId(c.customId), c.label, c.customId),
      );
      if (hit?.customId) {
        best = {
          channelId,
          messageId: id,
          customId: hit.customId,
          label: hit.label,
        };
        break;
      }
    }
  }
  return best;
}

/** All enabled buttons of one message that are mine. */
export function buttonsOf(m: Message | undefined, faction?: string) {
  if (!m) return [];
  return choicesOf(m).filter(
    (c) =>
      c.kind === "button" &&
      !c.disabled &&
      !!c.customId &&
      mine(c.customId, faction),
  );
}

/** The newest message id across the scope (a baseline: prompts newer than it answer what we press next). */
export function newestId(state: PlayState, scope: Scope): string | undefined {
  let best: string | undefined;
  for (const channelId of scope.channelIds) {
    const last = state.messages[channelId]?.ids.at(-1);
    if (last && (!best || compareSnowflakes(last, best) > 0)) best = last;
  }
  return best;
}

/** Presses a button and settles when the bot acknowledges it. Rejects with the bot's error. */
export function pressButton(
  conn: PlayConnection,
  b: { channelId: string; messageId: string; customId: string },
) {
  return new Promise<void>((resolve, reject) => {
    const nonce = conn.click(b.channelId, b.messageId, b.customId);
    if (!nonce) {
      reject(new Error("Not connected to the game server."));
      return;
    }
    const settle = (error?: string | null) => {
      unsubscribe();
      clearTimeout(timer);
      if (error) reject(new Error(error));
      else resolve();
    };
    const check = () => {
      const results = conn.store.getState().results;
      if (nonce in results) settle(results[nonce]);
    };
    const unsubscribe = conn.store.subscribe(check);
    const timer = setTimeout(() => settle(), PRESS_TIMEOUT_MS);
    check();
  });
}

/** Resolves with the first value `probe` returns from the store (now or as it changes); null on timeout. */
export function waitFor<T>(
  conn: PlayConnection,
  probe: (s: PlayState) => T | null | undefined,
  timeoutMs = PROMPT_TIMEOUT_MS,
) {
  return new Promise<T | null>((resolve) => {
    let done = false;
    const finish = (v: T | null) => {
      if (done) return;
      done = true;
      unsubscribe();
      clearTimeout(timer);
      resolve(v);
    };
    const check = () => {
      const v = probe(conn.store.getState());
      if (v !== null && v !== undefined) finish(v);
    };
    const unsubscribe = conn.store.subscribe(check);
    const timer = setTimeout(() => finish(null), timeoutMs);
    check();
  });
}

/** Waits for a button matching `match` on a message newer than `after` (or an edit of `editOf`). */
export function waitForButton(
  conn: PlayConnection,
  scope: Scope,
  match: ButtonMatch,
  opts: { after?: string; timeoutMs?: number } = {},
) {
  return waitFor(
    conn,
    (s) => findButton(s, scope, match, opts.after),
    opts.timeoutMs,
  );
}

/** The current copy of one message from the store. */
export function messageOf(
  state: PlayState,
  channelId: string,
  messageId: string,
): Message | undefined {
  return state.messages[channelId]?.byId[messageId];
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
