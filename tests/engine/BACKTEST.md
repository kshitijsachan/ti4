# Backtest v2 — engine answers vs the original code

Two tools compare the typed engine (docs/ENGINE.md) against the **original** button code, which is ground truth:

* `replay.mjs --via engine` — real recorded games: each recorded press is re-done as an engine *answer* on the
  recorded save before it, and the result is diffed against the recorded save after it.
* `scenario.mjs --diff` — a situation you build (base save + setup commands), run twice: legacy presses on fork A,
  engine answers on fork B; saves diffed after every step, invariants checked after every step.

All commands run from the repo root (needs `shim/node_modules` for `tsc`; node 22 runs the `.ts` libs directly).
Stack: bot `127.0.0.1:8081`, shim `127.0.0.1:8090` (shared — never restart it). Bot token comes from
`/home/user/run/bot.env` (or `$BOT_TOKEN`). Reports land in `/home/user/run/engine/reports/`.

## 1. Find material: `find.mjs`

```sh
node tests/engine/find.mjs <regex> [--in pbd75,pbd113] [--state] [--replayable] [--names] [--limit 40] [--json]
node tests/engine/find.mjs "Sabotage"            # card names resolve to ids via the bot data (sabo1..4, …)
node tests/engine/find.mjs "_scPick_|getTech_"   # handler / custom id prefixes
node tests/engine/find.mjs "Gravity Drive" --state   # also saves where a matching line appears (card in hand, tech, stored value)
```
Matches custom ids, button labels, `latest_command` labels and slash commands of every recording in
`tests/engine/recordings/` (~60 games: soak, fuzz, solo, integrator games). Each hit prints the exact replay command
for that step. `[not replayable]` = selection/modal/system save (no press to redo); `[dice]` = expect `dice`.

## 2. Replay recorded presses through the engine

```sh
node tests/engine/replay.mjs tests/engine/recordings/pbd72.json --via engine --no-web --from 735 --to 765 [--fork pbdN] [--quiet]
```
Step *k*: load recorded save *k-1* into the fork with the pressed button re-posted (the bot's own saved-button
re-post), wait for the engine to capture that prompt (decision id = `d<message id>`), find the option for the
recorded custom id, `POST …/decisions/{id}/answer` as the presser's replay seat, diff the fork's save with recorded
save *k*. `--from A --to B` replays steps A+1..B (from = the save to start on). `--answer-legacy` also answers
untyped decisions through the engine. Without `--fork` a fork is created (~10–100 s): **reuse one** (`--fork pbdN`,
printed at the start).

Per-step status:

| status | meaning |
|---|---|
| `match` / `reordered` | engine answer produced the recorded save (reordered = same items, other order) |
| `diverged` | typed engine answer ≠ original code's result → **engine bug** (diff keys printed) |
| `refused` | the engine refused an answer the original accepted (403/409/validate) → **bug** (or target resolution) |
| `dice` / `random` | differs but dice/shuffle involved (unseeded RNG) — not a bug by itself |
| `not_typed` | no typed decision carries the button (kind `legacy` or none): pressed like the original; `{legacy→match}` shows that outcome |
| `skipped` / `error` | not replayable (selection, modal, system save) / harness problem (e.g. `rewind -> 401/503` while the bot restarts: rerun) |

Summary line: `engine: typed X/Y (Z%); typed match …, MISMATCH n, REFUSED n` plus `by kind`, each mismatch/refusal
with its diff keys / error, and `top untyped` handler prefixes (= what to type next). Exit code 1 on any mismatch or
refusal. Full JSON report: `reports/<game>-step-engine.json` (`results[].engine` has decision, kind, option, path,
answerStatus, error).

## 3. Scenarios: `scenario.mjs`

