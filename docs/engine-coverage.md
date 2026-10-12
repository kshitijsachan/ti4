# Engine coverage: what is still legacy, who types it, and what gets deleted

Coverage lead report, 2026-10-11 ~22:00 UTC. Measured against bot **e4f2455** (live `bot-override.jar`) and ti4 main
**a0ced00**. This was read-only: no code changed and no service restarted. The replay tooling is in
`/home/user/run/coverage-tools/` (README.txt), so a workstream can re-run the same numbers on its own branch.

## 0. Summary

| Measure | Source | Decisions | Legacy | Legacy share |
|---|---|---|---|---|
| Live open decisions | bot `/engine/{g}/decisions`, 117 live games (no homebrew game had open prompts) | 5,258 | 1,934 | **36.8 %** |
| Stored prompts (every bot message with components still in the shim store) | 15,594 messages in 112 non-homebrew games → 4,994 info menus, 10,324 decisions | 10,324 | 1,597 | **15.5 %** |
| Presses (undo journal `latest_command`, 4,178 button presses in non-homebrew games) | handler matched by some kind | 4,178 | 43 | **1.0 %** |
| Catalogue (2,671 button handlers) | in-scope saving handlers not matched by any kind (see §2) | — | **~712** | — |

How to read these numbers:

* **Live is higher than stored** because live counts prompts that a kind types but `obsolete()` turns back into
  legacy: `queueMilyPick_` (513), `queueScPick_`/`restartSCQueue` (108), `startPlayerSetup` (220),
  `sandbagPref_` (84), `playerPrefDecision_` (33) and the setup menus (`chooseExp_`, `jmfA_`, `offerGameOptionButtons`:
  23 each). The offline replay (`CovClassify`) does not run `obsolete()`.
* **Presses are almost all typed** because the bots and the scripted humans only press what their policies know.
  The legacy prompts that remain are the ones nobody answers. They sit on screen as perpetual, optional or undo
  affordances, and the faction/leader/card tail never comes up in bot-only games.
* So 100 % has two parts. **(a) The perpetual/optional/undo prompts** are about 85 % of live legacy, come from
  about 25 prefixes, and are cheap to fix: give them a kind or make them non-decisions. **(b) The long tail** is
  about 700 handlers that soak games rarely or never reach (faction abilities, leaders, TE breakthroughs, relics,
  action-card and promissory-note steps). Without them a human game in the web UI still falls back to legacy.

Top legacy prompts in real games (live open + stored; examples are `game/messageId`):

| Prefix | Live | Stored | Example prompt | Fix (workstream) |
|---|---|---|---|---|
| `drawSpecificSO_` | 264 | 404 | pbd19/1558510215748517888 "You discarded the secret objective … If this was an accident" [Retrieve … \| Delete These Buttons] | undo affordance → `secret_objective.retrieve` (optional, non-blocking) or info (c8) |
| `queueMilyPick_` | 513 | — | pbd19/1558508257763524608 "You can queue your choices" | close or delete the prompt when the draft ends (the kind is obsolete then) (c8) |
| `editRoundSummary_` / `editEndOfRoundSummaries` | 177+15 | 295+19 | pbd19/1558535922797117440 "you may write down your end of round thoughts" | non-decision (INFO_COMPANIONS already lists it; it fails because it is alone on the message) (c8) |
| `removePreset_` | 131 | 226 | pbd21/1558537730575695872 "you may use this button to undo the preset" | undo affordance on `agenda.preassign`/`action_card.preassign` (`progress`) (c8) |
| `startPlayerSetup` | 220 | — | pbd19/1558508145251319808 "you may use this button instead of /player setup" | obsolete after setup → delete the prompt (c8) |
| `queueScPick_` + `restartSCQueue` | 107 | — | pbd23/1558510231150002176 "you are #2 pick … can queue 2" | already `strategy_card.queue_pick`; obsolete outside strategy → delete the prompt (c8) |
| `sandbagPref_`, `playerPrefDecision_`, `setAutoPassMedian_`, `setOptIn*`, `temporaryPingDisable` | 84+33+8+4+9 | 74+22 | pbd19/1558512050131566592 "the bot could auto pass on scoring secrets…" | `player.preference` (private, non-blocking), or suppress when self-hosted (c8) |
| `eraseMyVote`, agenda help menu (`proceedToVoting`, `refreshAgenda`, `pingNonresponders`, `eraseMyRiders`, `transaction`) | 56+12 | 94+49 | pbd21/1558609376258949120 "press this button to revote" | `agenda.vote` progress + one `agenda.revote` option; help menu → info (c8) |
| `retrieveAgenda_` | 46 | 71 | pbd19/1558608924649848832 "Put Covert Legislation on top… use this button to undo" | undo affordance (c8) |
| Info menu with action shortcuts (`cardsInfo`… + `exhaustAgent_` / `getAgentSelection_` / `getToggleGalvanizeTiles` / `startTradeStationConvert` / `useLawsOrder`) | ~65 | ~67 | pbd26/1558511383262396416 "You may use these buttons to do various things:" | `isInfoMenu` fails as soon as one shortcut is present. Split: menu = info; each shortcut → its kind (`leader.use`, `te.galvanize`, …) (c8 + c5/c6) |
| `preScoreObbie_` / `reversepreScoreObbie_` | 32 | 59+2 | pbd23/1558511263854755840 "queue a public objective to score" | `status.score` decide-in-advance (c8) |
| `exhaustAgent_` (agent target pick) | 25 | 54 | pbd27/1558512607839780864 "please choose the target of your agent" [Titans \| Winnu \| Naaz] | `leader.use` target step (c6) |
| `getDamageButtons_` (fleet-pool violation) | 13 | 70 | pbd19/1558618163908837376 "you are violating fleet pool limits…" | G4 open issue 7: extend `combat.hits` or add `units.remove_excess` (c8) |
| `useNaaluAgent_` | 14 | 17 | pbd58/1558608452090200064 "You may use Z'eu…" | `leader.use` (c5) |
| `addFactionTokenToPlot_` / `removeFactionTokenFromPlot_` / `scoreOtherPlayersSecrets` (Firmament/Obsidian plots) | 1 | 33 | pbd59/1558610399098699777 "Plot Cards: …" | `te.plot` (c5) |
| `reveal_stage_` | 15 | — | pbd21/1558608924033286144 "Flip the relevant public objective" | `status.reveal_objective` (check why it is obsolete) (c8) |
| `resetSpend_` (+`useTech_`) | 8 | 13+2 | pbd56/1558615122392514560 "exhausted the following … total spend" | `payment.spend` should classify the summary message (c8) |
| `rollForAmbush_` | 7 | 8 | pbd60/1558607464495185920 "start of space combat abilities" [Ambush] | `combat.ability` window (c2, Mentak) |
| Trade builder (`transactWith_`, `newTransact_`, `getNewTransaction_`, `resetOffer_`, `sendOffer_`, `offerToTransact_`) | 4 | 30 | pbd114/1558952041349513216 "choose which player you wish to transact with" | the `trade.propose` direct action already exists. The legacy builder prompt should not be posted to web seats, or should be `trade.builder` (c8) |
| `draftPresetKeleres_` | 7 | — | pbd27/1558512354059223040 "Pre-select which flavor of Keleres" | `setup.keleres_flavor` (G1) should claim it (c8) |
| `useMagenDefense_`, `useLawsOrder`, `crashLandingStart`, `acquireATech`, `convert_/gain_N_comms`, `genericModify*`/`genericBuild_`, `jolNarAgentRemoval_`, `mitosis*`, `saarMechRes_`, `nekroStealTech_`, `startArbiter`, `enableDaneMode_`, `deal2SOToAll` | 1–6 each | 1–6 each | see the appendix | owner per the appendix |

Untyped handlers that were pressed (undo journal, non-homebrew): `jwds_` 15, `increaseTGonSC_` 5, `placeOneNDone_` 4,
`gain_1_comms` 3, `constructionBuild_` 2, `liberate_` 2, plus single presses of `engineStatusTokens_`,
`convert_2_comms(_stay)`, `gain_2_comms_stay`, `applytempcombatmod__action_cards__`, `beginTacticalTeWarfare`,
`startDraftSystem`, `acquireATech`, `planetAbilityExhaust_`, `componentActionRes_` (relic), `yinHeroPlanet_`,
`yinHeroInfantry_`. That is 43 of 4,178 presses.

**Collision found while measuring (act on it now).** The faction worktrees are writing the same new files:
`kinds/FactionAbilityKind.java` exists in c1, c3 and c4, and c3's declares `kind() = "faction.ability"`.
`kinds/LeaderUseKind.java`, `FactionSteps.java` and `FactionStepsLeaders.java` exist in c1 and c4. These give
duplicate class names, merge conflicts, and two specs claiming one kind. Proposal:

* One owner (c1) keeps the generic `FactionAbilityKind` (`faction.ability`) and `LeaderUseKind` (`leader.use`).
  These look rules up from a registry.
* Every other workstream adds only `FactionAbilityRules<Group>.java` / `LeaderRules<Group>.java` tables. c3 already
  does this with `FactionAbilityRulesGroupC`.

## 1. Measured legacy share: method and full data

* **Classifier.** `CovClassify` (coverage-tools) runs the deployed jar's own `DecisionCapture.isInfoMenu` +
  `DecisionKinds.classify` on every stored message: 75 kinds, 2,672 routes. It is the same rule as live capture,
  minus `obsolete()` and target resolution.
