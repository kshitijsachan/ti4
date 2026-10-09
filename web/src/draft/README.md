# Draft view (`web/src/draft`)

A web UI for the bot's setup drafts: classic **Milty** (`MiltyDraftManager`) and the newer **draft system**
(`DraftManager`: nucleus, seats, speaker order, …). The bot is still the rules engine. This view reads a JSON
snapshot of the draft from the bot, and it picks by pressing the bot's own Discord buttons through the shim.

## Usage

```tsx
import { DraftView } from "@/draft";

<DraftView
  gameName="pbd2"
  myUserId={hello.me.id}
  onPick={(customId, channelId, messageId) =>
    // send {op:"click", channel_id, message_id, custom_id, nonce} on the /app/ws socket,
    // and resolve on the matching `interaction_done` (resolve `{ error }` or reject on failure)
    socket.click(channelId, messageId, customId)
  }
  refreshSignal={lastMessageIdInActionsChannel} // optional: bump it to refetch right away
/>
```

Props:

| prop | |
|---|---|
| `gameName` | the bot game id (`pbd2`) |
| `myUserId` | the viewer's Discord user id (`hello.me.id` from the shim) |
| `onPick(customId, channelId, messageId)` | presses the bot button. It may return a promise. If the promise rejects, or resolves to `{ error }`, the view shows the error and rolls back its optimistic pick. |
| `botBase` | where the bot API is mounted (default `/bot`, the shim proxy) |
| `refreshSignal` | any value. A change triggers an immediate refetch. |
| `className` | added to the root element |

The view fills its container and scrolls with the page. The right column is sticky. It renders a placeholder
when the game has no draft (`status: "none"`). It polls every 2 s and pauses polling while the tab is hidden.
Unchanged responses don't re-render. A pick updates the UI at once (optimistic update), and the next poll
replaces the optimistic state with the bot's real state.

Also exported: `useDraftState(gameName, { botBase, pollMs })` and the `DraftState` types (`types.ts`).

## What it shows

- **Header:** draft type, map template, who is on the clock (with a "Your pick" state light), and the pick counter.
- **Pick tracker:** every slot of the snake, by round. Done slots are dimmed and the live slot is lit.
- **Slices:** each slice is drawn as a mini hex cluster with real tile art, laid out the way the bot lays it
  out (home at the bottom). Each one shows its total R/I, optimal R/I + flex, value, tech skips, wormholes,
  legendaries and anomaly count, plus a Pick button. Once a slice is taken, its home hex shows the owner's
  faction home system.
- **Factions:** cards with icon, source, complexity, commodities, home planet R/I, abilities and faction tech.
- **Speaker order / Seats** tokens, and a generic list for any other draftable the bot adds.
- **Draft board:** who holds what (faction, slice, seat or speaker order).
- **Galaxy:** the map template with the tiles the bot has placed so far, and seat numbers with their owners.
  When you hover a slice, the view previews it in your seat (or in the seat you're hovering).
- **Inspector:** hover a card to see it here, click to pin it. A slice shows each tile's planets (R/I, traits,
  skips, legendary ability) and its anomalies. A faction shows its home system and its abilities and tech.

Pick buttons only light up when you can actually pick. Otherwise they say why ("Ember is picking",
"You already have a slice", …).

## Backend (bot, `ti4/spring/api/selfhost/`)

- `GET /api/public/game/{game}/draft`: the JSON described in `types.ts` (`DraftViewController`,
  `DraftViewService`, `DraftViewModels`). Every choice carries `customId`, `channelId` and `messageId` of the
  bot button that makes the pick. `DraftButtonLocator` finds the message by reading the last 200 messages of
  the game's main channel through JDA (that is, through the shim), and caches the result per game version.
- `GET /api/public/selfhost/tile/{tileId}?w=160|240`: the tile PNG from the bot's resources, scaled, so tile
  art never depends on a CDN.
- Emoji glyphs (faction icons, wormholes, skips, …) are shim `/emojis/{id}.png` URLs that the bot resolves.

## Dev harness

```
cd web && npx vite --config src/draft/dev/vite.config.mjs      # port 5180 (DRAFT_DEV_PORT to change)
open http://127.0.0.1:5180/?game=pbd2&t=<player token>
```

The harness connects its own player socket (`dev/shimSocket.ts`). It proxies `/bot`, `/app` (ws),
`/emojis`, `/attachments` and `/art` to the shim at `127.0.0.1:8090`.
Playwright drivers live in `/home/user/run/scripts/draft-*.mjs` (`draft-play.mjs <game> <picks>` drives a
whole draft through the UI and takes screenshots).

## Not covered yet

- Milty "queue a pick" buttons (they live in each player's cards-info thread) aren't exposed.
- The signal colours (resource and influence ink, seat hues, the green "live" state) are defined at
  `.root` in `Draft.module.css`. They could move to `themeSharedTokens.css` when that file is touched next.
