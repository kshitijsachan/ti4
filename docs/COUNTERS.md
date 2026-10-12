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
| Combat amounts | `assignHits_*`, `autoAssign*Hits`, `hacanFlagship_*` (TG for dice), `exhaustHeartOfIxth_{plus,minus}`, `setForThalnos_`/`rollThalnos_`, `pay1tgToAnnounceARetreat`, bombardment, space cannon, `resolveChainReactionAt_N` | combat services | CombatBody | combat | See **Combat and units** below |
| Ships to move | `unitTacticalMove_<pos>_N_<unit>[_reverse]` (+1/+2 per unit type) | tactical action | UnitMoveRows / map ship picker | tactical | Theirs |
| Rift rolls | `riftUnit_*`, `riftAllUnits_*` | `RiftUnitsHelper` | riftStep | tactical | Theirs |
| Narrow Way infantry | `narrowWayMove_<pos>\|<holder>\|N` | `ButtonHelper` (TE) | generic | counters | Open — per-origin amounts; ids carry `\|`, not caught by the generic ladder |
| Async noise | `setAutoPassMedian_N`, `setHourAsAFK_N`, `UserSetPersonalPingIntervalToN` | preferences | filtered (`isNoise`) | — | Never shown |

## Combat and units

Code: `web/src/decisions/renderers/Combat.tsx` (the combat popup) and `web/src/decisions/renderers/combat/`
(`units.ts` unit rows, plans and the bot's id format; `rolls.ts` dice parser; `HitPanel.tsx` tiles with steppers;
`UnitPick.tsx` removals; `Retreat.tsx`; `Dice.tsx` dice rows; `Outcome.tsx` the end-of-fight card; `run.ts` the press
runner — same idea as `ui/pressPlan.ts`, kept separate because it was written before that landed; converge later).
Bot paths are under `src/main/java/ti4/`.