* **What counts as a decision.** Same as engine-int:
  * An info menu is not a decision. Every option is either read-only (`@ButtonHandler(save=false)`), or
    `getModifyTiles`/`purgeOverrule`, or one of INFO_COMPANIONS (`deleteButtons`, `editRoundSummary_`,
    `editEndOfRoundSummaries`, `startPlayerSetup`, `removePreset_`) sitting next to a read-only option.
  * Homebrew games are excluded: pbd5, pbd93, pbd106 and pbd111 (`homebrew_mode`/`homebrew_sc_mode`/monuments/TF).
    pbd109 (Thunder's Edge galactic events only) is kept.
* **Distinct legacy routes in stored messages: 64.** In descending order, with the number of messages:
  drawSpecificSO_ 404, editRoundSummary_ 295, removePreset_ 226, eraseMyVote 143, transaction 116,
  setOptInSinglePreference_/setOptInStats_ 74, getDamageButtons_ 73, retrieveAgenda_ 71, info-menu members
  (getModifyTiles, offerPlayerPref, searchMyGames, showObjInfo_, chooseMapView, refreshInfoButtons, notepadPost,
  notepadEdit~MDL, cardsInfo) 67, preScoreObbie_ 59, exhaustAgent_ 54, proceedToVoting/eraseMyRiders/refreshAgenda/
  pingNonresponders 49, getToggleGalvanizeTiles 38, temporaryPingDisable 22, editEndOfRoundSummaries 19,
  addFactionTokenToPlot_/scoreOtherPlayersSecrets 19, startTradeStationConvert 17, useNaaluAgent_ 17, resetSpend_ 15,
  getAgentSelection_ 14, removeFactionTokenFromPlot_ 14, deleteButtons-only 11, transactWith_ 10, rollForAmbush_ 8,
  useMagenDefense_ 6, newTransact_/resetOffer_/getNewTransaction_/sendOffer_ 6, jwds_ 4, redistributeCCButtons 4,
  mitosisInf/mitosisMech 4, useLawsOrder 3, acquireATech 3, genericModify_/modifyUnitsAllTiles/
  genericModifyAllTiles_/genericBuild_ 3, wrongButtonEphemeral_ 2, reversepreScoreObbie_ 2, nekroStealTech_ 2,
  automateGroundCombat_ 2, useTech_ 2, convert_2_comms/gain_2_comms 2, offerToTransact_ 2, startArbiter 1,
  enableDaneMode_ 1, saarMechRes_ 1, jolNarAgentRemoval_ 1.
* **Live, grouped by message signature** (live.out): the table in §0 lists every group with at least 2 open
  decisions. The singletons are `restartSCQueue`, `deal2SOToAll`, `setupStep1_`/`setupStep2_` (pbd108 manual setup),
  `convert_`+`gain_` (Abandoned Warehouses), `crashLandingStart`, `jolNarAgentRemoval_` and two trade builders.

## 2. Workstreams (mapped onto the running c1–c11)

**Scope.** The catalogue has 2,671 button handlers. Of those:

* 915 are `save=true`, tagged base/core/pok/thunders-edge, and matched by no kind (each tested on ids synthesised
  from its creation-site grammar; 2 false negatives, `strategicAction_` and `rider_`, corrected by hand). These are
  the in-scope candidates measured here.
* 75 more are removed: admin/testbed/Jimbo, Twilight's Fall edicts and resolvers (`Tf*`, `Tk*`), Monuments, Ignis,
  Absol X-89, O++, homebrew relics, Franken, FoW options, `StartScenario`, Dacxive.
* 128 more are removed because they are Discordant Stars / Blue Reverie / other homebrew faction handlers that live
  in core files. The catalogue tags them "core"; faction attribution comes from the bot's `data/factions` (source)
  plus a nickname table.

That leaves **~712 handlers**.

Bucket assignment is by owning class and faction. Kinds are new auto-discovered files, so files only overlap where a
handler is edited upstream. That is c9's job (§3); everyone else should only add `kinds/*`, `shim/src/engine/policy/<area>.ts`
and `web/src/engine/renderers/<area>/`.

The full prefix lists per bucket are in the appendix. Marks: **(n)** = seen n times in real games;
ᵀ = reads label or message text (§3); ᴹ = edits in place / multi-step.

| WS | Scope | Handlers | Seen in games | Multi-step | Text state | Kind(s) to extend / add | Difficulty |
|---|---|---|---|---|---|---|---|
| **c1** base factions A (Arborec, Creuss/ghost, Hacan, Jol-Nar, L1Z1X, Letnev) | ButtonHelperFactionSpecific/Abilities/Agents/Heroes/Commanders + `handlers/faction/base/*` entries naming the faction | 20 (+ its share of the 148 unattributed) | jolNarAgentRemoval_ (1), mitosis* (4) | 2 | 0 | **owns** `faction.ability` (generic `{source, step, refs{planet,tile,unit,player,card}}`) and `leader.use` `{leader, step, target}`. Others register rule tables | moderate; L1Z1X `assimilate_`, Arborec `mitosis*`/agent `arboAgent*`, Jol-Nar hero `jnHeroSwapOut_` are 2–3-step |
| **c2** base factions B (Mentak, Muaat, Naalu, Nekro, Saar, Sardakk) | same | 17 (+ share) | rollForAmbush_ (15), nekroStealTech_ (2), saarMechRes_ (1) | 6 | 0 | `faction.ability` rules; Ambush/Pillage = `combat.ability` window on `combat.round` | `rollForAmbush_` is a start-of-combat window. `starforge*`, `pillage_`/`declinePillage_` (cross-player consent), `nekroStealTech_`/`offerNecrophage`/`nekroAgentRes_` |
| **c3** base factions C (Sol, Winnu, Xxcha, Yin, Yssaril) | same | 27 (+ share) | yinHero* (2) | 7 | 2 (`yssarilHeroInitialOffering_` label, `yinagent_` text) | `faction.ability`, `leader.use` | Yin hero multi-step (`yinHeroStart`→`yinHeroTarget_`→`yinHeroPlanet_`→`yinHeroInfantry_`); Yssaril hero is an offering *to another player* (target = recipient) |
| **c1–c3 unattributed** | ability/PN/tech steps whose prefix names no faction: e.g. `starforge*`, `pillage_`, `assimilate_`, `mitosis*`, `indoctrinate_`/`initialIndoctrination_`, `greyfire_`, `raghsCall*`, `reflect*`, `stymie*`, `setTrap*`/`revealTrap*`/`removeTrap*` (DS Lizho → homebrew), `mercenaries*`/`rallyTheHorde*`/`meteorSlings_`/`contagion_`/`facsimile*`/`warStories*` (DS → homebrew), `exhaustAgent_`, `purgeTech_` | — | 148 | exhaustAgent_ (79), scoreOtherPlayersSecrets (20), rollForAmbush_ (15) | 26 | 2 | `faction.ability` rules; `exhaustAgent_` → `leader.use` (c6 generic) | **Triage needed:** about a third are DS/TF names the catalogue tags core (see appendix). The c1–c3 leads should split this list by owning faction on day one |
| **c4** PoK factions (Argent, Cabal, Empyrean, Mahact, Naaz, Nomad, Titans) | same + `faction/pok/*` | 18 | — | 4 | 0 | `faction.ability`, `leader.use`; Cabal capture = `combat.capture` | Mahact `mahactCommander`/`placeHolderOfConInSystem_`, Cabal `startCabalAgent_`/`getReleaseButtons`/`startVortexerRevive`, Titans `titansCommanderUsage` |
| **c5** TE factions + TE systems (Bastion, Deepwrought, Firmament/Obsidian, Crimson, Ral Nel, Keleres) + breakthroughs, plots, galvanize, breaches, void tether, Thunder's Edge relics/techs | `helpers/thundersedge/*` (minus ACs/PNs), `service/breakthrough/*`, PlotCardsService, Galvanize/Emelpar/VoidTether/Deepgloom/ResonanceGenerator/… | 115 | getToggleGalvanizeTiles (78), addFactionTokenToPlot_ (20), useNaaluAgent_ (31), removeFactionTokenFromPlot_ (14), useLawsOrder (6), useMagenDefense_ (6), liberate_ (2) | 25 | 2 (`addNekroToken_`/`removeNekroToken_` text) | extend `te.*` (G10): new `te.breakthrough` `{breakthrough, step, refs}`, `te.plot` `{plot, faction, action}`, `te.void_tether`, `te.breach`; `leader.use` for TE agents/heroes | many 3–4-step flows: ThundersParadox (4 steps), VoidTether (3), Deepgloom (5 buttons), Forerunner/Survival/OjzRetreat each with an `undo*_` step (model as `progress` + `undo` option) |
| **c6** component actions, relics, explore/tech tail, generic choose-kinds | ComponentActionHelper, RelicButtonHandler/ButtonHelperRelics/relic services, ExploreButtonHandler, ListTechService, ExhaustTech/TechUse, legendary planets, `exhaustAgent_`/`getAgentSelection_` | 66 | acquireATech (6), componentActionRes_ (1), planetAbilityExhaust_ (1) | 13 | 1 (`prophetsTears_` text) | `component.action` `{type: leader\|relic\|tech\|ability\|pn\|ac, id}` for the `componentActionRes_` sub-router; `relic.use` `{relic, step, refs}`; `tech.use`; `leader.use` target step; generic primitives `choose.planet\|system\|player\|unit\|amount` (catalogue taxonomy) for one-step "pick X" prompts | `componentActionRes_<type>_<id>` hides many kinds behind one prefix (sub-router). Explore look/discard prompts are private (cards-info) |
| **c7** action-card / PN step tail | ButtonHelperActionCards, TeHelperActionCards, TeHelperPromissories, ActionCardHand/Ping/PickFromDiscard, `increaseTGonSC_` | 50 | increaseTGonSC_ (5), crashLandingStart (1) | 1 | 0 | extend `action_card.resolve`/`action_card.target` (G8) with per-card step values; `promissory_note.resolve` | mostly 2–3-step target picks (`scuttleOn_`→`scuttleIn_`, `luckyShotOn_`→`luckyShotIn_`, `exchangeProgramStart`→`Part2`→`Part3`, `extremeDuressStart`→`Target_`, `overruleStart`, `rescuePart2_`, `crashLandOn`). Low risk |
| **c8** core tails: phases, tactical/combat/production tail, setup, trade builder, perpetual/optional/undo prompts + homebrew off for web games | ButtonHelperSCs (core), AgendaHelper, AgendaWhensAfters/Rider, StatusPhase/GamePhase/RoundSummary/EndGame, SecretObjective (`drawSpecificSO_`), ButtonHelperModifyUnits, CommandCounter, UnitManagement, ModifyUnit, Commodity/TradeGood/Convert, Bombardment/Combat/Capture/AssignHits, TransactionHelper, TradeStation, MiltyDraft (`queueMilyPick_`, `draftPresetKeleres_`), DraftButtonService (`jwds_`), GameOption/GameSurvey/PlayerPreference/Vanity/Titles/Statistics opt-in, galactic events | 251 | **~1,400 live / ~1,570 stored** (all of §0's top rows) | 42 | 11 | (1) affordances: one kind `ui.undo_affordance` `{undoes: so_discard\|agenda_put\|preset\|vote\|rider, ref}`, non-blocking. (2) `player.preference` (private). (3) close or delete obsolete prompts. (4) `isInfoMenu` → split shortcuts. (5) extend `agenda.vote`/`agenda.when/after` (`play_when`, `play_after_`, `no_when(_persistent)`, `exhaust_`), `status.score` (pre-score), `command_tokens.adjust` (`gain_CC`, `lose1CC`, `confirm_cc`, `placeCCBack_`, `spendAStratCC`, `reinforcements_cc_placement_`), `commodities.convert` (`gain_N_comms(_stay)`, `convert_N_comms(_stay)`, `gainComms_`, `convertComms_`), `units.modify` (`getModifyTiles`, `genericModify*`, `genericBuild_`, `genericRemove_`, `removeThisTypeOfUnit_`), `combat.hits` for `getDamageButtons_` violations, `trade.builder` or route web seats to `trade.propose` | **Biggest live share, mostly cheap.** Split it in two if staffed: c8a perpetual/optional/undo + preferences + setup + trade (about 110 handlers, ~95 % of live legacy), and c8b phase/tactical/combat/production tail (about 140 handlers) |
| **c9** message-text / label state → game model | §3 list | 44 entries (37 in scope) | — | — | all | no new kinds; stored values (`PromptState`) read by the kinds' `progress()` | must land before c8/c5 can type `exhaust_`, `landUnits_`/`spaceUnits_`/`doneLanding`, `riftUnit_`, `deleteButtons` "Done …" |
| **homebrew** (not typed, kept off web games) | DS/BR/other faction handlers in core files + excluded classes | 203 (75 excluded classes + 128 DS/BR) | setOptIn* (78, admin opt-in prompt: suppress, see c8) | — | — | none; see §4 | — |

Sizes, ignoring the homebrew bucket: c5 115, c6 66, c7 50, c8 251 (split it), c1–c4 82 attributed + 148 to triage
(about 55 each once split). c9 is bounded by §3.

**Not covered by any of c1–c9 today (please assign):**

* Twilight's Fall. The bot counts `twilights_fall` as official (`Source.isOfficial`) and it ships in the Thunder's
  Edge box. It is about 65 handlers (edicts, `Tf*`/`Tk*` resolvers, splice draft). Either type it (a c5b) or keep
  it off web games with the homebrew switch (§4). My recommendation is to keep it off.
* Galactic events (`enableDaneMode_`, `rapidMobilization*`, `addMinorFactionsInfantry`, …). They are TE official
  and are offered on the setup message. Either put them in c8 or switch them off for web games.
* Select menus (17) and modals (38). The INFRA-3 `input.form` and select schemas carry them, but a message whose
  only control is a select is still `kind:"legacy"`. Give `DecisionCapture` a `kind: "input.select"` fallback for
  select-only messages so they count as typed.

## 3. Handlers that keep game state in their own Discord message (c9)

From the catalogue (`readsLabel` / `readsMessageContent`) plus a grep of the e4f2455 sources
(`getButton().getLabel()`, `getMessage().getContentRaw()`, channel history, reactions). Excluding testbed, homebrew
and FoW leaves 37. c9's worktree already modifies many of these files (`PromptState.java` added).

| Handler (prefix) | Where | What it reads | State to move into the game model / engine |
|---|---|---|---|
| `deleteButtons` ("Done Gaining/Redistributing/Losing Command Tokens", "Done Losing Fleet Tokens", "Done Exhausting Planets", "Done Producing Units") | DeleteButtonsButtonHandler:67–130, 247 | button **label** selects the branch; message text "command tokens have gone from X/Y/Z" holds the **original pools**; "Net gain"; previous message "You have available to you" via channel history | the label → a typed id suffix (`deleteButtons_doneGainingCC` …, keep the label). Original pools at panel open → stored value `originalCCs<faction>` (ENGINE-INT open issue 4; `command_tokens.adjust.progress.required.original`). Net-gain flag → id. Previous-message delete → track the message id of the "available" prompt |
| `exhaust_` (agenda votes) | AgendaHelper:216–232 | label "(3)" = votes of the exhausted planet; message text = **running vote total** | per-player stored `agendaVotesSoFar<faction>` + planets exhausted for votes (already partly in `agenda.vote` payload); total from planets' influence + modifiers |
| `refresh_` (un-exhaust during voting) | PlanetExhaustButtonHandler:27–37 | running vote total in text | same stored value as `exhaust_` |
| `landUnits_`, `spaceUnits_`, `doneLanding`, `refreshLandingButtons`, `ChooseDifferentDestination` (label contains "ring") | TacticalActionButtonHandlers:135–324, ButtonHelperModifyUnits:1496, UnitManagementButtonHandler:100 | movement/landing summary accumulated in the message text; "Moved all units to the space area." marker | per-turn stored landing ledger (`landed<faction>`: holder → units), already conceptually `tactical.land` progress; label check → id field |
| `doneRemoving` | UnitManagementButtonHandler:110 | removal summary text re-posted | removal ledger stored value |
| `riftUnit_`, `wormholeUnit_`, `wormholeAllShips_` | RiftUnitsHelper:39–196 | rolled/removed units summary in text | `rift<faction>` ledger (`tactical.rift` progress) |
| `retreatGroundUnits_` | ButtonHelperModifyUnits:1951–1980 | label (unit count) + text | id carries the count; retreat ledger |
| `place_` (production/construction) | ButtonHelperModifyUnits:2040, 2328, 2432 | text contains "construction" → construction mode; edited summary text | `place_` mode flag in the id or stored `constructionPlacing<faction>`; production ledger already `player.getCurrentProducedUnits()` |
| `sc_follow_`, `sc_no_follow_`, `mahactA_follow_`, `scepterE_follow_`, `thardentiag_follow_` | ButtonHelperSCs:1541–1718 | last 2 chars of the **label** = SC number ("#3") | SC number into the id (`sc_follow_3`); the handler reads the id |
| `pass_on_abilities` | ReactionButtonHandler:19 | label text echoed into the log | cosmetic: use a fixed string |
| `queueWhen_`, `queueAfter_` | AgendaWhensAftersHelper:244/284 | label (card name) echoed | card id → name via Mapper |
| `gain_1_tg` | TradeGoodButtonHandler:18 | label decides the source (commander/ability) | source in the id |
| `exhaustAgent_`, `yinagent_` | ButtonHelperAgents:621/1663, 2883 | text of the exhausted message re-used | none needed beyond re-render; drop the text reuse |
| `finishComponentAction_` | GamePhaseButtonHandler:44 | re-posts message text | cosmetic |
| `prophetsTears_` | ButtonHelperRelics:50 | text of the exhausted message | cosmetic |
| `resolveVolatileInf_`/`resolveVolatileMech_` | ExploreButtonHandler:84/110 | text contains "fragment" → which source | source flag in the id |
| `gainComms_`/`convertComms_` | ButtonHelperStats:42 | text contains "explore" → whether it came from an explore | flag in the id |
| `narrowWayDestination_` | ButtonHelper:8673 | re-renders text | cosmetic |
| `placeKhraskCommanderInf_`, `uydaiCommanderLook_` | ButtonHelperCommanders:494/580 | text / label | DS/BR (homebrew): skip |
| `raghsCallStepOne_` | ButtonHelperFactionSpecific:2273 | label "please choose which planet to…" picks the step | step in the id |
| `yssarilHeroInitialOffering_` | YssarilButtonHandler:22 | label = offered card name | card id in the id |
| `riskDirectHit_` | PlayerPreferenceHelper:291 | re-renders text | cosmetic |
| `enableDaneMode_` | GalacticEventButtonHandler:24/173 | toggles shown in text | game flags already exist; re-render from them |
| `launchGame` | CreateGameButtonHandler:49, 76, 234–250, 429 | **player list and game fun-name parsed from the lobby message text** | the pending game in a store (`/game create_game_button` → pending lobby record). Needed before the message store goes |
| `addNekroToken_`/`removeNekroToken_` (TE breakthrough) | BreakthroughCommandHelper:406–424 | re-renders text | cosmetic |
| `removeValefar` / `exhaustTechAndResolve` | PlayerTechService:436 | label contains "(" | id field |
| `resolveCrownOfE` (confirm pre-pass) | ButtonHelper:9035 | label echoed into the confirm button | cosmetic |
| `editMessage_` (saveButtons) | ButtonHelper:4124 | message text | cosmetic |
| `ghotiAProd` / Zelian agent step 2 | ButtonHelperAgents:2424 | label "Yourself" | DS: skip |
| **Reaction windows** (SC follow, no-whens/afters, sabotage, "end turn when all reacted", status "all scored") | ReactionService:35–264, ReactionCheckService:38–204, ButtonHelperSCs:1627–1708, SabotageService | per-player reactions are stored in `GameMessageManager`, but completion handlers **fetch the Discord message** (`retrieveMessageById`) to edit or delete it, and `respondAllPlayersReacted` reads the pressed **label** | `GameMessageManager` is already the source of truth. Pass the message id instead of a `Message`, and route the edit/delete through the MessageSink so this survives JDA REST removal |
| `VoteButtonHandler` (`tiedPlanets_`, …) | VoteButtonHandler | channel **history** | stored tie state |
| `SecretObjectiveInfoService`, `CardsInfoService` | info services | label / earlier messages | info only: becomes a state query |

Bot draft and trade: `DraftButtonLocator` reads the last 200 channel messages to find draft buttons, and
`TradeService.pendingOffers` reads Accept/Reject/Counter buttons from cards-info threads. Both go in §5.

## 4. Homebrew: what enables it, and keeping it out of web games

**What turns homebrew on.** `Game.hasHomebrew()` (Game.java:5018) is true for any of:

* `homebrew_mode`, `homebrew_sc_mode`, `extra_secret`, FoW / light fog, `facilities`, `red_tape`, `discordant_stars`,
  `blue_reverie`, `uncharted_space`, Franken, `miltymod`, `absol`, `votc`, `muaat_mania`, `cosmic_convergence`,
  `liberation_c4`, `erwans_gambit`, `promises_promises`, `flagshipping`, `community`, spin mode, TE demo, Twilight
  Kart / TK cups / TF-BR / Twilight DS;
* any non-official deck (AC/SO/PO/relic/agenda/explore/tech/event), tile, faction or leader source
  (`Source.isOfficial()` = base, pok, codex1–4, thunders_edge, twilights_fall);
* fewer than 3 or more than 8 players. That clause is not homebrew: do not reuse `hasHomebrew()` as the gate.

**Measured.** Homebrew games found: pbd5 and pbd93 (homebrew + monuments + homebrew SC), pbd106 (homebrew + Blue
Reverie), pbd111 (homebrew + TF + 13 galactic events + homebrew SC). pbd109 has galactic events only (TE official).
Two games use `agendas_twilights_fall` and one `tf_action_deck`.

**How players reach homebrew today.**

* Web games are made by `shim/src/solo.ts`: `/game create_game_button` → Launch → `chooseExp_{te|newPoK|oldPoK}` →
  `miltySetup` → `jmfA_main_startMilty` with default settings. Nothing in that path enables homebrew.
* A player can still press, on the setup message (`offerGameOptionButtons` + `getHomebrewButtons` +
  `offerTEOptionButtons` + `startTFGame` + `frankenSetup`, live in 22 games right now), "Supported Homebrew",
  "Galactic Events", "Start Twilight's Fall Game" or "Start Franken Setup".
* The Milty settings menu (`jmfA_`/`jmfN_`) lets them add DS/other faction and tile sources.
* `/game setup` and other slash commands can set modes, if the web exposes the command composer.

**Proposal (owner c8).**

1. **Bot gate** (self-hosted only; new upstream-compatible guard in `ti4.selfhost`): `TI4_OFFICIAL_ONLY=on`.
   * Refuse, with an ephemeral "not available in this server", the handlers `getHomebrewButtons`, `startTFGame`,
     `startTFDraft`, `toggleTfHomebrew_`, `editTFHomebrew`, `frankenSetup`, `offerGameOptionButtons` homebrew
     entries, the `jmfA_` source toggles for non-official sources, and the mode options of `/game setup` /
     `/game set_deck`.
   * Galactic events: allow or refuse by a second flag (TE official, but untyped).
2. **Engine gate.** A `Game` predicate `officialOnly(game)` = none of the mode flags, all decks/tiles/factions/leaders
   official, no TF. When false, `DecisionCapture` marks every decision `homebrew: true` (or skips typing).
   `engine-metrics` excludes those games from the 100 % goal, and the deletion of the legacy fallback disables web
   play for such games instead of breaking them. This is honest: they keep working on Discord.
3. **Web and setup kinds.** `setup.game_settings` drops the homebrew options from its typed values, so the web never
   shows them. solo.ts already presses only official choices.
4. With 1–3 in place, every handler in the "homebrew" bucket (203) and the TF list is outside the deletion's
   100 % requirement.

## 5. Deletion checklist (W-INFRA-4), in order

Gate for each step: `engine-metrics` reports typed 100 % of non-info, non-homebrew decisions over a full soak (6–8
autopilot players, 2 games to the end, plus one human/web game through setup, combat, agenda and trade), zero
`engineOwns → legacy` fallbacks logged, and regress PASS ×2. Keep `TI4_ENGINE=off` usable until step 3.

**Step 1: shim bot policy (no user-visible change).**

* `shim/src/autopilot.ts` (1,570 lines):
  * delete `RULES` (l.112–248) and the AVOID regex (l.109);
  * delete the legacy turn loop that matches message signatures (`signature`, `normId`, `normLabel`,
    `areInverse`, `myThreadOwner`, `gameOf`, `family` faction inference, `_prompted_for` use at l.853);
  * delete `engineOwns` (l.354) and the 90 s ownership window;
  * the autopilot keeps only `engineStep()` → `shim/src/engine/autopilot.ts` `chooseTyped`.
* `shim/src/botplay/`: `brain.ts`, `cards.ts` (G2/G7 legacy jobs), `prompts.ts`, `steps.ts`, `tactical.ts` (legacy
  tactical; keep `tacticalEngine.ts`), `production.ts`, `trade.ts` + `tradeLegacy.ts`, `violations.ts`, `seat.ts`
  (if only legacy uses it). Keep `board.ts`, `hyperlanes.ts`, `units.ts`, `techs.ts` only if `engine/policy*`
  imports them. Check with `tsc` after deleting.
* `shim/src/solo.ts` setup steward (l.410–499: drives the draft/setup by scraping controls) → engine answers
  (`setup.*`, `draft.milty.pick`). Game creation still uses the slash command until step 4.
* Precondition: every `chooseTyped` case returns an answer for its kinds. c11 is checking that the bot never leaves
  a decision "to a person".

**Step 2: web legacy UI (after c10 makes engine UI the default).** *Prepared on branch `delete-legacy-web`* (merge
after a clean day with `TI4_ENGINE_WEB=1`): `web/src/decisions/`, `play/attention.ts`, engine-off branches and the
trade drawer's legacy endpoints are gone; reused pieces moved to `web/src/engine/{focus.ts,ui/CombatOutcome.tsx,
ui/FactionIcon.tsx}`. *Branch `mapactions-engine`* (on top of it): `web/src/prompts/` is gone too — the map's
tactical steps read `tactical.activate/move/land` decisions and answer them over `op:"answer"` (`mapactions/step.ts`,
`engine.ts`), the setup screen reads `GameState.setup`, pure bot-text helpers (rewind phrasing, combat reports) moved
to `web/src/botText/`; select `#value` / `needsInput` options go to the engine too (pressed the Discord way only when
the engine answers `needs_input`/`unsupported`: handlers without native coverage, ephemeral prompts).

