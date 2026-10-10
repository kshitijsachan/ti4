# Counters: quantities the bot asks as button ladders

The bot (AsyncTI4, Discord) asks for amounts the only way Discord allows: a ladder of buttons ("1 / 2 / 3 TG"), a
button pressed once per unit ("Gain 1 commodity" ×N, then "Done Resolving"), or a ±5 window ("Increase / Decrease
votes"). At a live table each of those should be **one panel with counters and one confirm**. This file is the
inventory (what exists, who owns it, where it stands) and documents the shared building block.

## Shared building block (use it — payment and command-token agents too)

`web/src/decisions/ui/Quantity.tsx` (+ `Quantity.module.css`)

- `<Quantity label value onChange min max allowed? unit? hint? disabledReason? maxReason? minReason? maxShortcut? icon? busy? dense? />`
  — a labelled −/+ counter seated in a trough. `allowed` restricts it to the amounts a bot ladder offers (−/+ jump
  between them); Shift-click goes to min/max; a "Max" shortcut appears when the range is wider than 2. The reason
  props print inline (yellow) when the row is off or pinned at a limit, so a disabled control always says why.
- `<QuantityTotal label value unit? detail? />` — the running total under a set of counters (mono numerals).
- `<QuantityConfirm label onConfirm disabledReason? busy? secondary? />` — the panel's one confirm, with its reason
  inline when it cannot be pressed; `secondary` holds quiet links (`<QuantityLink>`: Reset, Change outcome, …).
- `<RunProgress keyPrefix />`, `<RunError />`, `useRunning(prefix)`, `useAnyRunning()` — progress while the bot's
  buttons are being pressed ("Exhausting Revelation 1/3").

`web/src/decisions/ui/pressPlan.ts` — turns a target into the bot's presses:

- `usePressPlan()(key, steps, after?)` runs `PlanStep`s in order. Each step's `find(state, ctx)` runs **when the step
  comes up**, so it can press a prompt the bot posted in answer to the previous press (`waitMs` waits for it), and
  `repeat` re-runs a step while it still finds a button (walking a ladder). Each press waits for the bot to edit or
  delete the message, or post a newer one, before the next (a press on the heels of another can lose a change).
  It shares the strategy runner's store (`renderers/strategy/runner.ts`), so one multi-press flow runs at a time
  across every panel.
- Helpers: `pressOn(channel, message, label, idTest)`, `pressTimes(…, n)` (N presses of one button),
  `pressNext(channel, label, idTest)` (a button of the next prompt the bot posts), `newestPrompt`, `buttonOn`.
- Overlap: the payment agent's uncommitted `renderers/payment/sequence.ts` (`useLiveSequence`) is the same idea
  without `repeat`/`pressNext`; worth converging on one.

Panels live in `web/src/decisions/renderers/counters/` and register as step renderers (first match wins) from
`counters/index.tsx`, imported once by `decisions/index.ts`.

## Inventory

Owner: **counters** = this work; **payment** = payment/production agent; **tokens** = strategy-card agent (command
tokens, Leadership); **combat** = combat auditor (hits, removal, retreat, bombardment, space cannon); **trade** =
`web/src/trade`; **tactical** = map/tactical agents. "Generic" = shown raw by `GenericBody` before this work.
Bot paths are under `src/main/java/ti4/`.

| Prompt | Bot ids | Where (bot) | UI before | Owner | Status |
|---|---|---|---|---|---|
| Exhaust planets / abilities for votes | `exhaustForVotes_planet_<p>`, `_allPlanets_N`, `_zeal_N`, `_predictive_3`, `_augerscommander_N`, `_absolShard_N`, `_absolsyncretone_N`, `_dsghotg_N`, `_cryypterpi_4`; repeated `_hacanCommanderTg` (1 TG each), `_kyrocommanderInf` (1 infantry each); `proceedToFinalizingVote`, `resetMyVote` | `helpers/AgendaHelper.getPlanetButtonsVersion2`, `exhaustForVotes` | one press per planet (Agenda.tsx) | counters | **Rebuilt** `VoteExhaustBody`: planets as toggles with the bot's vote value, other sources as toggles, TG/infantry counters, "Adjust total", running total, one "Cast N votes" (exhaust → finalize → confirm/ladder). **Verified** pbd62 |
| Confirm / modify vote total | `resolveAgendaVote_N` (Confirm), `distinguished_N` (Modify/Increase), `distinguishedReverse_N` (Decrease); ladder of `resolveAgendaVote_x` five at a time | `AgendaHelper.proceedToFinalizingVote`, `getVoteButtonsVersion2`, `distinguished*` | number grid + "Increase/Decrease Votes" | counters | **Rebuilt** `VoteTotalBody` + `voteLadder` step (walks ±5 to the target, my faction's buttons only). **Verified** (bot count 2 → cast 5) |
| Vote / abstain, outcome choice | `vote`, `resolveAgendaVote_0`, `outcome_*`, `planetOutcomes_*` | `VoteButtonHandler.firstStepOfVoting` | Agenda.tsx | decisions | Not a counter; unchanged |
| Bribery / Distinguished Councilor amounts | `generic_button_id_2` ("No Bribery"), `distinguished_5` spent thing | `AgendaHelper` | generic | — | Bot does not automate the amount; use "Adjust total" in the vote panel |
| Gain / convert commodities, repeatable | `gainComms_1_stay`, `convertComms_1_stay`, `deleteButtons` | `ButtonHelperFactionSpecific.gainOrConvertCommButtons(false)` — Crimson Legionnaire (Mahact), Holding Company, Scrap Metal, yellow TF units | generic | counters | **Rebuilt** `CommodityBody`: gain and convert counters (bot caps at limit / stock, counters count real amounts), before → after readout, gains pressed before converts, then Done. Same renderer |
| Free Trade | `gain_2_comms_stay`, `convert_2_comms_stay`, `deleteButtons` | `ButtonHelperActionCards.resolveFreeTrade` | generic | counters | **Rebuilt** (`CommodityBody`). **Verified** (gain 1, convert 2: TG 5→7, comm 1→0) |
| One-shot gain or convert | `gainComms_1[_pos]`, `convertComms_1[_pos]`, `gain_N_comms`, `convert_N_comms`, `convertAllComms`, `mallice_*` | Necrophage, combat, DWS commander, explores, Mallice | generic | — | A single choice, not a counter; unchanged |
| Purge fragments for a relic | `purge_Frags_{CRF,IRF,HRF,URF}_N`, `purgeSupermassiveFrag_*`, `drawRelicFromFrag` | `ComponentActionHelper` (`getRelic`), `PromissoryNoteHelper` (Black Market Forgery) | ladder per trait | counters | **Rebuilt** `FragmentBody`: counter per trait limited to the offered counts, rule check (one type, frontier wild, 2 with Fabrication), one "Purge 3 and draw a relic". **Verified** (2 cultural + 1 frontier → relic drawn, crf3 left) |
| Purge fragments for a tech discount | `purge_Frags_*_N` without `drawRelicFromFrag` | `service/tech/PlayerTechService` (Iconoclasm) | generic | payment | Open — belongs with tech payment |
| Trade goods on strategy cards | `increaseTGonSC_N` (+1 per press), `deleteButtons` | `ActionCardHelper.serveManipulateInvestmentButtons` (Manipulate Investments) | 8 buttons pressed repeatedly | counters | **Rebuilt** `ScTradeGoodBody`: two-column counters, rule (5 total, ≥3 cards), one confirm. **Verified** (2/2/1) |
| Choose-N ladders | numbered buttons sharing an id prefix, label states the number: `yinHeroInfantry_<p>_N`, `combatDroneConvert_N`, `resolveMirvedaCommander_N`, `florzenBTStep3_<f>_N`, `deorbitBarrageResource_<p>_N`, `lanefirATS_N`, `theSowingAddTg_N`, `bidInfluence_N`, `bidResource_N` | Yin hero, DS/TE/homebrew abilities, scenarios | generic | counters | **Rebuilt** `LadderBody` (generic, `kind === "generic"` only, ≥3 rungs; ring/stage/position ladders excluded). **Verified** with Yin hero (landed 2) |
| Pay / erase debt | `sendTGTo_<f>_{comm,comm3,tg,tg3,debt,debt3}` | `AgendaHelper.pingAboutDebt` | generic | counters | Open — rare (debt tokens); a TG/commodity counter per creditor would fit |
| Transactions (send N TG / commodities / fragments / SOs) | `send_TGs_<f>_N`, `send_Comms_<f>_N`, `send_ClearDebt_*`, `send_SendDebt_*`, `_CRF/_HRF/_URF` ladders | `helpers/TransactionHelper` | hidden (`transaction` is dead here) | trade | Done by the Trade drawer (steppers over its own API) |
| Payment | `spend_*`, `reduceTG_N_*`, `reduceComm_N_*`, `resetSpend_*` | `helpers/ButtonHelper`, spending handlers | SpendBody | payment | Theirs |
| Production | `tacticalActionBuild_*`, `place_*`, "Produce X" repeats, `deleteButtons_tacticalAction` | build services | TacticalBody | payment | Theirs |
| Command tokens | `increase_{tactic,fleet,strategy}_cc`, `decrease_*_cc`, `resetCCs`, `gain_CC`, `lose1CC`, `loseAFleetCultural`, `gainCCNoDelete`, Leadership spend | `ButtonHelper`, status phase, Leadership | Tokens.tsx / Leadership.tsx | tokens | Theirs (rebuilt) |
| Combat amounts | `assignHits_*`, `autoAssign*Hits`, `hacanFlagship_*` (TG for dice), `exhaustHeartOfIxth_{plus,minus}`, `setForThalnos_`/`rollThalnos_`, `pay1tgToAnnounceARetreat`, bombardment, space cannon, `resolveChainReactionAt_N` | combat services | CombatBody | combat | Theirs |
| Ships to move | `unitTacticalMove_<pos>_N_<unit>[_reverse]` (+1/+2 per unit type) | tactical action | UnitMoveRows / map ship picker | tactical | Theirs |
| Rift rolls | `riftUnit_*`, `riftAllUnits_*` | `RiftUnitsHelper` | riftStep | tactical | Theirs |
| Narrow Way infantry | `narrowWayMove_<pos>\|<holder>\|N` | `ButtonHelper` (TE) | generic | counters | Open — per-origin amounts; ids carry `\|`, not caught by the generic ladder |
| Async noise | `setAutoPassMedian_N`, `setHourAsAFK_N`, `UserSetPersonalPingIntervalToN` | preferences | filtered (`isNoise`) | — | Never shown |

## Notes

- Counters count what the game will actually do: the bot caps "gain 2" at the commodity limit and "convert 2" at the
  commodities you hold, so the commodity counters run 0 … cap and press `ceil(value / step)` times.
- The vote ladder only presses buttons that exist on the message (the bot's router reads the pressed button off the
  message), walking "Modify votes" / "Decrease" until the target is offered.
- Verification game: pbd62 (seat CounterAudit, Bastion). Screenshots in
  `/home/user/run/screenshots/playtest/counters/` (`c02`–`c20`). Prompts were staged with `/button spoof_id:` on a
  trigger button (e.g. `resolveFreeTrade`, `componentActionRes_getRelic_x`, `yinHeroPlanet_quinarra`) and real
  slash commands (`/game start_phase`, `/explore use`, `/ac draw_specific_ac` + `/ac play`).
