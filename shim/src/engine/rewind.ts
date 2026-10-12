/**
 * A game was rolled back (UNDO button, /game undo, web undo / rewind): what the shim remembers about that game's
 * prompts and decisions describes a future that no longer exists. Answers sent, per-decision caps (answers, refusals,
 * identical accepts), "already pressed" sets, give-ups and watchdog clocks are keyed by decision id ("d" + message id),
 * message id, channel id or game — and the engine re-opens a restored prompt under its old id, revision 1 — so without
 * a reset a seat would skip the restored prompts as "done" or "dead" and the game would wait forever.
 *
 * Signals (either is enough; Autopilot.rewound dedupes them):
 * - the engine's `game.rewound` event (DecisionRegistry.rewound, sent before it re-opens the restored prompts);
 * - fallback without that event (an older bot, or the engine off): the bot's roll-back notice — "Rolled back to save
 *   `N`…" (undo-log thread, every undo path) or the web rewind / undo notice starting with ⏪ in the actions channel.
 */

/** Which keys belong to one game: its name, its channels and the messages (prompts) posted in them. */
export type GameScope = { game: string; channelIds: ReadonlySet<string>; messageIds: ReadonlySet<string> };

/** The bot's own roll-back notices (GameUndoService.sendUndoConfirmationMessage; UndoService rewind / undo). */
const ROLLBACK_NOTICE = /^(Rolled back to save `\d+`|⏪ )/;

export function isRollbackNotice(content: string | undefined | null): boolean {
  return ROLLBACK_NOTICE.test(String(content ?? ""));
}

/**
 * Does a memory key belong to the game? Keys start with one id followed by a separator (`:`, `@`, `#`, `|`):
 * a message id (`${m.id}:${custom id}`), a decision id (`d${message id}@rev#n|answer`), a channel id
 * (`${channel}:label:…`), or the game (`${game}|${decision}`, or the game alone).
 */
export function keyInGame(key: string, scope: GameScope): boolean {
  if (key === scope.game) return true;
  const head = key.split(/[:@#|]/, 1)[0];
  if (head === scope.game) return true;
  if (scope.messageIds.has(head) || scope.channelIds.has(head)) return true;
  return head.length > 1 && head.startsWith("d") && scope.messageIds.has(head.slice(1));
}

/** Removes every key of the game from these maps / sets; returns how many went. */
export function forgetGameKeys(containers: Iterable<Map<string, unknown> | Set<string>>, scope: GameScope): number {
  let n = 0;
  for (const c of containers) {
    for (const k of [...c.keys()]) {
      if (typeof k === "string" && keyInGame(k, scope)) {
        c.delete(k);
        n++;
      }
    }
  }
  return n;
}

/**
 * After a roll-back the autopilots leave the game alone until the engine says its prompts are restored (game.rewound
 * with reason "restored", ~3 s), at most this long (bots that never send it, roll-back notices).
 */
export const REWIND_SETTLE_MS = 12_000;

/** Signals of one roll-back arriving by both routes (event, then notice) count once. */
export const REWIND_DEDUPE_MS = 20_000;

/**
 * Whether a roll-back signal for `game` is new: not within REWIND_DEDUPE_MS of the last one from the other route.
 * Every engine event counts (the engine sends one per roll-back); a notice right after an event (or the reverse)
 * is the same roll-back.
 */
export function newRewind(last: Map<string, { at: number; via: "event" | "notice" }>, game: string, via: "event" | "notice", now = Date.now()): boolean {
  const prev = last.get(game);
  last.set(game, { at: now, via });
  if (!prev || now - prev.at > REWIND_DEDUPE_MS) return true;
  return prev.via === via && via === "event";
}