* Delete `web/src/decisions/` (12.6k lines): `detect/{games,pending,waiting}.ts`, `model/{classify,controls,queue,
  focus,frontier,expedition,scoring,stored,text,usePress}.ts`, `renderers/*` (legacy renderers), `ui/DecisionHost.tsx`
  (+ `pressPlan.ts`, `FollowNotices`, `ChoiceButtons` …), `dev/`.
* Dependencies to cut first:
  * `web/src/engine/EngineDecisionHost.tsx` and `engine/index.ts` import `@/decisions/ui/DecisionHost` (+ css) and
    `engine/renderers/agenda/shared.tsx` imports `@/decisions/ui/parts`. Move the shared parts under `engine/ui/`.
  * `web/src/mapactions/*` (`activate`, `movement`, `landing`, `LandingPanel`, `MapActionsLayer`, `driver`,
    `bonuses`, `context`) use `decisions/model/controls` and `detect/games`. Switch them to `mapactions/engine.ts`
    (`move`/`land` direct actions, already there) and `GameState`.
  * `gamelog/useGameEvents.ts` uses `classify`; `rollback/{flows,plan}.ts` use `model/phrasing.ts` (move it to
    `gamelog/`).
  * `trade/{TradePanel,openTradeWith}.tsx` and `engine/renderers/trade/TradeOffer.tsx` import `@/decisions`.
  * `board/{GameScreen,Mounts,SetupScreen,TopBar,useExternalFocus}` mount the legacy host.
  * `engine/renderers/setup/*` and `hand/*` still call legacy `press(` for select `#value` and `needsInput`. Switch
    them to the INFRA-3 typed path (ENGINE-INT open issue 10).
