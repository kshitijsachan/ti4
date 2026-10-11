# Engine API: typed State + Decisions + direct Actions

Status: **contract v1, plumbing landed** (bot branch `engine-core`, ti4 branch `worktree-agent-a852e08903ba6cd13`).
This document is the contract that the parallel workstreams build on. Read sections 1–4 before touching anything;
section 6 is the recipe each area team follows.

## 0. Why

Nearly every bug this week came from bots and the web *inferring* facts from Discord-shaped text and buttons
(a bot cached the wrong faction from a draft button, pressed another faction's buttons, ignored its own strategy-card
pick, game stalled). The fix is to make the engine *say* those facts:

1. **State** — authoritative structured game state from inside the JVM (player ↔ faction, units, planets, cards, phase, active player).
2. **Decisions** — every question the engine asks, as a typed object: who it is for (a resolved player, never text), kind, options with semantics.
3. **Actions** — "player P picks option O of decision D", validated by the engine, executed without a browser or gateway round trip.
4. **One stream** — state changes and decision open/update/close events, consumed by bots and the web alike.
5. Discord emulation stays underneath while we migrate, then goes, piece by piece.

## 1. What the engine looks like today (measured on upstream 5a0f166 + patch 0001)

| Fact | Number | Where |
|---|---|---|
| Button routes (`@ButtonHandler`, prefix match) | **2,339** on 2,323 methods in 577 files (1,771 distinct literal prefixes + constant-named ones) | `discord/interactions/routing/AnnotationHandler`, `HandlerRegistry` (longest-prefix match) |
| …of which `save=false` (read-only) | 133 | |
| Selection-menu / modal handlers | 15 / 38 | `@SelectionHandler`, `@ModalHandler` |
| Handler methods that take the JDA event | **2,274 / 2,323 (98%)** | `ButtonInteractionEvent` / `GenericInteractionCreateEvent` params |
| Uses of `event.getChannel()/getMessageChannel()` | 2,931 | handlers + helpers post replies to "the channel of the click" |
| `deleteMessage(event)` / `deleteTheOneButton(event…)` | ~2,519 | buttons are removed by editing the clicked message |
| `event.getMessage()` / `event.getHook()` / `event.reply…` | 404 / 68 / 173 | |
| Button construction sites `Buttons.green/red/blue/gray(...)` | **5,495** | |
| …custom id starts with the owner prefix (`FFCC_<faction>_` via `player.factionButtonChecker()`) | **2,232 (41%)** | `ComponentIdEnvelope.ownedBy`, `Player.factionButtonChecker()` (2,303 calls) |
| …literal id with no owner | 2,605 (47%) | target = channel (cards-info thread), interaction user (ephemeral), or "anyone" (e.g. follow SC) |
| …computed id (variable) | 658 (12%) | |

Dispatch path: `ButtonListener.onButtonInteraction` → defer → `ButtonProcessor.queue` (per-game lock via
`ExecutorServiceManager.runAsyncWithLock`; WRITE unless `save=false`) → `ButtonContext`/`ListenerContext`
(resolve game from channel name, player from the user, **owner check**: `FFCC_<f>_` must match the presser's faction,
else "these buttons are for someone else"; `dummyPlayerSpoof<f>_` acts as that player; `deleteThisButton` /
`deleteThisMessage` markers) → `HandlerRegistry.resolve` (longest prefix) → handler → `context.save()` →
`GameManager.save` → `GameSaveService` (game file + DB sync) and `GameWebStatePipeline.queue` (web-data push on
STOMP `/topic/game/{name}/state`). Undo: `GameUndoService` keeps numbered snapshots; our `UndoService/UndoJournal`
(selfhost) exposes it; after an undo the bot re-posts saved buttons (`generateSavedButtons`).

Consequences that shape the design:

* **The question is only ever a Discord message.** No in-JVM object exists for "the engine is waiting for X";
  the pending decision *is* the message with buttons. So capture must happen where messages are sent.
