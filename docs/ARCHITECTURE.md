# Architecture

TI4 Online runs the **unmodified-as-possible AsyncTI4 Discord bot** (the rules engine, art, drafts, everything)
against a **fake Discord** that we host, and gives players a web client instead of Discord.

```
 browser (web/)  ──/app/ws (our JSON protocol)──▶  shim (shim/)  ◀──Discord REST /api/v10 + gateway /gateway──  bot (AsyncTI4, Java)
       │                                              │                                                           │
       └──────────── /bot/* (proxied, read-only) ─────┴──────────────▶ bot's Spring API :8081 (game state JSON, STOMP /ws)
```

## Pieces

- Bot additions (new files under `ti4/spring/api/selfhost/`): draft state (`/api/public/game/{g}/draft`), trades
  (`/api/game/{g}/trade/{options,propose,pending}`), art (`/api/public/selfhost/art/**`, `/api/public/selfhost/tile/{id}`).
- `bot/` — how we build the bot: upstream `AsyncTI4/TI4_map_generator_bot` at `bot/UPSTREAM_COMMIT` plus
  `bot/patches/*.patch`. Keep patches tiny and guarded by `ti4.selfhost.SelfHosted.isEnabled()` (true when
  `DISCORD_API_BASE` is set) so upstream merges stay easy. The bot is the source of truth for rules.
- `shim/` — Node/TypeScript server (port 8090):
  - `/api/v10/*` Discord REST subset (`rest.ts`), `/gateway` Discord gateway (`gateway.ts`). JDA is pointed here.
  - `/app/ws?token=` browser realtime protocol (`clients.ts`), `/app/*` site HTTP endpoints (`lobby.ts`).
  - `/attachments/:id/:name`, `/emojis/:id` serve files the bot uploaded (map images, 1500+ emoji icons).
  - `/bot/*` proxies to the bot's own API (`/bot/api/public/game/...`; non-GET only under `/api/game/**`, seat
    token as Bearer) and `/bot/ws` its STOMP socket.
  - `/art/*` game art (tiles, units, tokens, cards) from the bot's resources: from `$ART_DIR` if set, else proxied
    to the bot's `/api/public/selfhost/art/**`. Links the bot posts to AsyncTI4's art CDNs are rewritten to `/art/`.
  - Serves the built web client (`web/dist`) for everything else (SPA fallback).
  - State in `$SHIM_DATA/state.json` (+ `files/`, `emojis/`). Messages are stored Discord-shaped.
  - `hub.ts` is the single place that mutates state and fans out to both the bot and browsers.
- `web/` — fork of `AsyncTI4/ti4_web_new` (React 19 + Vite + Mantine), commit in `web/UPSTREAM_COMMIT`.
  It already renders the live map / player areas from the bot's game-state JSON. We add the play UI
  (channels, messages, buttons, modals, hand, drafts, trades) and remove asyncti4.com-only features.

## Identity

There are no accounts. Each player is a fake Discord user with a secret seat token. The player's link is
`/play?t=<token>` (the web app stores it in localStorage). The host uses `/admin?key=<admin_token>`
(printed by the shim at startup) to create players and copy their links.

## Autopilot seats (solo testing)