* Drop the `?engine=0` flag (`engine/flag.ts`) and the legacy fallback when the engine is "unavailable" (show an
  error/reconnect instead).
* `web/src/trade/` fallback to `/trade/options` + `/trade/pending` + button presses → engine trade only.

**Step 3: bot selfhost API button scraping.**

* Delete `ti4/spring/api/selfhost/DraftButtonLocator.java`. Strip the button parts of `DraftViewService` (it
  injects the locator, l.76) so the draft view becomes state-only. The draft kinds already answer.
* `TradeService` button parts: `pendingOffers` (l.370–440, reads Accept/Reject/Counter/Rescind buttons from
  cards-info messages), `stripOfferButtons` (l.465+), `ButtonRef` in TradeModels → read offers from the trade state
  (`GameState.trade`, `trade.offer`/`offer_sent` decisions) and act through `ActionInvoker`. Delete shim
  `GET /trade/pending` users (`botplay/tradeLegacy.ts`, web drawer fallback) in the same change.
* Remove `TI4_ENGINE=off` (the engine is no longer optional). Remove synthetic answers (`TI4_ENGINE_NATIVE=off`,
  shim `/api/v10/selfhost/interactions` mint, `Clients.mintComponentInteraction`) once `NativeCoverage` is 100 %
  for the in-scope handlers (2,720/2,724 today; ephemerals are the remaining gap).

