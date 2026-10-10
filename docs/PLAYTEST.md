# Playtest sprint: make everything real

User feedback: "some of the map view style settings don't actually do anything… we just hit three bugs where
something is ported over from Discord and doesn't actually work. Play test the game against the autobots and do a
full round." Recent bugs of exactly this kind: a table-wide setup button nobody could press, the bot's generic
"player menu" shown as a decision popup, bots never choosing a starting technology (fixed in the working tree, not
yet committed when this sprint started).

Goal: a human can play complete rounds (strategy → action → status → agenda) against autopilot bots on a 14" laptop
(1512x982) using only the board-game UI, and every visible control does something real.

## Shared rules (every agent)

- Read docs/ARCHITECTURE.md, docs/UI_REDESIGN.md first. Stack: shim + prod web at http://127.0.0.1:8090 (bot behind it).
  Admin key: `python3 -c "import json;print(json.load(open('/home/user/run/shim-data/state.json'))['admin_token'])"`.
  Seats: GET /app/admin/players?key=…; a solo game: POST /app/solo-game {token, bots} or the Play solo button on /play.
  Existing e2e drivers: web/e2e/*.mjs (setup-flow.mjs reaches the strategy phase in ~60s). Chromium:
  /opt/pw-browsers/chromium with /opt/node-tools/node_modules/playwright-core.
- Own only your listed paths. Touch others' paths only for a 1–3 line fix you cannot avoid; say so in your report.
  `git pull --rebase origin claude/ecstatic-franklin-lutbck` often; commit your own paths every ~15 min
  (`git add <your paths>` — never `git add -A`) with trailers
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01CwHE3aeLi1SaFWJzFFZiKD`, then push (retry pull --rebase on reject).
- MEMORY IS SHARED AND TIGHT (15 GB, the bot uses ~4 GB, 8 agents run at once; overload restarts the whole machine):
  at most ONE Playwright browser open at a time per agent and close it when done; at most one Vite dev server per
  agent (unique port in 5300–5399), stopped when you finish; never run `npm run build` (only the integrator does);
  never run Docker. Check `free -g` before heavy steps.
- The shim/bot may restart under you (the integrator restarts the shim to load fixes). Retry, don't panic.
- Restart the shim yourself only if you own shim code and need your change live: /home/user/run/start-shim.sh.
- Never `pkill -f`/`pgrep -f` a pattern that appears in your own command line (it kills your shell).
- Judge like a TI4 player on a 14" laptop: is it obvious what to do, does every button do what it says, is anything
  a Discord leftover that does nothing here? Screenshot to /home/user/run/screenshots/playtest/<your-area>/ and LOOK.
- Final report: what you played, every bug found (fixed / not fixed + diagnosis), commits.

## LIVE PLAY, NOT ASYNC (user, emphatic)

"Remember, I'm NOT playing async here." Everyone sits at the table at the same time. Anything that exists because
Discord games run over days is noise here and must not reach the player: pings/nudges/"waiting on you" reminders,
auto-pass timers, "react within N hours" settings, time zones / active hours, end-of-round surveys, whispers via
private threads, "use /command", "check #channel", onboarding/help posts. Prefer instant, synchronous flows: show
what's happening now, who we're waiting on, and let reactions resolve immediately. New games should be created with
the bot's async features off (auto-ping 0 etc.).