* **Identity is explicit for only 41% of buttons.** The rest is implied by where the message is (cards-info thread,
  ephemeral reply) or deliberately open to everyone (follow strategy card, sabotage window, agenda). The engine
  knows these facts (thread owner = `Player.getCardsInfoThreadID()`, the interaction's user), so it can resolve them;
  text never needs to be read.
* **Handlers cannot be called without a JDA event** (98% take one and use it for channel/message/reply). Calling
  them "without simulating a click" needs an interaction abstraction — a large mechanical refactor. Phase 1
  therefore runs handlers with a real, synthesised `ButtonInteractionEvent` built *inside* the JVM (see §3.4); the
  refactor is a later, separable workstream (§7, W-INFRA-3). This is the main pushback on the original direction.

## 2. Target architecture

```
                   ┌──────────────────────────── bot JVM (rules library) ───────────────────────────┐
 handlers ──send──▶│ JDA REST ─▶ DecisionCapture (OkHttp interceptor) ─▶ KindSpec plugins ─▶ DecisionRegistry │
 (unchanged)       │                    ▲ target resolution from Game/Player                │ seq-ordered log │
                   │ GameWebStatePipeline.queue ─▶ Engine.onStateChanged ──────────────────────┤                 │
                   │ EngineController: /state  /decisions  /answer  /stream (SSE) ◀─────────────┘                 │
                   │ ActionInvoker: validate ─▶ mint interaction ─▶ ButtonProcessor.processNow (sync)              │
                   └───────────────▲──────────────────────────────────────────────┬────────────────────────────────┘
                     answer (Bot token / seat Bearer)                     SSE events (Bot token)
                   ┌───────────────┴──────────────────────── shim ─────────────────▼───────────────────────────────┐
                   │ EngineClient (mirror of open decisions per game) ─▶ autopilot (typed policy first, rules after)   │
                   │                                                  ─▶ browser ws (next: t:"engine" frames)          │
                   │ Discord REST/gateway emulation (shrinks per phase; mints interactions for engine answers)         │
                   └───────────────────────────────────────────────────────────────────────────────────────────────────┘
```

End state: the shim is a thin session/lobby server and stream fan-out; the web renders **only** `GameState` +
`Decision`s; bots read the same; Discord REST/gateway emulation, message storage, and the heuristics
(`web/src/decisions/detect`, `model/classify.ts`, autopilot rule table) are deleted.

## 3. The contract (v1)

Source of truth: Java `ti4.selfhost.engine.EngineModels` ⇄ TS `shim/src/engine/types.ts` (dependency-free; the web
imports it). Change both together; bump `CONTRACT_VERSION` on breaking changes. Additive fields are non-breaking.

### 3.1 State — `GameState`

`game, stateVersion (= Game.lastModifiedDate; changes on save and undo), seq, phase, round, activePlayer, speaker,
players[], strategyCards[], tiles[], publicObjectives, laws, draft`. Each `PlayerState` carries the authoritative
`userId ↔ faction ↔ color`, resources, command tokens, techs (+exhausted), planets (+exhausted), relics, fragments,
leaders, scored secrets, card *counts*, and `hand` (card id → engine handle) **only for the viewer**. Tiles list
holders (`space` / planet id) with unit stacks (`owner` faction, `unit` async id, count, damaged, galvanized),
tokens, control. Built by `StateSnapshotBuilder` straight from `Game`/`Player` — no text, no images. Each area
team extends it with what its UI/bot needs (e.g. agenda in play, votes; combat state).

### 3.2 Decision

```ts
interface DecisionBase<K, V> {
  id; game; kind: K;               // id stable per prompt message; kind = "legacy" or a typed "area.verb"
  seq; stateVersion; revision;     // seq = registry event seq of this revision; revision 1,2,3… per edit
  target: { userId, faction, color, resolvedBy } | null;
  scope: "player" | "table";       // table: every seated player may answer for themself (follow SC, sabotage…)
  visibility: "public" | "private";// private: only target sees it (cards-info thread, ephemeral, private channel)
  prompt: string;                  // display only — never parse it
  options: { id, label, style, emoji, disabled, needsInput, handler, value: V | null }[];
  source: { channelId, messageId, customIdPrefix, ephemeral };
  window: ReactionWindow | null;   // everyone-answers prompts (§3.2.1)
  progress: Progress | null;       // multi-step prompts edited in place (§3.2.2)
}
type Decision = StrategyCardPick | TechGain | SecretObjectiveDiscard | MiltyDraftPick | LegacyDecision | …
```

* **Every** message with components becomes a Decision. Untyped ones are `kind: "legacy"` (options carry
  label/style/handler only) so consumers can migrate kind by kind while everything stays answerable.
* `option.id` is opaque (today: the custom id; select options `customId#value`). `value` is the typed payload —
  `null` for options outside the kind's vocabulary ("Done", "Cancel").
* `target.resolvedBy`: `owner_prefix` (FFCC_), `spoof_prefix`, `interaction_user` (reply/followup/ephemeral to that
  player's press), `cards_thread`, `private_channel`, `draft_turn` (kind override), `mention` (weak: exactly one
  seated player mentioned, no owner prefix), `mixed_owners`, `none`. Consumers should treat `mention`/`none` as
  "not certainly mine" — exactly the cases a kind should fix with a `target()` override.

#### 3.2.1 Reaction windows

Follow-the-strategy-card, whens/afters, sabotage, agenda votes and similar prompts are not "one player's
question": every eligible player answers, in parallel, and the engine moves on when all have. Today the engine
tracks this in stored values and message reactions (~500 handlers), not per-player prompts. Contract:
`window = { kind, subject, eligible: uid[], responded: uid[], responses: {uid: summary} }` on a `scope:"table"`
decision. The kind computes it in `KindSpec.window(ctx)` from engine state (stored values, `Game`), and declares
`dynamic()` so it is recomputed after every save (→ `decision.updated`). `ActionInvoker` accepts one answer per
eligible player (403 if not eligible, 409 if already responded; in-flight guard is per user). A client is "on the
hook" when `awaits(d, me)` (types.ts). When the engine deletes the prompt the decision closes as usual.

#### 3.2.2 Multi-step decisions (accumulators)

Movement, landing, hit assignment, payment, when/after queues and agenda voting edit one message in place over
several presses (~380 handlers), and some keep running totals only in message text (agenda vote count parsed from
labels). Contract: the decision id is stable per message (an edit in place is `decision.updated`, `revision`+1, the
same decision), and `progress = { flow, step, accumulated, required, canCommit }` carries the typed running
selection, computed by `KindSpec.progress(ctx)` **from engine state** (stored values, `Game`, `Player`) so it is
reload/restart-safe. Where the engine keeps the running state *only* in message text, the area team moves it into a
stored value first (small handler change, keep upstream-compatible) — never parse it from the text. `flow` groups
consecutive prompts that are one logical action (e.g. `tactical:<uid>:r3`) when a step posts a new message instead
of editing.

Typed kinds in v1: `strategy_card.pick` {strategyCard, tradeGoods}; `tech.gain` {tech, free, starting, flags};
`secret_objective.discard` {handle, secretObjective, redraw}; `draft.milty.pick` {category, pick} (target = draft's
current player, re-resolved after every state change).

### 3.3 Capture (how decisions are born, updated, closed)

`DecisionCapture` is an OkHttp interceptor installed on JDA's REST client (`JdaService`, self-host branch). It sees
every message the engine creates/edits/deletes — channel posts, interaction replies (`with_response`), followups,
`@original` edits, deletes, bulk deletes — i.e. all 5,495 construction sites with zero handler edits. For each
message: collect buttons/select options → find the game from the channel (`GameNameService`) → resolve the target
(§3.2 order) → classify by `KindSpec` (highest priority spec matching any option's handler id) → build typed values
→ `DecisionRegistry.open` (replaces the open revision on the same message; identical re-edits are ignored).
Message deleted or components removed → `decision.closed`. `InteractionTracker` (JDA listener) records
interaction token → user so replies are attributed to the presser, not guessed.

Known capture gaps (documented, small): an interaction reply sent without `with_response` (JDA's default is
fine against the shim? verify per kind) has no message id → not captured; messages in channels not in JDA's cache;
lobby (pre-game) messages are ignored (no game).

### 3.4 Actions

`POST /api/public/selfhost/engine/{game}/decisions/{id}/answer` (Bot token; body `{userId, optionId, expectedSeq?,
requestId?}`) or `POST /api/game/{game}/engine/decisions/{id}/answer` (seat Bearer; user from the token).
`ActionInvoker`:

1. idempotency: same `(user, requestId)` returns the first result;
2. decision open? `expectedSeq` matches? (else **409 stale**) — answering a changed prompt is impossible;
3. user seated; for `scope:"player"` user == target (else **403**); option exists, enabled, not `needsInput`;
4. `KindSpec.validate` (e.g. "not your turn to pick");
5. one answer in flight per decision (else **409 busy**);
6. the shim mints an interaction for that user on that message (`POST /api/v10/selfhost/interactions`, bot token)
   → the JVM builds a real `ButtonInteractionEvent` from it and runs `ButtonProcessor.processNow` **synchronously**
   (same game lock, ownership check, save, undo snapshot as a click);
7. returns `{ok, status, seq, stateVersion, opened: Decision[]}` — the decisions the answer opened, so a bot can
   chain without polling.

No gateway hop, no browser, no "which message is mine" inference. Not answerable yet: selects (`#value` options)
and modal buttons (`~MDL`, `needsInput`) → keep the legacy press path for those until W-INFRA-3.

**Structured answers (G6).** Instead of `optionId` an answer may carry `payload` (a JSON object). The kind's
`KindSpec.answerPayload(game, player, decision, payload, steps)` then runs the whole flow server-side through
`Steps` (`press(decision, optionId)` as the answering player, `await(afterSeq, predicate, timeoutMs)` for the next
prompt), after the generic checks and under the decision's in-flight guard. First user: `agenda.vote` /
`agenda.preassign` pre-vote — `{outcome, planets[], allPlanets?, sources[]}` runs vote → outcome → exhaust planets →
done → confirm in one request. If a step fails, the error says where; the remaining prompts stay answerable.

### 3.5 Stream, versioning, consistency

* One global `seq` orders all events (`decision.opened|updated|closed`, `state.changed`). Registry listeners run
  under the registry lock, so the stream is strictly ordered.
* `GET /api/public/selfhost/engine/stream?after=<seq>[&game=]` (SSE, Bot token, `Last-Event-ID` honoured): backlog
  from a 5,000-event ring, then live, 15 s pings. If `after` fell out of the ring: a `reset` event → re-read
  `/state` + `/decisions`, continue from its `seq`.
* `stateVersion` on every decision and state snapshot. A client renders `state` and `decisions` from the same
  stream position; a decision whose `stateVersion` is older than the state just means "asked before the last save".
* Concurrency: per-decision in-flight guard + `expectedSeq` + the game's WRITE lock in `ButtonProcessor`.
  "Table" decisions accept one answer per player (the handler records each).
* **Reconnect / reload**: the server is the source of truth. A client (browser or bot) on reconnect fetches
  `/state` + `/decisions` (or resumes the stream with `after`) and renders. Nothing in the client needs to be
  remembered — reload-resilience falls out. Registry is in memory: after a **bot restart** it is empty until the
  engine re-asks. Mitigation (W-INFRA-1): on startup, rebuild open decisions by reading each live game's recent
  messages through JDA once (the shim still stores them), or have the bot re-post pending prompts.
* **Undo**: `GameUndoService` restores a snapshot and calls `GameWebStatePipeline.queue` → `state.changed` (new
  `stateVersion`); the re-posted saved buttons open new decisions; messages the undo deletes close theirs. Gap:
  prompts posted after the undone point that the undo does *not* delete stay open → W-INFRA-1 closes every decision
  with `createdAt` after the restored snapshot's time on undo (`UndoJournal` already knows the times).

### 3.6 Flags

Bot: engine on when self-hosted unless `TI4_ENGINE=off` (capture is passive; endpoints idle unless called).
Shim: `TI4_ENGINE=off` → no EngineClient; autopilot/web run purely on the legacy heuristics.

## 4. Where things are

| Piece | File |
|---|---|
| DTOs | bot `ti4/selfhost/engine/EngineModels.java` ⇄ `shim/src/engine/types.ts` |
| Capture | `ti4/selfhost/engine/DecisionCapture.java`, `InteractionTracker.java` |
| Kinds | `ti4/selfhost/engine/KindSpec.java`, `DecisionKinds.java` (classpath scan), `kinds/*.java` |
| Registry / stream | `DecisionRegistry.java`, `EngineController.java` |
| State | `StateSnapshotBuilder.java` |
| Actions | `ActionInvoker.java`; shim `Clients.mintComponentInteraction` + route in `rest.ts` |
| Hooks into upstream (3 lines) | `JdaService` (interceptor + listener), `GameWebStatePipeline.queue` (state changed) |
| Shim client | `shim/src/engine/client.ts` (`EngineClient`: state, decisions mirror, answer, SSE) |
| Bot policy | `shim/src/engine/autopilot.ts` (`chooseTyped`), wired in `autopilot.ts` `engineStep()` |

Endpoints:

| Route | Auth | Purpose |
|---|---|---|
| `GET /api/public/selfhost/engine/{g}/state[?viewer=uid]` | none (public view) / Bot (any viewer's hand) | GameState |
| `GET /api/public/selfhost/engine/{g}/decisions` | Bot | all open decisions `{seq, decisions}` |
| `POST /api/public/selfhost/engine/{g}/decisions/{id}/answer` | Bot (`userId` in body) | answer as a seat |
| `GET /api/public/selfhost/engine/stream?after=&game=` | Bot | SSE event stream |
| `GET /api/game/{g}/engine/state`, `/decisions`; `POST …/decisions/{id}/answer` | seat Bearer | own view only (private decisions of others hidden) |
| `POST /api/v10/selfhost/interactions` (shim) | Bot | mint interaction for an engine answer |

## 5. Bot repo workflow (parallel agents)

* engine-core history: d5311b3 core, 33513ce windows/progress/stable ids (`dynamicTarget` → `dynamic`).
* Work in your own git worktree of the bot: `git -C /home/user/asyncti4/ti4_map_generator_bot worktree add
  /home/user/asyncti4/<you> -b <you> engine-core` (branch **from `engine-core`**, which = upstream + patch 0001 as
  of ti4 `ebece94` + the engine core). Never edit the main checkout's index; other agents use it.
* Prefer new files under `ti4/selfhost/engine/kinds/` (auto-discovered — no shared registration file to conflict
  on). Touch upstream files only for one-line hooks, and say so in the commit.
* Build: `cd <your worktree> && flock /tmp/ti4-heavy.lock mvn -B -o -q -Dspotless.skip=true -Dmaven.test.skip=true
  compile` (JAVA_HOME=/home/user/tools/jdk-26.0.2+10). `package` only when you need a jar.
* Patch export (the deploy artifact): the **whole** diff from upstream, `git -C <worktree> diff $(cat
  <ti4>/bot/UPSTREAM_COMMIT) HEAD > <ti4 worktree>/bot/patches/0001-self-hosted-discord-shim.patch`. The integrator
  merges bot branches (git merge in the bot repo), then re-exports one patch.

## 6. How to add a decision kind (the per-area recipe)

1. **Find the prompt.** Grep the handler prefix in the bot (`@ButtonHandler("xyz_")`) and where its buttons are
   built (`Buttons.*("…xyz_"…)`). Note: owner prefix? which channel? what the id encodes.
2. **Java kind** — new file `ti4/selfhost/engine/kinds/<Area><Verb>Kind.java`, `public class … implements KindSpec`
   with a public no-arg constructor:
   * `kind()` → `"area.verb"` (e.g. `"combat.assign_hits"`); `priority()` (100 for "this message is about X",
     50 for options that also appear in mixed menus);
   * `matches(handlerId)` — exact regex on the handler id (custom id minus `FFCC_<f>_`/spoof/delete markers);
   * `value(handlerId, ctx)` → `Map` with **ids, not labels** (planet ids, unit async ids, tile positions, card ids,
     amounts). Resolve per-player handles to card ids via `ctx.player()`. Return `null` for options you don't type;
   * if the generic target is wrong or missing (`mention`/`none`), override `target(ctx, resolved)` using engine
     state (active player, speaker, combat participants…); set `dynamicTarget()` if it moves with state;
   * `scope(ctx)` → `"table"` for "everyone may answer" prompts; better, return a `window(ctx)` (§3.2.1);
   * multi-step prompt? return `progress(ctx)` (§3.2.2) and set `dynamic()`;
   * `validate(...)` for cheap pre-checks.
   * Compile. Nothing else to register. Add a case to an offline smoke test (see §9) with a recorded message JSON.
3. **TS type** — in `shim/src/engine/types.ts` add `export type X = DecisionBase<"area.verb", {…}>` mirroring your
   map exactly, and add it to the `Decision` union. (`tsc --noEmit` in shim; the web imports the same file.)
4. **Bot policy** — add a `case "area.verb"` to `chooseTyped` in `shim/src/engine/autopilot.ts` (pure function of
   decision + state). Return `null` when unsure → the legacy rule table still answers. Once the typed case is solid,
   delete the matching rule(s)/regexes from `autopilot.ts` / `botplay/*`.
5. **Web renderer** — add a renderer keyed by `decision.kind` that draws from `option.value` + `GameState` (never
   from labels/ids), answering via the engine (`POST /bot/api/game/{g}/engine/decisions/{id}/answer` with the seat
   token, or the `t:"engine"` ws op once W-INFRA-2 lands). Remove the matching detector in
   `web/src/decisions/detect` / `model/classify.ts`.
6. **Verify** in a game: `curl -H "Authorization: Bot $TOKEN" :8081/api/public/selfhost/engine/<g>/decisions | jq
   '.decisions[] | select(.kind=="area.verb")'` shows the right target and values; answer it with curl; check the
   engine log line `engine: N decision kinds: […]` lists yours.

## 7. Workstreams (≈6 h, 10+ agents) and phases

Every milestone leaves the game fully playable: typed paths are additive and fall back to legacy.

**Phase A — contract + plumbing (done in this branch).** State, capture, legacy kind for everything, 4 typed kinds,
answer path, SSE, shim client, autopilot uses engine for faction + SC pick / starting tech / setup SO discard.

**Phase B — areas in parallel (each: kinds + TS types + bot policy + web renderer, per §6):**

| WS | Area | Main prefixes to type (starting points) |
|---|---|---|
| G1 | Setup + draft | `milty_*` (add per-player picks to `DraftState`), `startDraftSystem`/new draft system, Keleres flavour, `getKeleresTechOptions`, starting units/home choices, `deal2SOToAll` flow |
| G2 | Strategy cards | `scPick_`, `queueScPick_`, `sc_follow_`/`sc_no_follow` (table), `strategicAction_`, per-card primaries (`sc_3_assign_speaker_to_`, Leadership CC, Diplomacy, Trade, Construction, Imperial) |
| G3 | Tactical action + movement | `tacticalAction`, activation tile choice, `move`/`unitTactical…`, `doneWithTacticalAction`, landing, `turnEnd`, `passForRound` |
| G4 | Combat | `combatRoll_`, `getDamageButtons`, `assignHits_`/`autoAssign…`, `sustain`, `retreat_`, AFB/bombard/space cannon windows |
| G5 | Production + payment | `produceUnit…`, `getPlanetExhaustButtons` → `spend`/`exhaust`/`reduceTG` (model payment as one typed decision: planets + tg + commodities) |
| G6 | Agenda | `resolvePreassignment_`, `queueAWhen`/`queueAnAfter`, voting (`planetOutcomes`, `vote…`), `proceedToVoting`, outcomes |
| G7 | Status + scoring | `po_scoring`/`score*`, `SO_SCORE_FROM_HAND`, `SO_NO_SCORING`, redistribute CCs, `run_status_cleanup`, end of round |
| G8 | Action cards + promissory notes | `ac_play_from_hand`, sabotage window (table), targets; PN play/resolve |
| G9 | Exploration + relics | explore choices, frontier, relic draws/uses, fragments |
| G10 | Thunder's Edge | expeditions, breakthroughs, TE-specific prompts |
| G11 | Trade / transactions | `transaction`, `send…`, `acceptOffer` (replace `TradeService` button scraping with typed decisions) |

**Infra workstreams:**

* **W-INFRA-1 Robustness**: rebuild registry after bot restart; close-on-undo; capture `with_response` callbacks
  everywhere; per-option `owner` for mixed menus; metrics (% of open decisions typed, % with `none` target).
* **W-INFRA-2 Stream to web**: shim fans `EngineEvent`s to browsers over the existing ws as `t:"engine"` frames
  (filtered by `EngineController.visibleTo` rules), `op:"answer"`; web `useEngine()` store (state + decisions from
  one stream); decision popup driven by `Decision` (legacy kind renders as generic buttons from options).
* **W-INFRA-3 Interaction abstraction** (enables true direct invocation and deletes JDA from the action path):
  introduce `ti4.selfhost.engine.Interaction` (game, player, channel/"reply to", message-buttons ops) and a
  `ButtonInteractionEvent` adapter; migrate the helper layer (`ButtonHelper.deleteMessage`, `MessageHelper.send…`)
  first — that covers most of the 2,931 channel / 2,519 delete uses without touching handlers; then make
  `ActionInvoker` construct the adapter directly (no shim mint). Selects + modals (typed `needsInput` with a
  schema) land here.
* **W-INFRA-4 Discord removal** (last): once web + bots read only engine state/decisions: drop shim message storage
  and gateway fan-out to browsers, web `decisions/detect`, `model/classify.ts`, `controls.ts` heuristics, autopilot
  rule table, `DraftButtonLocator`, `TradeService` button scraping; finally replace JDA REST with an in-process
  "message sink" (decisions only) so the shim's `/api/v10` emulation can go.
* **W-TEST**: golden tests per kind (capture a recorded message JSON → expected Decision), autopilot soak with
  `TI4_ENGINE` on/off, regression playtests (docs/PLAYTEST.md) every merge.

**Phase C** — infra 3/4 after areas are typed. Delete list at the end: `web/src/decisions/detect/*`,
`web/src/decisions/model/classify.ts`, `controls.ts` heuristics, `shim/src/autopilot.ts` RULES/AVOID tables and
faction inference, `shim/src/hub.ts` prompt attribution (`_prompted_for`, busy retry), `shim/src/gateway.ts`,
most of `rest.ts` and `store.ts` message storage, bot `DraftButtonLocator`, `DraftViewService` button parts,
`TradeService` button parts.

## 8. Risks

* **Synthesised events (phase 1)**: relies on JDA internals (`JDAImpl`, `ButtonInteractionImpl`) and the shim
  minting a valid payload. Pinned JDA 6.7.0; covered by one smoke test per deploy. W-INFRA-3 removes it.
* **Capture completeness**: a decision missed by capture just stays legacy-only (the old click path still works);
  never a stall. Wrong typing is worse than no typing → `value` only for ids we parse exactly.
* **Target resolution**: `owner_prefix` and `cards_thread` are certain; `mention` is weak by design — kinds must
  override where it matters. Mixed-owner menus need per-option owners (W-INFRA-1).
* **Racy reads**: capture reads `Game` from the REST thread while a handler may be mutating it; values are
  best-effort snapshots, validation happens again at answer time under the game lock.
* **Registry is in memory** (restart, undo gaps above).
* **Upstream bug found**: `ButtonHelper.resolveSpecialRex` was annotated `@ButtonHandler("buttonID.startsWith")`
  (unreachable; its buttons are `specialRex_…`). Fixed in engine-core.
* **Merge pressure**: 11 agents in the same bot tree → kinds are separate auto-discovered files; the 3 upstream
  hook lines live in engine-core only.

## 9. Verification status of the prototype

Compiles (bot `mvn compile`, shim `tsc --noEmit`). Offline smoke test (`EngineSmoke`: in-memory `Game`, recorded
message JSON → `DecisionCapture.build`, registry, snapshot; classpath = `target/classes` + the running jar's
`BOOT-INF/lib`) passes 18/18: kind scan, the four typed kinds, owner_prefix / cards_thread / mention resolution,
legacy table, open → edit-in-place (same id, revision 2) → close, ordered event log, hand only for the viewer.
**Not yet exercised against a running bot** (the action path needs JDA + shim):
first deploy should check, with `TI4_ENGINE` on: `/state` returns factions for a live game; `/decisions` lists the
SC-pick prompt with `target.resolvedBy=owner_prefix`; answering it via curl picks the card; autopilot log shows
`engine strategy_card.pick … -> done`. With `TI4_ENGINE=off` on both sides behaviour is exactly as before.