**Step 4: Discord emulation (largest; it carries non-decision features too).** The shim's message store, gateway
and REST still carry:

* chat / table-talk (the web `discord/` client);
* the game log (`gamelog` parses bot messages);
* map images (`bot-map-updates` file posts);
* cards-info text, slash commands (solo.ts creates games with `/game create_game_button`), lobby/launch;
* reaction-window completion (§3: `retrieveMessageById`), and `DecisionRebuild` (re-reads channel history after a
  restart).

Order:

1. **Bot.** Give `MessageSink` an in-process implementation: decisions go to the registry; game log lines go to a
   typed event log (`GameEventService` already exists); images go to the web-data/image API. JDA REST stays only for
   real Discord, not self-host. `DecisionRebuild` becomes "persist the registry with the game" (or rebuild from
   game state). Reaction services take message ids (§3). `launchGame` / `create_game_button` get a direct
   `POST …/engine/games` (pending lobby record instead of lobby message text). `InteractionTracker`/
   `DecisionCapture`'s OkHttp interceptor goes away with JDA REST.
2. **Shim.**
   * `hub.ts`: prompt attribution `attributePrompt`/`_prompted_for` (l.234–241), the busy re-send, and the
     message/channel fan-out listeners.
   * `gateway.ts` (264 lines, the bot's Discord gateway; needs 4.1's command path first).
   * `rest.ts` (804 lines, `/api/v10` emulation; keep only what the web still uses, ideally nothing).
   * `store.ts` message/channel/thread/emoji storage (keep users/seats/tokens).
   * `clients.ts` component-interaction minting.
   * `lobby.ts` (channel/role emulation).
3. **Web.** Delete `web/src/discord/` (the Discord-like client) once chat and log have engine-native replacements
   (chat = a small shim chat store, or drop it; log = typed events). `api/useGameSocket` stops consuming message
   frames.
4. **Finally.** `bot/patches/0001-self-hosted-discord-shim.patch` shrinks to the engine + selfhost API. JDA is only
   needed for real-Discord deployments.

Dependencies:

* Step 1 needs the c1–c8 kinds and c11.
* Step 2 needs step 1 (the web harness reuses autopilot classification in tests) and c10.
* Step 3 can run in parallel with step 2.
* Step 4 needs steps 1–3, plus c9 (no state in message text), plus the non-decision replacements above.
  It is not needed to "delete the legacy fallback"; it is the Discord-removal goal.

## Appendix: every in-scope legacy handler by workstream

Marks: **(n)** = seen in real games (live + stored + presses); ᵀ = text/label state; ᴹ = multi-step / edits in
place. Bucket "HB" = homebrew/excluded (not required). "c1-3?" = faction ability or step without a faction name in
the prefix: triage between c1–c4 or homebrew. Machine-readable: `/home/user/run/coverage-tools/legacy-handlers.json`
(fields: prefix, c, cls, file, area, faction, multi, label, msg, live, storeN, pressN).

Caveat: attribution of generic tails is by owning class and catalogue area. The catalogue tags some homebrew
handlers in core files as "core", so a few entries in c6–c8 may turn out to be homebrew (e.g. legendary planets
Alfheim/Vanaheim/Midgard/Niflheim/Svartalfheim, Industrex, Prism, Illustrion, `absolsdn_`, `*MMBoon`, `anarchy*`/`lumi*` SC sets, `cosmicConStep3_`, `*Path*`, `tfawaken_`). Drop them when found, and say so in
the report.

#### Homebrew / excluded — not required (203)
- **ButtonHelperFactionSpecific** (31): `chooseToldarBtSide_` `gloryTech`ᴹ `gheminaMechStart_` `gledgeBasePlanet_` `nivynMechStep1_` `nivynMechStep2_` `resolveMykoMech` `resolveVadenMech_` `utilizeAtokeraMech_`ᴹ `blackTFMechReroll` `kolleccRelease_`ᴹ `orangeTFMechRepair` `edynCommanderSODraw` `declineKaltrimAgenda` `discardKaltrimAgenda_` `edynAgendaStuffStep2_` `edynAgendaStuffStep3_` `bentorPNPlanet_` `pharadnPNUse`ᴹ `veldyrAttach_` `deployMykoSD_` `kaltrimAmbassadors_` `lanefirATS_` `pharadnInf2Revive_` `qhetInfRevival_` `rohdhnaDeploy_` `rohdhnaIndustrious_` `rohdhnaRecycle_` `startPharadnInfRevive`ᴹ `startRedTFDeploy` `tnelisDeploy_`
- **ButtonHelperAgents** (25): `freeSystemsAgentStep2_` `mercerMove_`ᴹ `moveGloryStart_` `moveGlory_` `umbatTile_` `pharadnAgentKill_` `belkoseaYellowTechReady_` `ghotiAProd` `ghotiATG` `pharadnAgentSelect_` `celdauriAgentStep3_` `cheiranAgentStep2_` `cheiranAgentStep3_` `florzenAgentStep2_` `florzenAgentStep3_` `fogAllianceAgentStep2_` `lanefirAgentRes_` `placeGlory_` `presetEdynAgentStep1` `presetEdynAgentStep2_` `presetEdynAgentStep3_` `step2axisagent_` `toldarAgent_` `vaylerianAgent_` `refreshWithOlradinAgent_`
- **ButtonHelperHeroes** (24): `freeSystemsHeroPlanet_` `lizhoHeroFighterResolution` `exhaustBelkoseaHero`ᴹ `khraskHeroStep3Exhaust_` `khraskHeroStep3Ready_` `khraskHeroStep4Exhaust_` `khraskHeroStep4Ready_` `sendVadenHeroSomething_` `tnelisHeroAttach_` `augersHeroStart_` `axisHeroStep2_`ᴹ `axisHeroStep3_` `florzenHeroStep2_` `gheminaLadyHero_` `gheminaLordHero_` `khraskHeroStep2_` `kyroHeroInitiation` `mykoheroSteal_` `olradinHeroFlip_` `poisonHeroInitiation` `purgeCeldauriHero_` `toldarHero_` `vadenHeroClearDebt`ᴹ `refreshBelkoseaHero`ᴹ
- **ButtonHelperCommanders** (16): `freeSystemsBT_` `utilizeMykoBT_` `pharadnCommanderUnlockKill_`ᴹ `cheiranCommanderBlock_` `cymiaeCommanderRes_` `kortaliCommanderBlock_`ᴹ `olradinCommanderStep2_` `placeKhraskCommanderInf_`ᵀᴹ `qhetHero_` `ravenMigration`ᴹ `resolveMykoCommander` `unlockPharadnCommander` `utilizePharadnCommander_` `uydaiCommander` `uydaiCommanderBottom_` `uydaiCommanderLook_`ᵀ
- **JimboHandlers** (10): `jimbo_exit` `jimbo_featureAction`ᴹ `jimbo_mainPage`ᴹ `jimbo_metaAction`ᴹ `jimbo_tileAction`ᴹ `jimbo_tileAdd`ᴹ `jimbo_tileAdd_` `jimbo_tileMove` `jimbo_tileRemove` `jimbo_transformAction`ᴹ
- **OtherHeroButtonHandler** (10): `pharadnHeroDestroy_` `pharadnHeroCommit_` `ghotiHeroIn_`ᴹ `purgeAtokeraHero` `purgeKortaliHero_` `purgeOrlandoHero_`ᴹ `purgeRohdhnaHero` `purgeUydaiHero` `purgeVaylerianHero` `utilizePharadnHero_`
- **NekroMonumentService** (8): `nekroMonumentMove` `nekroMonumentMoveTarget_` `nekroMonumentRelocate_` `declineNekroMonumentCopy` `nekroMonumentCopy` `nekroMonumentPlace` `nekroMonumentPlaceTarget_` `nekroMonumentPlace_`
- **ButtonHelperAbilities** (8): `deployFreesystemsMech_` `mirvedaFS_` `augersPeak_` `buyAxisOrder_`ᴹ `getAxisOrderReturns` `olradinConnectStep2_` `olradinPreserveStep2_`ᴹ `returnAxisOrder_`
- **TestBedPanelButtonHandler** (7): `testbedPanel_actAs_`ᵀ `testbedPanel_back` `testbedPanel_page_` `testbedPanel_run_`ᵀ `testbedPanel_tool_`ᵀ `testbedPanel_turnActAs_`ᵀ `testbedPanel_turnPress_`ᵀ
- **ButtonHelperModifyUnits** (5): `vadenYellowTechUse` `assCannonNDihmohn_` `kolleccMechCapture_`ᴹ `offerMirvedaCommander`ᴹ `resolveMirvedaCommander_`ᴹ
- **FrankenButtonHandler** (4): `frankenDraftAction` `frankenItemAdd` `frankenItemRemove` `finishedBuilding`
- **TEOptionService** (4): `startTFDraft` `tkNovaSetup_` `twilightDSSetup_` `toggleTfHomebrew_`
- **TfBlessResolver** (3): `blessBoonCC` `blessBoonAC` `blessBoonTg`
- **TkSpoilResolver** (3): `spoilShip_` `spoilTile_` `beginSpoil`
- **TkEnfiladeResolver** (3): `enfiladeDestroy_` `enfiladeTarget_` `enfilade_`
- **StartScenario** (3): `beginAuction_` `bidResource_` `winAuction_`
- **ButtonHelper** (3): `veldyrBTExplore`ᴹ `sarMechStep1_`ᴹ `sarMechStep2_`
- **TfArtificeResolver** (2): `keepArtificeParadigm` `artificeStep2`
- **IgnisStrategyCardButtonHandler** (2): `ignisAuroraSC8Primary`ᴹ `ignisAuroraSC8Secondary`
- **HomebrewRelicButtonHandler** (2): `deployTyrant`ᴹ `thronePoint`
- **TfConveneResolver** (2): `conveneStep1_`ᴹ `conveneStep2_`
- **StatisticsOptInOutService** (2): `setOptInSinglePreference_`**(78)**ᴹ `setOptInStats_`**(78)**
- **FOWOptionService** (2): `fowOptionCategory_` `fowOption_`
- **ListTechService** (2): `propagationResearch_` `propagationGainCC`
- **CustomHyperlaneService** (1): `customHyperlaneEdit`
- **HomebrewService** (1): `oplusplusSetup_`ᴹ
- **AbsolX89ButtonHandler** (1): `absolX89Nuke_`
- **DacxiveButtonHandler** (1): `dacxive_`
- **TkCatalyzeResolver** (1): `rollCatalyze`ᴹ
- **TfCensureResolver** (1): `electCensure`
- **TkEndorseResolver** (1): `electEndorse`
- **OPlusPlusCouncilService** (1): `oplusplusCouncilConfirm_`ᴹ
- **MonumentsService** (1): `scoreToppleAMonument`
- **EdictPhaseHandler** (1): `edictPhase`
- **TfForetellResolver** (1): `foretellPeak_`ᴹ
- **EdictResolveButtonHandler** (1): `resolveEdict_`
- **CombatReplayDebugButtonHandler** (1): `combatReplayDebug_`
- **TestHideAcDiscard** (1): `devHideAc_`
- **TestPillageTg** (1): `devPillageTg_`
- **JazzCommand** (1): `jazzButton`
- **StatsTrackingButtonHandler** (1): `statsTracking_`
- **PlayerPreferenceHelper** (1): `wrongButtonEphemeral_`**(2)**ᴹ
- **TeHelperActionCards** (1): `resolveNokarBt_`
- **TeHelperUnits** (1): `revenantDeploy_`
- **ButtonHelperSCs** (1): `thardentiag_follow_`ᵀ
- **FactionMiscButtonHandler** (1): `fogAllianceAgentStep3_`

