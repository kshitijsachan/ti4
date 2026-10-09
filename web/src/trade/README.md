# Trade panel (`web/src/trade`)

Propose trades to other players and answer the ones sent to you. A trade is the bot's own **transaction**: the panel
builds the same transaction items the bot's `offerToTransact_` buttons build and calls the bot's `sendOffer`, so the
receiver gets the usual **Accept / Reject / Reject and CounterOffer** buttons in their cards-info thread, and
acceptance + execution are 100% bot logic. The panel also lists open offers and presses those bot buttons for you.

## Usage

```tsx
import { TradePanel } from "@/trade";

<TradePanel
  gameName="pbd1"
  token={seatToken} // the player's seat token (localStorage), sent as `Authorization: Bearer`
  onPress={(channelId, messageId, customId) => connection.click(channelId, messageId, customId)} // optional
/>;
```

| prop                  |                                                                                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gameName`            | bot game id                                                                                                                                                     |
| `token`               | seat token; used as Bearer for `/bot/api/game/{game}/trade/**`                                                                                                  |
| `onPress`             | optional. Presses a bot button (Accept / Reject / Rescind). Pass the app's `PlayConnection.click` to reuse its socket; otherwise the panel opens its own `/app/ws?token=` connection lazily. Resolve `{ error }` or reject on failure. |
| `botBase`             | where the bot API is mounted (default `/bot`, the shim proxy)                                                                                                   |
| `initialCounterparty` | preselect a partner (faction, color, user id or name)                                                                                                           |
| `refreshSignal`       | any value; a change triggers an immediate refetch (e.g. newest message id in the player's cards-info thread)                                                    |
| `pollMs`              | poll interval (default 4000; pauses while the tab is hidden)                                                                                                    |
| `className`           | added to the root                                                                                                                                               |

Also exported: `useTradeData(game, token, { botBase, pollMs })`, `fetchTradeOptions`, `fetchPendingTrades`,
`proposeTrade`, and all types (`types.ts`).

The panel fills its container width and is responsive (the two ledger columns stack below ~640px via a container query).

## What it shows

- **Partners**: every other player with TG, commodities, PN and AC counts. Players the bot won't let you trade
  with (action phase without neighborship, Censure, Policy - The People: Control, …) are locked with the reason.
  Tags: *Neighbor*, *Open* (outside the action phase anyone may trade), *Allowed* (ability/PN/law), *Locked*.
- **You give / You get** ledger: steppers for trade goods, commodities, fragments (per trait), debt (send / clear);
  chips for promissory notes (max 1 per side, the bot's rule; hover for card text), action cards (only when one of you
  has Arbiters / Guild Ships — you pick specific cards to give, and ask for a *count* they choose), relics
  (tradable ones only). "Any (their pick)" asks for a PN of their choosing. Optional deal terms note (the bot's
  "Specify Deal" item). Proposing again to the same player replaces your open offer (the bot only accepts the newest).
- **Open offers**: incoming ones (Accept / Reject / Counter) float to the top; outgoing ones have Rescind. *Counter*
  rejects the offer and loads it, mirrored, into the ledger to edit and send back. Offers that were rescinded or
  replaced show as *Withdrawn* (the bot refuses them) and can be hidden locally.

## Bot endpoints (`ti4.spring.api.selfhost.TradeController`)

All need `Authorization: Bearer <seat token>`; through the shim they live under `/bot`.

- `GET /api/game/{game}/trade/options` → `TradeOptions` (`me` with tradeable assets; `counterparties` with
  `canTrade`/`reason`/`neighbor`, public counts, requestable PNs, tradable relics, debt, `canTradeActionCards`).
- `POST /api/game/{game}/trade/propose` body `{to, give, receive, note?}` (see `TradeSide` in `types.ts`) →
  `{ok, offerNumber, to, items[], offerText}`; 400 `{error}` when the bot's rules don't allow it.
- `GET /api/game/{game}/trade/pending` → `{incoming[], outgoing[]}` with decoded `items` and the bot button refs
  (`channelId`, `messageId`, `customId`) to press via the shim's `/app/ws` `click` op.

## Dev harness

```sh
cd web && npx vite --config src/trade/dev/vite.config.mjs      # http://127.0.0.1:5182/?game=pbd1&t=<token>[&to=mentak&theme=…&w=460]
node src/trade/dev/shot.mjs out.png pbd1 <token> [width] [height] [extra query]   # Playwright screenshot (STEPS env = script)
```

## Not covered (use the bot's buttons in the cards-info thread)

Secret objectives (Zooid/Xin breakthroughs, Black Market Dealing), Black Market Dealing / Graft offers, "wash
commodities", Axis orders, star charts, planets (Hacan mech / alliance / DMZ), Age of Commerce technology, Mowshir
Freeport units, returning play-area PNs, and fog-of-war games (blocked in the panel).