| Prompt | Bot ids | Where (bot) | UI now | Status |
|---|---|---|---|---|
| Assign N hits (space / ground / anti-fighter barrage / space cannon offence) | `autoAssignSpaceHits_<pos>_<n>`, `autoAssignGroundHits_<planet>_<n>` (`ids/AutoAssignGroundHitsButtonIds`), `autoAssignAFBHits_<pos>_<n>`, `autoAssignSpaceCannonOffenceHits_<pos>_<n>`; by hand `getDamageButtons_<pos>[deleteThis]_{spacecombat,groundcombat,afb,pds}`; `cancel{Space,Ground,AFB,PdsOffense}Hits_*` | `service/combat/CombatRollService`, `discord/.../combat/CombatButtonHandler`, `helpers/ButtonHelperModifyUnits.autoAssign*` | "Assign 4 hits": my units as tiles, **Sustain** / **Destroy** steppers, prefilled with the bot's own "would sustain / destroy" summary (else sustain first on units that can, then cheapest losses), "N left", one Confirm. Unchanged plan → presses Auto-assign; edited → opens the by-hand buttons and presses them in order, then Done | **Rebuilt, verified** pbd60 (AFB 2 → 2 fighters; space 4 → sustain 2 dreadnoughts + fighter + destroyer; ground 1 → infantry) |
| Per-unit sustain / destroy / remove ladder | `assignDamage_<pos>_1_<unit>[_<state>][_<planet>]_<color>`, `assignHits_<pos>_<n>_<unit>[_dmg][_<planet>]_<color>`, `assignHits_<pos>_{All,AllShips}`, `deleteButtons` ("Done Removing/Sustaining Units"); state `dmg`/`glv`/`dmg_glv` | `helpers/ButtonHelper.getButtonsForRemovingAllUnitsInSystem` / `buildAssignHitButton`, `handlers/unit/AssignHitsButtonHandlers` (each press edits the message; ids stay stable) | same tiles; ids are built in the bot's format so a unit damaged by this very plan can be destroyed (`_dmg`) | **Rebuilt, verified** |
| Fleet pool / capacity overflow | `getDamageButtons_<pos>_remove`, `deleteButtons` ("Dismiss These Buttons") | `helpers/ButtonHelper` fleet-supply / capacity checks | "Fleet pool exceeded — remove units": live overflow ("4 non-fighter ships, 3 fleet tokens — remove 1"), Remove steppers, minimum enforced; when it no longer overflows, just Dismiss | **Rebuilt, verified** (removed 1 cruiser) |
| Gravity rift losses, action-card / explore removals | `assignHits_*` remove ladders in the action log (`latestAssignHits` = `remove`) | `RiftUnitsHelper`, action cards | Remove panel (`UnitPick.tsx`, routed from `renderers/index.tsx` for any non-combat prompt with my unit-pick buttons) | **Rebuilt**; rift path not re-staged live (same buttons as above) |
| Roll a combat round | `combatRoll_<pos>_<space\|planet>`, `rollForAmbush_<pos>` | `StartCombatService.getCombatButtons`, `CombatRollService` | "Roll round N" (pressed on a plain roll prompt, never on my hit prompt, so the hits stay owed); round readout per side: dice as squares (hits filled) "→ N hits" | **Verified** (5 ground rounds) |
| Anti-fighter barrage / bombardment / space cannon rolls | `combatRoll_<pos>_space_afb`, `combatRoll_<pos>_space_bombardment[_deleteTheseButtons]`, `bombardConfirm_`, `assignBombardUnit_`/`unassignBombardUnit_`, `combatRoll_<pos>_space_spacecannonoffence`, `declinePDS_<tile>` | `StartCombatService.sendAFBButtonsToThread`, `getSpaceCannonButtons`, `handlers/combat/BombardmentButtonHandler` | readout rows "Anti-fighter barrage / Bombardment — 3 10 6 → 2 hits" in the combat popup and on the landing card | AFB and bombardment **verified**; space cannon offence and the multi-planet bombardment assignment ladder **not staged** (rolls still show in the readout; assign/unassign stay under More options) |
| Retreat | `announceARetreat`, `pay1tgToAnnounceARetreat`, `retreat_<pos>[_skilled]`, `retreatUnitsFrom_<from>_<to>[skilled]`, `retreatGroundUnits_<from>_<to>_<n>_<type>_<planet>`, `getRiftButtons_<pos>` | `handlers/combat/RetreatButtonHandler`, `ButtonHelperModifyUnits.getRetreatSystemButtons` / `getRetreatingGroundTroopsButtons` | "Announce a retreat" beside the roll; after the round "Retreat now"; destinations as named cards (legal only; hover lights the map; map click when ≥2); ground forces that go along as steppers | Announce + destination cards **verified**; the final destination press not completed (the opponent's ships vanished first, see shim bug) |
| Final outcome | — (bot leaves its buttons up) | — | "Victory / Defeat — Ground combat on Andeara, Bot Beta holds it" card with each side's losses, until closed (`Outcome.tsx`, mounted in `DecisionHost`) | **Verified** |
| Place N units from an ability | `placeOneNDone_<skipbuild\|dontskip>_<unit>_<planet>` (one unit per message, then the message goes) | `ButtonHelperModifyUnits.placeUnitAndDeleteButton`, `Helper.getPlanetPlaceUnitButtons` | a planet choice per unit — not a counter | Unchanged |
| Landing ground forces | `landUnits_<pos>_<n><unit>_<planet>_<color>`, `doneLanding_<pos>` | tactical | "Land 1 / Land 2 Infantry on X" ladder | **tactical** (map LandingPanel) — still a ladder in the popup when the map's landing UI is not active |

Known gaps: a Thalnos / War Funding reroll, Hacan flagship TG-for-dice and Heart of Ixth are still plain buttons under
More options; combat losses in the outcome card count the whole thread (space and ground).

## Notes

- Counters count what the game will actually do: the bot caps "gain 2" at the commodity limit and "convert 2" at the
  commodities you hold, so the commodity counters run 0 … cap and press `ceil(value / step)` times.
- The vote ladder only presses buttons that exist on the message (the bot's router reads the pressed button off the
  message), walking "Modify votes" / "Decrease" until the target is offered.
- Verification game: pbd62 (seat CounterAudit, Bastion). Screenshots in
  `/home/user/run/screenshots/playtest/counters/` (`c02`–`c20`). Prompts were staged with `/button spoof_id:` on a
  trigger button (e.g. `resolveFreeTrade`, `componentActionRes_getRelic_x`, `yinHeroPlanet_quinarra`) and real
  slash commands (`/game start_phase`, `/explore use`, `/ac draw_specific_ac` + `/ac play`).