#### c1 (20)
- **creuss** (10): `creussHeroStep1_` `creussMechStep1_` `creussMechStep2_` `creussMechStep3_` `creussHeroStep2_` `creussIFFResolve_` `creussIFFStart_` `creussTFCruiserStep1_` `creussTFCruiserStep2_` `creussTFCruiserStep3_`
- **hacan** (7): `hacanMechTradeStepOne_` `hacanMechTradeStepTwo_` `hacanAgentRefresh_` `purgeHacanHero` `hacanFlagshipFinish_` `hacanFlagshipThalnos_` `hacanFlagship_`
- **letnev** (1): `letnevMechRes_`ᴹ
- **ghost** (1): `placeGhostCommanderFF_`
- **jolnar** (1): `jolNarAgentRemoval_`**(2)**ᴹ

#### c1–c3 triage: faction steps with no faction name in the prefix (148)
- **(generic)** (148): `c4redtech_` `swapSCs_` `swapTechs_` `arboAgentPutShip_` `automatonsPlanet_` `deathBindingRemove_` `placeWingTransferCC_`ᴹ `returnFFToSpace_` `scourPlanet_` `terraformPlanet_` `becomeDamaged_`ᴹ `capture1Pharad` `nullificationField_` `rollForAmbush_`**(15)**ᴹ `arboCommanderBuild_` `arboHeroBuild_`ᴹ `exhaustTCS_` `nightbloomBuild` `productionBiomes_` `totalWarCommGain_` `unlockCommander_`ᴹ `blindIFFSelection_` `selectBeforeSwapSCs_` `scoreOtherPlayersSecrets`**(20)** `scoreOtherPsSO` `spyNetPlayerChooses` `takeAC_` `warStoriesFrontier_` `warStoriesPlanetExplore` `arboAgentIn_` `arboAgentOn_` `asnStep2_` `assimilate_`ᴹ `cavStep2_` `collateralizedLoans_` `deceiveDecline` `deceiveTarget_` `declareUse_`ᴹ `geneticRecombination` `greyfire_` `intrigueCardOn` `jnHeroSwapOut_`ᴹ `offerNecrophage`ᴹ `passMalevolencyTo` `quash` `raghsCallStepOne_`ᵀᴹ `raghsCallStepTwo_` `reflectDecline` `reflectGive_` `reflectTarget_`ᴹ `replacePDSWithFS_` `startChaosMapping` `startImpulseCore_`ᴹ `startIntrigueCard` `startQDN` `startVortexerRevive`ᴹ `stymiePlayerStep1_` `stymiePlayerStep2_` `thwartDone_` `thwartTake_` `useTA_` `useTCS_` `vortexRevive_`ᴹ `purgeTech_` `moveShipToAdjacentSystemStep2_`ᴹ `placeHolderOfConInSystem_` `exhaustAgent_`**(79)**ᵀᴹ `spendStratNReadyAgent_` `attachAttachment_` `findAttachmentInDeck_` `relicSwapStep1`ᴹ `relicSwapStep2` `shrineView_` `stealRelic_` `augerHeroSwap.` `claimPlanet_` `mitoMechPlacement_` `mitosisMech`**(4)** `munitionsReserves` `orbitalMechDrop_` `removeTrapStep1` `removeTrapStep2_` `startSimultaneousTacticalAction`ᴹ `getOmenDice` `getOmenDice2` `startCombatOn_` `exhaustSuperweapon_`ᴹ `exhaustViaDiplomats_` `starforgeFree_` `starforgeTileFree_` `starforgeTile_` `starforge_` `changePoToSo_` `drawHeistObj_` `removeHeistObj` `removePoToSo_` `revealHeistObj` `addShrine_` `PrePlay_` `addTombToken_`ᴹ `autoneticMemoryDecline_` `autoneticMemoryStep2_` `autoneticMemoryStep3a` `autoneticMemoryStep3b` `availynStep2_` `bestowPart2_` `bindingDebtsRes_` `blackOps_` `contagion_` `dataRecovery_`ᴹ `declinePillage_` `enterCoexistence_` `facsimileStep2_` `fakeHiredGuns` `garbozia_` `getDiplomatsButtons`ᴹ `gromPart2_` `indoctrinate_` `initialIndoctrination_` `initialPeak` `mantleCrack_` `mercenariesStep1_`ᴹ `mercenariesStep2_` `mercenariesStep3_` `mercenariesStep4_` `meteorSlings_` `mitosisInf`**(4)** `morsPart2_` `moult_`ᴹ `mutineersStep2_` `peaceAccords_` `pillage_` `rallyTheHordeStep2_` `rallyToTheCauseStep2_` `revealTrapStep1` `revealTrapStep2_` `setTrapStep1` `setTrapStep3_` `setTrapStep4_` `startAncientEmpire` `startBestow` `startFacsimile_`ᴹ `startHiredGuns`ᴹ `startRallyTheHorde` `startRallyToTheCause` `superWeaponPart2_` `superWeaponPart3_` `useOmenDie_`

#### c2 (17)
- **nekro** (5): `nekroStealTech_`**(2)**ᴹ `nekroTechExhaust` `useNekroNullRef` `nekroAgentRes_` `nekroHeroStep2_`
- **naalu** (4): `naaluCPN` `naaluCommander` `naaluHeroInitiation` `naaluHeroSend`
- **sardakk** (3): `sardakkbtRes`ᴹ `sardakkcommander_`ᴹ `purgeSardakkHero`
- **saar** (2): `saarMechRes_`**(1)** `saarHeroResolution_`
- **mentak** (2): `mentakCommander_`ᴹ `purgeMentakHero_`ᴹ
- **novaseed** (1): `novaSeed_`ᴹ

#### c3 (27)
- **sol** (8): `intrigueCardResolve` `resolveEvenPride_` `resolveImpulseCore_` `resolvePride_`ᴹ `severResolve_` `utilizeSolCommander_`ᴹ `resolveShipOrder_`ᴹ `resolveGrace_`
- **yin** (8): `startYinSpinner`ᴹ `yinHeroInfantry_`**(1)** `yinHeroPlanet_`**(1)** `yinCommanderRemoval_` `yinCommanderStep1_`ᴹ `yinHeroStart` `yinHeroTarget_` `yinagent_`ᵀᴹ
- **yssaril** (6): `spyNetYssarilChooses` `yssarilAgentAsJr` `yssarilcommander_` `yssarilHeroInitialOffering_`ᵀ `yssarilHeroRejection_` `yssarilMinisterOfPolicy`ᴹ
- **winnu** (3): `winnuHero_` `winnuStructure_` `winnuPNPlay_`
- **xxcha** (2): `xxchaAgentRemoveInfantry_` `xxchaHeroTEStep2_`

#### c4 (18)
- **cabal** (6): `cabalHeroTile_` `cabalAgentCapture_` `cabalRelease_`ᴹ `cabalVortextCapture_` `cabalHeroAll` `startCabalAgent_`
- **mahact** (4): `mahactStealCC_`ᴹ `mahactMechHit_` `mahactCommander` `loseMahactCC_`ᴹ
- **titans** (3): `titansConstructionMechDeployStep1` `titansConstructionMechDeployStep2_` `titansCommanderUsage`
- **argent** (3): `argentHeroStep2_` `argentHeroStep3_` `argentHeroStep4_`ᴹ
- **empyrean** (2): `empyreanFlagshipAbilityStep1_` `empyreanFlagshipAbilityStep2_`