A seat flagged `autopilot` (`seats[token].autopilot`, set from the admin page or `POST /app/admin/players
{names, autopilot: true}` / `POST /app/admin/autopilot {user_id, enabled}`) is played by the shim (`autopilot.ts`).
Each one is a virtual browser client (`Clients.attachVirtual`): same frames, same `click` / `select` ops, so the
bot sees ordinary interactions. Its policy is a heuristic table over button custom ids / labels: first legal Milty
pick, preferred strategy cards, play the strategy card then pass, decline every reaction window (not following,
no sabotage, no whens / afters, pre-abstain), no objective scoring, roll combat dice once per round and auto-assign
hits, trade (`botplay/trade.ts`: accept fair offers, reject bad ones and never give away PNs, propose N-1 commodity washes, run the Trade card "free replenish for a wash" deal), break agenda ties as speaker, and press the first sensible button of prompts that are
certainly its own (ephemeral, its faction's `FFCC_` buttons, replies to its own press). Undo / take-back / admin /
info / modal buttons are never pressed. Decisions are logged as `autopilot <name>: pressed "<label>" in #channel
(<why>)`. With `ANTHROPIC_API_KEY` set, prompts no rule covers are put to Claude (`AUTOPILOT_MODEL`, default
`claude-sonnet-5-5`), falling back to the heuristics on any error.

**One-click solo game** (`solo.ts`): `POST /app/solo-game {token, bots: 2..7 (default 3), expansion?: te | newPoK |
oldPoK}` creates fresh autopilot seats (`Bot Alpha`, …, `Bot Alpha 2`, …) and then, as the human (a virtual client of
their seat), runs `/game create_game_button` in #lobby, presses Launch Game, the expansion button (`chooseExp_te`),
Start Milty Setup and the Milty settings' Start Draft (`jmfA_main_startMilty`, defaults). It answers `{game, url}`
once the game exists; `GET /app/solo-game/status?game=` reports `state` (`setting_up` → `drafting`, or `error`) and
`step`. The "Quick solo game" panel on /play and /admin calls it and opens `/game/<game>` once drafting. The bot's
10-minute creation lock, "same players as the last game" refusal and per-player game limits are off when self-hosted.

The web client keeps the seat token per tab (sessionStorage, localStorage as the default for new tabs), so a host
can open several seats side by side; the admin page's "Open as" links open a seat in a new tab.

## Browser protocol (`/app/ws?token=...`)

Server → client frames `{t, ...}`:
- `hello` `{me, bot_id, guild_id, users[], roles[], channels[] (visible to me), commands[], bot_online}`
- `history` `{channel_id, messages[], has_more, nonce}` (oldest → newest)
- `message_create` / `message_update` `{message}` — Discord message objects; `message.ephemeral=true` = only you
- `message_delete` `{channel_id, id}`
- `channel_upsert` `{channel}` / `channel_delete` `{id}` / `channels` `{channels[]}` (full visible set)
- `user_upsert` `{user}`
- `modal` `{interaction_id, nonce, modal}` — Discord modal payload (`custom_id`, `title`, `components`)
- `interaction_done` `{nonce, error?}` — the bot acknowledged (or failed) your action
- `autocomplete` `{nonce, choices[]}`

Client → server frames `{op, nonce?, ...}`:
- `history` `{channel_id, before?, limit?}`
- `click` `{channel_id, message_id, custom_id}`
- `select` `{channel_id, message_id, custom_id, values[], component_type?}` (3 string, 5 user, 6 role, 7 mentionable, 8 channel)
- `modal_submit` `{interaction_id, custom_id, components}` — Discord modal-submit components (label type 18 / action rows with values)
- `send` `{channel_id, content, reply_to?}` — chat as the player
- `command` `{channel_id, name, options}` — slash command; options in Discord interaction format
- `autocomplete` `{channel_id, name, options}` (the focused option has `focused: true`)
- `dismiss` `{channel_id, message_id}` — delete one of my ephemeral messages

## Game channel layout (created by the bot per game, e.g. game `pbd1`)

- Category `PBD #0-9` → text `pbd1-<fun-name>` (table talk), text `pbd1-actions` (the action log + buttons).
- Thread `pbd1-bot-map-updates` (map images), private threads `pbd1-cards-info-<player>` (each player's hand),
  plus combat threads, draft threads, etc. Player visibility is driven by Discord permission overwrites,
  the game role, and private-thread membership — the shim enforces these (`Store.canView`).

## Local dev stack (this container)

- Postgres 16 (`service postgresql start`), DB/user `tibot`/`tibot`.
- Bot: `/home/user/run/run-bot.sh` (env in `/home/user/run/bot.env`), build `/home/user/run/build-bot.sh`,
  stop `/home/user/run/stop-bot.sh`. Bot source checkout: `/home/user/asyncti4/ti4_map_generator_bot`.
- Shim: `/home/user/run/start-shim.sh` (data `/home/user/run/shim-data`, log `/home/user/run/shim.log`).
- Scripted player: `node /home/user/run/scripts/client.mjs <token> '<op json>' [ms]`.
- Never `pkill -f` a pattern that appears in your own command line; use the stop scripts.
