# `src/discord` — play UI

Turns the shim's `/app/ws` protocol (see `docs/ARCHITECTURE.md`, "Browser protocol") into the in-game
play surface: channels, Discord-faithful messages with live buttons/selects, modals, slash commands, the
action log and the player's hand. Self-contained; import everything from `@/discord`.

```tsx
import { PlayProvider, ChannelList, ChannelView, ActionLog, HandPanel, ModalHost, Toasts } from "@/discord";

<PlayProvider token={seatToken}>
  <ChannelList gameName="pbd1" />
  <ChannelView channelId={activeId} />
  <ActionLog gameName="pbd1" />
  <HandPanel gameName="pbd1" />
  <ModalHost />   {/* once, anywhere inside the provider */}
  <Toasts />      {/* once */}
</PlayProvider>
```

Importing `@/discord` also imports `play.css` (the `--play-*` tokens, declared on `.ti4play`, derived from
the active theme's panel tokens). The page must already load the app's global styles (`styles/theme.css`,
`overlays.css`, `zIndexVariables.css`) and sit inside a `MantineProvider`, as `main.tsx` does.

## Components

| Component | Props | Notes |
|---|---|---|
| `PlayProvider` | `token: string` seat token; `url?` ws endpoint (default same-origin `/app/ws`; pass `ws://127.0.0.1:8090/app/ws` without a proxy); `onNavigateChannel?(id)` called for `<#channel>` / Discord channel links (default: sets the store's active channel); `connection?` inject a pre-built `PlayConnection` (tests) | Opens the socket, reconnects with backoff (0.3s → 15s), re-syncs loaded channels after a reconnect. Renders nothing until created. |
| `ChannelList` | `selectedId?` (default store `activeChannelId`); `onSelect?(id)` (default sets it); `gameName?` only that game's channels, with the `game-` prefix stripped from names; `className?` | Categories by position, threads nested under parents, unread counts + mention badges, onboarding threads ("Info for Players new to AsyncTI4"…) in a collapsed "Guides & info" group. First visit treats history as read. |
| `ChannelView` | `channelId`; `header?` (true); `headerExtra?` node; `composer?` (true); `variant?` `"cozy" \| "log" \| "hand"`; `filter?(message)`; `empty?` node; `className?` | Fills its parent's height (`height: 100%`). Marks the channel read while mounted. |
| `ActionLog` | `gameName`; `composer?` (true); `className?` | `<game>-actions` as a compact time-stamped ledger; header toggle hides player chatter. |
| `HandPanel` | `gameName`; `composer?` (false); `className?` | The player's private cards-info thread (`<game>-cards-info-*` or `Cards Info-<game>-*`); empty state until the bot creates it. |
| `ModalHost` | — | Bot modals (legacy action-row text inputs and new label/select modals); submits `modal_submit`, keeps the form open and shows the bot's error if it refuses. |
| `Toasts` | — | Action failures (`interaction_done.error`, timeouts, lost connection). |
| `ConnectionStatus` | — | "Live / Reconnecting / Bot offline" pill (already in `ChannelView`'s header). |
| `MessageList`, `Markdown` | see source | Lower-level pieces, exported for custom layouts. |

Hooks: `usePlay(selector)` reads the store (`PlayState` in `client/store.ts`: `me`, `users`, `roles`,
`channels`, `messages[channelId]`, `unread`, `mentions`, `pending`, `modals`, `activeChannelId`, `status`…),
`usePlayConnection()` returns the `PlayConnection` (`click`, `select`, `submitModal`, `sendMessage`,
`runCommand`, `autocomplete`, `dismiss`, `loadHistory`, `actions.setActiveChannel`…),
`useChannelMessages(id)`, `useViewingChannel(id)`.

## Behaviour notes

- The bot is authoritative: nothing is optimistic. A clicked button/select shows a spinner until
  `interaction_done` (or a `modal`) with its nonce arrives; an error becomes a toast.
- Message lists render a window (newest 80, growing by 80 as you scroll up, at most 320 in the DOM),
  page history from the server with `before`, keep the reader's place when content lands above them, and
  stick to the bottom while the reader is there ("Jump to latest" otherwise).
- Modal submits echo Discord's numeric component `id`s (assigned depth-first from 1 when the modal had
  none) — JDA refuses a submit without them.
- Images in `/attachments/...` and emoji in `/emojis/{id}` are same-origin relative URLs.

## Dev harness

```sh
cd web
npx vite --config src/discord/dev/vite.config.mjs        # proxies /app (ws), /emojis, /attachments, /bot → :8090
open http://127.0.0.1:5180/discord-harness.html?t=<seat token>      # live, e.g. a token from run/players.json
open http://127.0.0.1:5180/discord-harness.html?fixtures=1          # offline: every renderer state
open http://127.0.0.1:5180/discord-harness.html?fixtures=1&modal=1  # + an open modal
open http://127.0.0.1:5180/discord-harness.html?fixtures=1&bulk=5000  # long-log perf check (#fx1-table-talk)
```

`SHIM_URL` / `PORT` env vars override the proxy target and port. Fixtures live in `dev/fixtures.ts`.
