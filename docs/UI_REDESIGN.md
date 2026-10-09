# UI redesign: "a board game, not Discord"

User feedback (verbatim themes): the chat-window style is obnoxious; too many buttons; wants popups that show the
relevant info as decisions are made; dislikes the chat-style log; the "Hand" tab is unclear; get rid of threads;
should feel like a normal board game; dislikes the scrollable player areas, wants a cleaner visualization.

## Target screen (`/game/:gameName`)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ TI4 · game name · Round 2 · Action phase · "Bot Alpha's turn"   [log] [chat] │  slim top bar
├──────────────────────────────────────────────────────────────────────────────┤
│ player boards: one compact card per player in a single non-scrolling row      │  <PlayerRail>
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│                       THE MAP (the table), full bleed                        │
│                                                                              │
│                                    ┌──────────────────────┐                  │
│                                    │ Decision popup        │  <DecisionHost>  │
│                                    └──────────────────────┘                  │
├──────────────────────────────────────────────────────────────────────────────┤
│ your hand: action cards · secret objectives · promissory notes (card fans)   │  <HandTray>
└──────────────────────────────────────────────────────────────────────────────┘
 drawers (closed by default): Game log (<GameLog variant="full">), Table talk (chat), Trade (<TradePanel>)
```

No channel list, no threads, no chat-as-main-UI. The bot's raw channel views stay reachable only behind an
"Advanced: raw bot channels" escape hatch in a settings menu (for when a decision isn't recognised).

## Modules and ownership (each agent edits only its own directory unless noted)

| Module | Dir | Export | Owner |
|---|---|---|---|
| Decisions | `web/src/decisions/**` | `<DecisionHost gameName />` | decisions agent |
| Hand | `web/src/hand/**` | `<HandTray gameName />` | hand agent |
| Game log | `web/src/gamelog/**` | `<GameLog gameName variant="ticker" \| "full" />`, `useGameEvents(gameName)` | log agent |
| Board layout, player rail, page shell | `web/src/board/**`, `web/src/pages/GamePage*`, `web/src/play/**` | page | layout agent (integrator) |

Shared, read-only for everyone except where noted: `web/src/discord/**` (socket client + store: `usePlay`,
`usePlayConnection`, `useChannelMessages`, Discord message types, `Markdown` renderer — reuse it to render bot text),
`web/src/play/attention.ts` (finds messages with buttons addressed to me — decisions agent may move/extend logic into
`web/src/decisions/`, layout agent owns removing AttentionTray), `web/src/draft/**`, `web/src/trade/**`.

Pressing a bot button: `usePressButton()` in `web/src/play/usePressButton.ts` → resolves on `interaction_done`
(`{error}` on failure). Modals the bot opens are handled by the existing `<ModalHost/>` (keep it mounted).
Seat token for authenticated bot APIs: `web/src/play/session.ts`.

Data sources: map/player state = bot web-data (`/bot/api/public/game/{g}/web-data`, live via STOMP; existing hooks
in `web/src/api/usePlayerData.ts`, `useGameState`); hand = `GET /bot/api/game/{g}/hand` (Bearer seat token; see
`playerHand` query in usePlayerData.ts) plus the player's `Cards Info-<game>-<name>` thread messages (which carry the
play/discard buttons); events = bot messages in `<game>-actions` (+ round/strategy threads).

## Rules for all agents

- Follow `web/CLAUDE.md`, `DESIGN.md`, `PRODUCT.md` (themed tokens, CSS modules, fixed px type scale) — but the
  product direction above overrides "density over hand-holding": calm, legible, board-game-like, few buttons visible.
- Use real game art (`/art/...`, `cdnImage()` in `web/src/entities/data/cdnImage.ts`; card images exist for action
  cards, SOs, PNs, strategy cards, agendas, tech under the bot resources — grep `web/src/domains/cards`).
- Do not run `npm run build` concurrently with others: use `npx tsc --noEmit -p tsconfig.app.json`, `npx eslint <your
  dir>`, and a Vite dev server (`npx vite --port <unique> --host 127.0.0.1`; config proxies to the shim at :8090).
  Only the layout agent runs the production build. Never run Docker. Watch memory (`free -g`).
- Test against the live stack (shim :8090, bot running; games pbd8 round 4, pbd9 round 2 with autopilot bots; player
  tokens in `/home/user/run/players.json` and the admin API). Playwright: Chromium at `/opt/pw-browsers`
  (`/opt/node-tools` playwright-core; see `web/e2e/screens.mjs`). Look at your screenshots.
- Commit your own directory when it typechecks: `git add <your paths> && git commit -m ... && git push origin
  claude/ecstatic-franklin-lutbck` (pull --rebase first if push is rejected), message ending with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01CwHE3aeLi1SaFWJzFFZiKD`. Commit at least every ~20 minutes.
- Never `pkill -f`/`pgrep -f` a pattern that appears in your own command line.
