# rollback — undo and "rewind to here"

Players can undo the last action or rewind the game to just after any event in the game log. Everything uses
the bot's own undo code path (`GameManager.undo`). That means the same locks, the same `<game>-undo-log` entry,
the same re-posted prompt and the same cards-info refresh as the bot's UNDO button and `/game undo`.

## Mounting (layout agent)

```tsx
import { UndoButton } from "@/rollback";

// in the top bar, inside <PlayProvider>; onOpenHistory opens the game-log drawer
<UndoButton gameName={gameName} onOpenHistory={() => setDrawer("log")} />
```

- The button is a 34×34 icon button, styled like the top bar's drawer buttons. Its tooltip names what will be
  undone ("Undo: tess pressed “Play Politics”").
- Clicking it opens a small popover with the label, an **Undo** button and a **History…** link (shown only when
  `onOpenHistory` is given). If the last button press was another player's, the bot refuses the undo (the same rule
  as the UNDO button). The popover then shows the reason and offers **Undo anyway**.
- Props: `gameName`, `onOpenHistory?`, `className?`. It needs no other setup. It reads the seat token from
  `@/play/session`.

The game log (`<GameLog variant="full">`) already has rewind built in, so it needs no wiring. Hovering a row (or
focusing it) shows a small ⏮ icon. Clicking it opens one confirm dialog: "Rewind the game to just after: Bob
researched Gravity Drive? Everything after this will be undone for everyone." Rows that were undone are greyed
and struck through. The ticker hides them.

## Bot endpoints (bot/patches, `ti4/spring/api/selfhost/Undo*.java`)

Auth for all three is `Authorization: Bearer <seat token>`, and the caller must be a player in the game.

- `GET /bot/api/game/{g}/undo-points` returns `{latestIndex, canUndo, points[], rewinds[]}`.
  - `points` are listed newest first: `{index, savedAt, label, command, actor, round, phase, current}`.
  - `rewinds` is the roll-back journal.
- `POST /bot/api/game/{g}/rewind {index}` restores save `index`. The bot keeps the pre-rewind state as the next
  save, then saves the rewound state on top of it, so one undo brings back everything the rewind threw away. It
  posts "⏪ <player> rewound the game to just after: **label**" in the actions channel.
- `POST /bot/api/game/{g}/undo {force?}` steps back once, the same as the UNDO button. It returns 409
  `{needsForce:true}` when the last press was someone else's. It posts "⏪ <player> undid: **label**".

The bot keeps only one linear history: a roll-back deletes the saves after its target. Fog-of-war games are
refused.

## How log events map to undo points (`lineage.ts`, pure, tested)

- **Save for an event.** The bot saves right after each action, and its messages reach the shim from a few ms
  before that save to a few ms after it. An event at time `t` therefore belongs to the first save at or after
  `t − 400 ms`. If no save follows within 15 s, the event changed nothing, so it uses the save before it.
- **Undone.** `GameUndoService` appends every roll-back (button, `/game undo`, web) to
  `<undo dir>/selfhost-rewinds.tsv`: at `at`, the game went back to the save from `toSavedAt`. The live history is
  rebuilt backwards from now: `[r.at, now] ∪ live(r.toSavedAt)`. Undoing a rewind therefore brings back the events
  that the rewind had greyed out.
- **Lost.** The journal also records the save times a roll-back deleted. A live event whose own save was deleted is
  shown but cannot be rewound to. It is never mapped to a neighbouring save.
- **Replay.** Messages posted within 2.5 s of a roll-back, other than the ⏪ announcement, are the bot re-posting
  the undone prompt. They are greyed like undone events.

## Dev

- Harness: `npx vite --config src/rollback/dev/vite.config.mjs` from `web/`, then open
  `http://127.0.0.1:5193/?t=<token>&g=pbd8`.
- Driver: `node src/rollback/dev/screens.mjs look|dialog <text>|rewind <text>|undo`. Screenshots go to
  `/home/user/run/screenshots/rollback/`.
- Tests: `node --test src/rollback/__tests__/lineage.test.ts`.