#### c5 (115)
- **(generic)** (21): `activateEidolonMaximum_` `componentActionRes_ability_puppetsoftheblade` `faunusTake_` `miniLanding_`ᴹ `removeStrandedStructures_` `dataSkimmer_` `discardDataSkimmer` `revealExtract_`ᴹ `revealSeethe_`ᴹ `checkEidolonMaximum` `fealtyUplink_` `mindsieveFollow_` `nanomachines_` `neuralParasiteS2_` `planesplitterStep1_` `planesplitterStep2_` `purgeTechVaults_` `startNeuralParasite` `stoneEmbraceFollow_` `useExecutiveOrder_` `valefarZ_`
- **voidtether** (7): `moveVoidTether_` `removeVoidTether_` `addVoidTetherStep1` `addVoidTetherStep2_` `addVoidTetherStep3_` `newVoidTether_` `placeVoidTether_`
- **emelpar** (7): `emelparReady_leader_` `emelparReady_legendary_` `emelparReady_monument_` `emelparReady_planet_` `emelparReady_tech_` `emelparReady_relic_` `emelparReady_breakthrough_`
- **sol** (6): `resolveFrankenNeuralParasite;` `resolveProxima_` `resolveSeethe_` `resolveNeuralParasite_` `resolvePsychospore_` `solBtBuild_`
- **ralnel** (6): `handleRalNelAgentPt2_` `handleRalNelAgent_` `ralnelCStep3_` `ralnelCommander_` `ralnelMechPull_` `ralnelPull`
- **breach** (5): `removeBreach_` `statusRemoveBreach_`ᴹ `flipBreach_` `placeBreach_` `placeInactiveBreach_`
- **sleeper** (5): `selectPlayerToSleeper` `addSleeperViaBt_` `putSleeperOnPlanet_` `removeSleeperFromPlanet_` `replaceSleeperWith_`
- **yssarilbt** (5): `startYssarilbt` `yssarilbtIndividualControl` `yssarilbtRevokeAll` `yssarilbtStep2_`ᴹ `yssarilbtToggleDebt`
- **redcreuss** (5): `redCreussWashFull` `redCreussWashPartial` `purgeRedCreussHero_` `redcreussAgentPart1_` `redcreussAgentPart2_`
- **forerunner** (4): `moveForerunner_`ᴹ `startForerunner_`ᴹ `finishForerunner_` `undoForerunner_`ᴹ
- **survival** (4): `moveSurvival_`ᴹ `startSurvival_`ᴹ `finishSurvival_` `undoSurvival_`ᴹ
- **ojz** (4): `moveOjzRetreatS1_`ᴹ `ojzRetreatS2_`ᴹ `ojzRetreatS3_` `undoOjzRetreatS1_`ᴹ
- **paradox** (4): `startThundersParadox`ᴹ `useThundersParadox_step2_` `useThundersParadox_step3_` `useThundersParadox_step4_`
- **facility** (3): `addFacility_` `corefacilityAction` `startFacilityPlacement_`
- **deorbit** (3): `deorbitBarragePlanet_` `deorbitBarrageResource_` `deorbitBarrageTarget_`
- **avernus** (2): `moveAvernus_`ᴹ `placeAvernus_`
- **plot** (2): `removeFactionTokenFromPlot_`**(14)**ᴹ `addFactionTokenToPlot_`**(20)**ᴹ
- **nekro** (2): `removeNekroToken_`ᵀᴹ `addNekroToken_`ᵀᴹ
- **icon** (2): `exhaustTheIcon_` `useTheIcon`
- **benediction** (2): `benedictionStep1_` `mahactBenedictionFrom_`
- **courier** (2): `courierTransport_`ᴹ `startCourierTransport_`
- **dws** (2): `useDwsDiscount_`ᴹ `dwsHeroPurge_`
- **galvaniz** (1): `getToggleGalvanizeTiles`**(78)**
- **liberate** (1): `liberate_`**(2)**
- **cabal** (1): `beginCabalBreakthroughMove`
- **crimson** (1): `handleCrimsonAgent_`ᴹ
- **bastion** (1): `purgeBastionHero_`ᴹ
- **keleresa** (1): `purgeKeleresAHero`
- **reaping** (1): `theReapingAddTg`
- **sowing** (1): `theSowingAddTg_`
- **lawsorder** (1): `useLawsOrder`**(6)**ᴹ
- **magen** (1): `useMagenDefense_`**(6)**
- **naalu** (1): `useNaaluAgent_`**(31)**
- **keleres** (1): `pay1tgforKeleres`

#### c6 (66)
- **RelicButtonHandler** (8): `exhauste6g0network`ᴹ `crownofemphidiaexplore` `dominusOrb` `exhaustRelic_`ᴹ `eyeOfVogul`ᴹ `relic_look_top` `resolveEvenFall3Primary` `useRelic_`ᴹ
- **ExploreButtonHandler** (5): `discardExploreTop_` `exploreAPlanet` `explore_look_All` `resolveExp_Look_` `shuffleExplores`
- **ComponentActionHelper** (4): `atomicsStep2_` `atomicsStep3_` `componentActionRes_`**(1)** `redeemBounty_`
- **ButtonHelperRelics** (4): `titansHeroPlanet_` `jrResolution_` `nanoforgePlanet_` `prophetsTears_`ᵀᴹ
- **ListTechService** (3): `acquireATech`**(6)** `acquireAUnitTechWithInf` `entropicScar_`
- **AlluringThroneService** (3): `moveIllustrion_`ᴹ `placeIllustrion_`ᴹ `useIllustrionLegendary_`
- **HeartOfIxthService** (3): `exhaustHeartOfIxth_minus`ᴹ `exhaustHeartOfIxth_plus`ᴹ `declineHeartOfIxth`ᴹ
- **QuantumEntanglerService** (3): `quantumEntanglerGiveOwner_` `quantumEntanglerGiveTarget_` `quantumEntanglerTarget_`
- **AlfheimLegendaryButtonHandler** (2): `alfheimChooseDeck_` `alfheimChooseOrder_`ᴹ
- **PlayerTechService** (2): `removeSingularity` `removeValefar`
- **VanaheimLegendaryButtonHandler** (2): `vanaheimDeclineEndTurn` `vanaheimUseEndTurn`
- **IxthianArtifactService** (2): `rollIxthian` `resolveIxthian`
- **TrapButtonHandler** (2): `steal3comm_` `steal2tg_`
- **NiflheimLegendaryButtonHandler** (2): `niflheimSelectTarget_` `niflheimDiscard_`
- **SilverFlameService** (2): `scoreSilverFlameBAM` `resolveSilverFlame`
- **ButtonHelper** (2): `addNewRelics` `echoPlaceFrontier_`
- **NeuraloopService** (2): `neuraloopPart1` `neuraloopPart2`
- **TechUseButtonHandler** (1): `industrialJugReplace`
- **IndustrexButtonHandler** (1): `industrexPickType_`
- **MalliceButtonHandler** (1): `mallice_2_tg`
- **MidgardLegendaryButtonHandler** (1): `musterManheim_`
- **PrismButtonHandler** (1): `newPrism@`
- **LegendaryPlanetButtonHandler** (1): `bozgarbiaAbilityExhaust_`
- **ExhaustTechButtonHandler** (1): `exhaustTech_`
- **JRStructureButtonHandler** (1): `jrStructure_`
- **PlanetExhaustButtonHandler** (1): `planetAbilityExhaust_`**(1)**ᴹ
- **StellarConverterButtonHandler** (1): `stellarConvert_`
- **SvartalfheimLegendaryButtonHandler** (1): `svartalfheimProduceExtraShip_`
- **MutagenService** (1): `chooseMutagenOption_`ᴹ
- **DrawRelicButtonHandler** (1): `drawRelicAtPosition_`
- **ButtonHelperExplore** (1): `gainSupermassiveFragment_`
- **StarChartsButtonHandler** (1): `starChartsStep1_`

#### c7 (50)
- **TeHelperActionCards** (23): `crashLandingStart`**(1)** `brilliance` `concedeToED` `crashLandOn` `crisisSabotaged_` `exchangeProgramPart2` `exchangeProgramPart3` `exchangeProgramStart` `extremeDuressStart` `extremeDuressTarget_` `lieInWait` `loseAFleetCultural` `overruleStart` `pirateContract` `pirateFleet` `rescuePart2_` `resolvePirateContract_` `resolvePirateFleet_` `resolveTeMercenaryContract_` `startRescue` `strategize` `teMercenaryContract_` `resolveBrillianceUnlock_`
- **ButtonHelperActionCards** (16): `arcExp_` `checkForAllACAssignments` `courageousFire` `divertFunding@` `endScuttle_` `luckyShotIn_` `luckyShotOn_` `repealLaw_` `resolveCounterStroke` `resolveCounterStroke_` `resolveReverse_` `resolveTwin_` `scuttleIn_` `scuttleOn_` `seizeArtifactStep3_` `unexpectedSomeoneElse`
- **ActionCardPingButtonHandler** (4): `acPingPick_` `acPingPlanet` `acPingPlayer` `acPingSystem`
- **ActionCardHandButtonHandler** (4): `draw2 AC`ᴹ `forceGiveAC_` `getDiscardButtonsACs` `getACFrom_`
- **PickFromDiscardButtonHandler** (2): `pickFromDiscard_` `codexCardPick_`
- **ActionCardButtonHandler** (1): `increaseTGonSC_`**(5)**

