# Autopilot bots: roadmap

Decision (user, 2026-10-10): code-only bots for now; smarter (Claude-assisted) bots are a definite future direction.

## Now: code-only, in order
1. **Baseline play** (in progress): legal, never-stalling turns — play the strategy card, tactical actions that expand to
   nearby planets (move, land, explore, produce), pass; score objectives; vote; follow cards when cheap.
2. **Combat simulator**: exact win odds from both fleets (hits, sustain, AFB, PDS, defending planets) before any
   attack; attack only at clearly good odds; sensible retreats. Bombard before an invasion when it helps (today the
   autopilot never rolls bombardment: legal, but weak play).
3. **Objective-driven planner**: each round pick the cheapest reachable VP (public + secret), value strategy cards by
   need (Imperial with Mecatol, Technology for tech objectives, Leadership when short of tokens), plan tactical
   actions toward those objectives.
4. **Map and economy**: value planets (resources, influence, skips, legendaries), expand toward rich and lightly
   defended systems, guard home and choke points, place docks well, avoid overextending.
5. **Table play**: agenda votes by self-interest, cheap and useful follows, reasonable trade offers and replies.
6. **Draft and faction playbooks**: Milty slice evaluation; per-faction priorities (Hacan trades, Sol infantry, Jol-Nar
   tech, …).

## Later: Claude-assisted
Hybrid: code keeps legality and tactics (moves, combat odds); Claude makes the strategic call each turn (goal, threats,
votes, trades). The autopilot already has a hook (`ANTHROPIC_API_KEY`, `AUTOPILOT_MODEL` in shim/src/autopilot.ts) for
prompts no rule covers. Needs an API key in deploy/.env; cost is roughly a few dollars per game at 3–5 bots.