```sh
node tests/engine/scenario.mjs --list
node tests/engine/scenario.mjs --commands "^ac |^tech add|add_units"   # bot slash commands + option names/types
node tests/engine/scenario.mjs sc-pick-warfare --diff [--forks pbdA,pbdB] [--quiet]
node tests/engine/scenario.mjs my.json            # single fork, engine answers (--via press: button presses)
```
File `tests/engine/scenarios/<name>.json` (or `.mjs` exporting the object):
```json
{
  "name": "sc-pick-warfare",
  "description": "…",
  "base": { "recording": "pbd75", "index": 46 },
  "setup": ["/tech add tech:gd faction_or_color:deepwrought",
            { "command": "ac draw_specific_ac", "options": { "ac_id": "sabo1", "faction_or_color": "deepwrought" } }],
  "trigger": { "press": "FFCC_deepwrought_scPick_6", "as": "deepwrought" },
  "steps": [
    { "answer": { "kind": "strategy_card.pick", "value": { "strategyCard": 6 } }, "as": "deepwrought" },
    { "answer": { "kind": "tech.gain", "option": "getTech_gd" }, "as": "seat2" },
    { "answer": { "kind": "payment.spend", "payload": { "planets": ["mr"] } }, "as": "argent",
      "legacy": [ { "press": "spend_mr" }, { "press": "deleteButtons" } ] },
    { "command": "/game start_phase specific_phase:status" },
    { "wait": 1000 }
  ],
  "expect": {
    "invariants": true,
    "state": [ { "path": "players[faction=deepwrought].techs", "includes": "gd" } ],
    "save":  [ { "key": "game.phase_of_game", "eq": "action" } ],
    "decision": { "kind": "strategy_card.pick", "as": "argent", "open": true }
  }
}
```
* **base**: `{recording, index}` (a save of a recording; `find.mjs` gives indexes) · `{game, index?}` (any game's undo
  save on disk, e.g. a soak game; no index = live save) · `{save: path}` · `"fresh6p"` (first round-1 action-phase
  save of a recorded 6-player TE game). By default the prompt that was on screen at that save (the next save's
  `saved_buttons`) is re-posted so the next decision is open; `"repost": false` in base disables it.
* **setup**: slash commands (string form `"/cmd sub opt:value opt:\"two words\""` or `{command, options, as}`),
  run identically on both forks. Useful: `/ac draw_specific_ac`, `/tech add`, `/add_units`, `/remove_units`,
  `/move_units`, `/player cc|send_tg|sc_pick|turn_start`, `/game start_phase`, `/so draw_specific_so`, `/relic draw_specific`,
  `/explore …`, `/agenda reveal_specific`, `/leaders unlock`, `/pn send` (see `--commands`).
* **trigger/steps**: `press` (a custom id: engine side answers the decision carrying it, legacy side clicks the
  message carrying it; if none is on screen the fork is reloaded with that button re-posted) · `answer` {kind (exact
  or `"/regex/"`), and `option` (regex on option id/label) or `value` (partial match on the typed value) or
  `payload` / `values` / `inputs` / `action`+`body` (engine only — give a `legacy: [...]` list of presses for the
  legacy fork)} · `command` · `wait`. `as`: `seat1..8`, a faction, a colour or a user id (default seat1). Strings may
  use `${seat1}`, `${faction:xxcha}`, `${color:red}`, `${fork}`.
* **expect** (checked on every fork at the end): `invariants` (lib/invariants.ts, run after every step anyway),
  `state` paths into engine `GameState` (`a.b[key=value][0]`) with `eq/ne/gte/lte/includes/excludes/match/exists`,
  `save` keys of the normalized save (`game.<key>`, `player[<faction>].<key>`, `tile <pos>: …`), `decision` open/closed.

Output per step: `legacy:ok(1 saves) engine:ok(1 saves) same|DIFF n` and the differing keys. `--diff` failure =
the engine's result differs from the legacy result (legacy is right unless proven otherwise). Report:
`reports/scenario-<name>[-diff].json`.

## 4. Reading results

* `diverged`/`DIFF` on a typed kind: look at the keys; rerun just that step (`--from k-1 --to k`) and compare with
  `--via press` on the same range — if press also diverges it is a fork/determinism issue, not the engine.
* `refused`: the error says why (`403 not target` → target resolution of that prompt; `409 stale/busy`; validate
  message → the kind's validation is stricter than the original code).
* `not_typed` with `{legacy→diverged}`: harness/determinism issue on the legacy path, not an engine finding.
* `error rewind -> 401/503`: the bot was restarting; rerun the range.

## 5. Resource rules (the bot is shared by ~40 agents)

* **≤ 2 concurrent replays/scenarios per agent.** Each step reloads a save and waits for the bot (~3–10 s/step).
* **Keep runs short**: replay ranges of ≤ 30 steps (`--from/--to`), use `find.mjs` to target steps; no full-game
  replays unless asked.
* **Reuse forks**: create once, then always pass `--fork pbdN` / `--forks pbdA,pbdB`. Never run two runs on the same
  fork at the same time (they overwrite each other's state).
* **Clean up**: when done, end your forks — `/game end` from the fork's actions channel is what a person would do;
  simplest: tell your caller the fork names so they can be reused, and do not leave runs in the background.
* Never restart the bot/shim; if it restarts under you the harness waits and retries once.