#### c8 (251)
- **ButtonHelper** (70): `eliminatePlayer_` `rapidMobilizationSetup_` `removePlayerPermissions_` `resendInvite` `resolveAlliancePlanetTrade_` `resolveDMZTrade_` `sendTradeHolder_` `absolsdn_` `acceptPath` `addAbsolOrbital_` `addEntropicScar` `addLegendaryMecatol` `balanceToken_` `buttonID.startsWith` `cashInPathTokens`ᴹ `claimMMBoon` `cosmicConStep3_` `cutTape_` `declinePath` `finishMMElimination_` `fleetLogWhenAllReactedTo_`ᴹ `flipIonStorm_`ᴹ `healCoatl`ᴹ `listPath` `narrowWayDecline` `rapidMobilizationSD_` `redeemMMBoon_` `resolveCrownOfE` `resolveMaw` `resolveTwilightMirror` `resolveWarfunding` `setForThalnos_`ᴹ `setPath_` `starChartsStep2_` `starChartsStep3_` `startPath`ᴹ `startThalnos_`ᴹ `takeMonument_` `tfawaken_` `transitDiodes_`ᴹ `unflipMallice` `deleteMessage_` `editMessage_` `markResolved` `pingGame` `addNewSCs` `declineArbiter` `startArbiter`**(1)** `ministerOfPeace`ᴹ `narrowWayDestination_`ᵀᴹ `autoProveEndurance_` `drawStatusACs` `startScoring` `statusInfRevival_` `addMinorFactionsInfantry` `addToken_`ᴹ `buyoutPlanet_` `confirmSecondAction` `endTurnWhenAllReactedTo_`ᴹ `endTurnWhenSpliceEnds_`ᴹ `narrowWayMove_` `redistributePath` `removePreset_`**(357)** `startAction` `desperadoDestroyer_` `destroyMonument_` `rollThalnos_` `biostimsReady_` `psychoExhaust_`ᴹ `useProductionBiomes`
- **ButtonHelperModifyUnits** (20): `resolveDevote_` `cloakedFleets_` `domnaStepOne_` `domnaStepThree_` `domnaStepTwo_` `removeThisTypeOfUnit_`ᴹ `resolveContractual_` `startDevotion_`ᴹ `assignGravleash_` `chooseGravleash_` `combatDroneConvert_`ᴹ `combatDrones`ᴹ `hitOpponentGround_` `hitOpponent_` `magenHit_`ᴹ `removeNCaptureThisTypeOfUnit_`ᴹ `ruthlessHit_`ᴹ `stealthcorpsHit_`ᴹ `convertFFToInf_`ᴹ `placeOneNDone_`**(4)**
- **ButtonHelperSCs** (18): `anarchy10PeekAt` `anarchy10PeekStart` `anarchy2ReadyAgent_` `anarchy2secondary` `anarchy3secondary` `lumiACdraw` `mahactA_follow_`ᵀ `nekroFollowTech` `placeAgesMonument_` `primaryOfAnarchy1` `primaryOfAnarchy7` `primaryOfLumi7` `resolveAnarchy8Secondary` `reverseSpeakerOrder` `scepterE_follow_`ᵀ `anarchy7Build_` `constructionBuild_`**(2)** `lumi7Build_`
- **CommodityButtonHandler** (13): `convert_1_comms` `convert_2_comms`**(4)** `convert_2_comms_stay`**(1)** `convert_3_comms` `convert_4_comms` `gain_1_comms`**(3)** `gain_1_comms_stay` `gain_2_comms`**(3)** `gain_2_comms_stay`**(1)** `gain_3_comms` `gain_3_comms_stay` `gain_4_comms` `gain_4_comms_stay`
- **TransactionHelper** (11): `demandSomething_` `finishTransaction_` `offerToTransact_`**(3)** `resetOffer_`**(8)** `returnPNInPlayArea_` `sendOffer_`**(8)** `send_` `startReturnPNInPlayArea_` `transactWith_`**(12)** `transact_` `transaction_BMD`
- **AgendaHelper** (11): `refreshAgenda`**(61)** `eraseMyVote`**(211)** `exhaust_`ᵀᴹ `hack_election` `ministerOfWar`ᴹ `presetCommitteeFormation` `proceedToVoting`**(61)** `refreshVotes_` `removeCommitteeFormation` `retrieveAgenda_`**(117)**ᴹ `sendTGTo_`
- **UnitManagementButtonHandler** (9): `refreshLandingButtons`ᵀᴹ `doActivation_` `doneRemoving`ᵀ `genericModifyAllTiles_`**(6)** `genericModify_`**(5)** `genericRemove_` `genericBuild_`**(6)** `produceOneUnitInTile_` `removeAllStructures_`
- **GameOptionButtonHandler** (8): `anonDeclare_` `disableAidReacts` `enableAidReacts_` `injectRulesLinks_turnOFF`ᴹ `injectRulesLinks_turnON`ᴹ `showHexBorders_` `showOwnedPNsInPlayerArea_turnOFF`ᴹ `showOwnedPNsInPlayerArea_turnON`ᴹ
- **AgendaWhensAftersHelper** (8): `explainQueue` `pingNonresponders`**(61)** `no_after` `no_after_persistent` `no_when` `no_when_persistent` `play_after_` `play_when`
- **CommandCounterButtonHandler** (8): `confirm_cc` `gainCCNoDelete` `gain_CC`ᴹ `lose1CC` `placeCCBack_` `reinforcements_cc_placement_` `removeCCFromBoard_` `spendAStratCC`ᴹ
- **GamePhaseButtonHandler** (5): `setOrder` `startOfGameStrategyPhase` `temporaryPingDisable`**(31)** `non_sc_draw_so` `run_status_cleanup`ᴹ
- **GameSurveyService** (4): `noSupportSwaps` `purgeOverrule` `purgeSupports` `setLimitedWhispers`
- **StatusPhaseButtonHandler** (4): `forceACertainScoringOrder` `preScoreObbie_`**(91)** `reversepreScoreObbie_`**(2)** `turnOffForcedScoring`
- **TradeGoodButtonHandler** (4): `gain1tgFromCommander` `gain1tgFromLetnevCommander` `gain1tgFromMuaatCommander` `gain_1_tg`ᵀ
- **VanityButtonService** (3): `addVanityRole` `chooseVanityRole` `removeVanityRole`
- **EndGameButtonHandler** (3): `continuePlayingAfterEnd` `gameEnd` `gameEndConfirmation`
- **AgendaDocketButtonHandler** (3): `bidInfluence_` `breakDocketTie_` `reviseBid`
- **RiftUnitsHelper** (3): `getWeirdWormholeButtons_` `wormholeAllShips_` `wormholeUnit_`ᵀᴹ
- **CombatButtonHandler** (3): `applytempcombatmod__action_cards__`**(1)** `applytempcombatmod__tech__`ᴹ `pay1tgToAnnounceARetreat`
- **MiltyDraftButtonHandlers** (2): `draftPresetKeleres_`**(7)** `queueMilyPick_`**(513)**
- **TradeStationButtonHandler** (2): `startTradeStationConvert`**(29)** `useTradeStation`
- **AgendaRiderHelper** (2): `reverse_` `eraseMyRiders`**(61)**
- **RoundSummaryHelper** (2): `editEndOfRoundSummaries`**(34)** `editRoundSummary_`**(472)**
- **DoAnotherActionButtonHandler** (2): `doAnotherAction` `finishComponentAction`
- **ModifyUnitButtonHandler** (2): `getModifyTiles`**(134)** `modifyUnitsAllTiles`**(5)**
- **BombardmentButtonHandler** (2): `assignBombardUnit_`ᴹ `unassignBombardUnit_`ᴹ
- **ButtonHelperStats** (2): `convertComms_` `gainComms_`
- **AddFrontierTokensService** (1): `addFrontierTokens`
- **GalacticEventButtonHandler** (1): `enableDaneMode_`**(1)**ᵀᴹ
- **DraftButtonService** (1): `jwds_`**(19)**
- **CreateGameButtonHandler** (1): `launchGame`ᵀ
- **DraftSystemSettings** (1): `startDraftSystem`**(1)**
- **TradeStrategyCardButtonHandler** (1): `trade_primary`
- **RematchButtonHandler** (1): `rematch`
- **SwapFactionButtonHandler** (1): `swapToFaction_`
- **PlayerTitleHelper** (1): `bestowTitleStep2_`
- **TitlesHelper** (1): `offerToGiveTitles`
- **WarfareStrategyCardButtonHandler** (1): `beginTacticalTeWarfare`**(1)**ᴹ
- **PsychoarchaeologyButtonHandler** (1): `getPsychoButtons`
- **LeadershipStrategyCardButtonHandler** (1): `leadershipExhaust`
- **FollowStrategyCardButtonHandler** (1): `requestAllFollow_`
- **LookAgendaButtonHandler** (1): `agendaLookAt`
- **PoliticsStrategyCardButtonHandler** (1): `assignTyrant_`
- **ChecksAndBalancesButtonHandler** (1): `checksNBalancesPt2_`
- **ColonialButtonHandler** (1): `colonialRedTarget_`
- **SecretObjectiveButtonHandler** (1): `drawSpecificSO_`**(668)**
- **VoteButtonHandler** (1): `tiedPlanets_`
- **TacticalActionButtonHandlers** (1): `unitTacticalRemove`
- **ButtonHelperTacticalAction** (1): `useSafeHarbor`
- **CaptureButtonHandler** (1): `getReleaseButtons`
- **AssignHitsButtonHandlers** (1): `repairDamage_`ᴹ
- **PlayerPreferenceHelper** (1): `riskDirectHit_`ᵀᴹ
- **ConvertCommoditiesButtonHandler** (1): `convertAllComms`
- **IntegratedEconomyButtonHandler** (1): `integratedBuild_`
