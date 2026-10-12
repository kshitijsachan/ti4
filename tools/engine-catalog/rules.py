"""Classification rules: game area, content source, decision kind, owning agent.

Everything here is heuristic and ordered: first match wins. Keep rules readable;
the catalogue records which rule fired (`areaRule`, `kindRule`) so a migrating
agent can see why an entry landed where it did and override it.
"""

import re

# ---------------------------------------------------------------- agents
AGENTS = {
    'A01': ('setup-draft', 'Game creation, map setup, Milty/Franken/snake/package drafts, faction/colour/seat picks, FoW setup, Twilight\'s Fall splice drafting'),
    'A02': ('strategy-cards+tech', 'Technology research/acquisition, strategy-card pick, primary/secondary resolution, follow/decline, SC-specific prompts (Leadership CCs, Diplomacy, Politics speaker, Construction, Trade, Warfare, Technology, Imperial), alternate SC sets'),
    'A03': ('tactical-movement', 'Turn start/end, action choice, pass, system activation, movement, landing, command tokens (gain/lose/redistribute/place)'),
    'A04': ('combat', 'Space cannon, AFB, bombardment, space/ground combat rolls, hit assignment, retreats, capture, combat modifiers'),
    'A05': ('economy-production-trade', 'Production/building, paying costs (exhaust planets, spend TG/commodities), commodity gain/convert, transactions/trade deals and deal responses'),
    'A06': ('agenda', 'Agenda reveal, whens/afters queueing, voting (planets/TG votes), outcomes, riders, veto/elections, committee/docket'),
    'A07': ('status-scoring', 'Status phase: scoring public/secret objectives, secret draw/discard, readying, round transitions, end of game'),
    'A08': ('action-cards-promissory', 'Action-card draw/play/discard/sabotage and each card\'s resolution steps; promissory-note play/resolution'),
    'A09': ('exploration-relics', 'Exploration decks and card resolutions, attachments, relic fragments, relics, frontier tokens'),
    'A10': ('thunders-edge+factions', 'Thunder\'s Edge mechanics (breakthroughs, expeditions, TE-specific systems, galactic events, edicts) plus base/PoK/DS faction abilities and leaders that no other area claims'),
    'A11': ('utility-info-undo', 'Info/refresh panels, settings & preferences, pings, deck viewers, message cleanup (deleteButtons), undo; owns the generic chooseOption fallback and shared primitive kinds'),
}
AREA_TO_AGENT = {
    'setup/draft': 'A01', 'strategy cards': 'A02', 'tactical/movement': 'A03', 'combat': 'A04',
    'production/payment': 'A05', 'trade/transactions': 'A05', 'agenda': 'A06', 'status/scoring': 'A07',
    'action cards & promissory notes': 'A08', 'exploration/relics': 'A09', "thunder's edge": 'A10',
    'utility/info': 'A11', 'undo': 'A11', 'faction/leaders (unclassified)': 'A11', 'admin/tooling': 'A11',
}

# ---------------------------------------------------------------- content source
CONTENT_RULES = [
    (r'homebrew|theodisi|/acd2/|monuments|twilight_kart|ignis_aurora|Cryypter|beans|bluereverie|whispers', 'homebrew'),
    (r'TwilightsFall|twilightsfall|/tf|Splice|Veiled', 'twilights-fall'),
    (r'discordantstars|DSHelper|/ds/', 'discordant-stars'),
    (r'thundersedge|breakthrough|Breakthrough|/te/|TeHelper|Expedition', 'thunders-edge'),
    (r'/pok/', 'pok'),
    (r'/base/', 'base'),
    (r'fow|Fow|FoW', 'fog-of-war'),
]

# ---------------------------------------------------------------- areas
# matched against "prefix | file | method"
AREA_RULES = [
    ('undo', r'^(undo|ultimateUndo|restoreUndo|forceUndo)|undoPass|Undo\b|^eraseMy|undoLast'),
    ('admin/tooling', r'testbed|TestBed|bothelper|Bothelper|jimbo|Jimbo|combatReplay|combatSideBet|combatDoubleOrBust|/developer/|matchmaking|Matchmaking|statistics|Statistic|anonComms|AnonymousComms|/lore|LoreService|wrongButtonEphemeral|BigSelectDemo|^demo'),
    ('utility/info', r'^(refresh|show|offer[A-Z]\w*Info|cardsInfo|ping|notepad|playerPref|offerPlayerPref|setHourAsAFK|factionEmbedRefresh|deleteButtons|deleteMessage_|editMessage_|offerDeckButtons|showDeck|showTextOfDeck|showSpliceDecks|bestowTitle|expeditionInfo|getACFrom_?$|markResolved|explainQueue|gameInfo|info)|/info/|InfoButtonHandler|PlayerPreference|TitleHelper|TitlesHelper|refresh\w*Info|^.*Info$'),
    ('utility/info', r'^(fowOption|offerGameOptionButtons|offerTEOptionButtons|injectRulesLinks|editTags|addVanityRole|chooseVanityRole|enableAidReacts|disableAidReacts|UserSetPersonalPingIntervalTo|chooseMapView|checkExileView|getHomebrewButtons|offerGameHomebrew|editTFHomebrew|importMapFromJSON|answerSurvey_|forceARefresh_|generic_button_id_|genericReact|continuePlayingAfterEnd|enableDaneMode_|gameOption|showGameAgain|checkWHView|optionCategory)'),
    ('setup/draft', r'draft|Draft|milty|Milty|jmfA_|jwds_|setup|Setup|launchGame|signup|Signup|chooseExp_|SillyName|joinGameList|leaveGameList|addMapString|Hyperlane|createFoW|CreateGame|franken|Franken|Splice|splice|chooseHomeSystem|chooseStartingFleet|fixMahactColors|/milty/|/draft/|startPlayerSetup|selectFaction|SelectFaction|chooseFaction|factionSelect|colorSelect|BA_SELECT_COLOR|keepUnit_|participateInSplice|startFranken|blindSelection|BlindSelection|^setupStep|addFrontierTokens|AddTileList|Paradigm|eliminatePlayer|removePlayer|resendInvite|editPlayers'),
    ('agenda', r'agenda|Agenda|vote|Vote|outcome_|rider|Rider|^(play_when|play_after|no_when|no_after|queueWhen|queueAfter|queueAWhen|queueAnAfter|declineToQueue|lockAftersIn|unlockQueuedAfters|passOnEverythingWhensNAfters|pingNonresponders)|veto|Veto|elect|committee|Committee|docket|Docket|bidInfluence|reviseBid|distinguished|hack_election|proceedTo|flip_agenda|retrieveAgenda|discardAgenda|topAgenda|bottomAgenda|ministerOf|resolveWithNoEffect|autoresolve_|exhaustForVotes|sendTGTo_|presetCommittee|kaltrimAgenda|edynAgenda|outcome|Politics|politics'),
    ('action cards & promissory notes', r'actioncards|ActionCard|ac_play|ac_discard|^ac_|AC$|AC_|_AC|draw_1_AC|draw2 AC|drawActionCards|sabotage|Sabotage|no_sabotage|acPing|riseOfAMessiah|fighterConscription|promissory|Promissory|pnPlay|play_pn|PNUse|PNPlay|PNPlanet|^pn|resolvePNPlay|/acd2/|Acd2|getPlagiarize|getRepealLaw|getDivertFunding|^resolve(Counter|Summit|WarEffort|FreeTrade|Preparation|Rally|Reparations|Parley|DiplomaticPressure|ReactorMeltdown|Frontline|Unexpected|Distinguished|Uprising|AssReps|SignalJamming|SeizeArtifact|Plague|EBS|Blitz|Micrometeoroid|GhostShip|Probe|CrippleDefenses|Infiltrate|Spy|PS|Impersonation|Insub|Unstable|ABS|Salvage|InsiderInformation|EmergencyMeeting|RefitTroops|Upgrade|ProfessionalArcheologists|DecoyOperation|EmergencyRepairs|TacticalBombardment|Research|Reverse|Twin|Engineer|Locust|ReverseTF|ManipulateTF|Thieve|Create|Unravel|Coerce|Transpose|Scarab|Genophage|Magnificence|Ignis|Irradiate|StarFlare|Converge|Atomize|Mobilization)|Step\d_?$.*ActionCards|ButtonHelperActionCards|TwilightsFallActionCards|getDiscardButtonsACs|checkCombatACs|forceGiveAC|scuttle|luckyShot|courageous|forwardSupplyBase|focusedResearch|economicInitiative|industrialInitiative|miningInitiative|repealLaw|divertFunding|arcExp_'),
    ('exploration/relics', r'explore|Explore|relic|Relic|frag|Frag|attach|Attach|frontier|Frontier|purge_Frags|ruins|Ruins|exploration|nanoforge|prophetsTears|jrResolution|stealRelic|shrine|Shrine|dataSkimmer|DataSkimmer|warStories|freelancers|mirage|Mirage|^dmz|enigmatic|Codex|codex'),
    ("thunder's edge", r'thundersedge|TeHelper|breakthrough|Breakthrough|BT_|BT$|Bt_|bt_|BT\b|[a-z]BT|[a-z]Bt|expedition|Expedition|galacticevent|GalacticEvent|edict|Edict|/facilities/|Facility|facility|corefacility|Thunder|thunder|fracture|Fracture|deorbitBarrage|DeorbitBarrage|AlRaith|Deepgloom|Bastion|bastion|ralnel|Ralnel|keleres_te|/thundersedge/'),
    ('strategy cards', r'^(acquireA\w*Tech|getTech_|getAllTechOfType_|purgeTech_|nekroStealTech_|gloryTech|getKeleresTechOptions|c4redtech_|propagationResearch_|techSwap|swapTech|exhaustTech_|researchTech)|/tech/|TechButtonHandler|Technology'),
    ('strategy cards', r'^sc_|scPick|SCs?\b|SCs\.|/strategycard/|StrategyCard|strategyCard|leadership|Leadership|diploRefresh|diploSystem|Diplomacy|construction|Construction|warfare|Warfare|score_imperial|Imperial|imperial|anarchy|Anarchy|lumi7|primaryOf|preDeclineSC|getPreDeclineSC|_follow|follow_|reverseSpeakerOrder|nekroFollowTech|swapSCs|selectBeforeSwapSCs|increaseTGonSC|scepterE|mahactA_|thardentiag|placeAgesMonument|resolveManifest|addNewSCs|Speaker|speaker'),
    ('combat', r'/combat/|Combat|combat|hit|Hit|AFB|afb|bombard|Bombard|retreat|Retreat|declinePDS|spaceCannon|SpaceCannon|pdsOffense|PdsOffense|assignDamage|repairDamage|getDamageButtons|capture|Capture|release|Release|invasion|Invasion|groundCombat|dice|Dice|roll|Roll|announceReadyForDice|ambush|Ambush|assaultCannon|assCannon|mirved|gravleash|Gravleash|magenHit|ruthless|stealthcorps|destroy|Destroy|kill|Kill|nullificationField|becomeDamaged|repair|Repair'),
    ('trade/transactions', r'transaction|Transaction|transact|Transact|send_|sendTradeHolder|^trade|Trade|deal|Deal|offerTrade|giveTo|gift|Gift|^getNewTransaction|resolveAlliancePlanetTrade|resolveDMZTrade|hacanMechTrade|redCreussWash|sendVadenHero'),
    ('production/payment', r'produce|Produce|production|Production|build|Build|Prod\b|tacticalActionBuild|^exhaust_|spend|Spend|pay|Pay|^tg|TG|comm|Comm|convert|Convert|gain_\d|place_|placeOneNDone|starforge|Starforge|structure|Structure|spaceDock|space_dock|resources|influence|Resources|ready|Ready|exhaust|Exhaust'),
    ('status/scoring', r'score|Score|objective|Objective|secret|Secret|status|Status|^so_|_so_|SO\b|drawStatusACs|startScoring|round|Round|endOfRound|Summaries|cleanup|Cleanup|Heist|heist|PoToSo|endGame|gameEnd|winner|Endurance|proveEndurance|readyAll|reveal_stage|revealPO|revealObjective|publicDisgrace|imperium|Imperium|custodians|Custodians'),
    ('tactical/movement', r'tactical|Tactical|move|Move|landing|Landing|doneLanding|activate|Activate|ringTile|getTilesThisFarAway|doneWithTactical|_cc\b|_cc_|cc$|CC|commandcounter|CommandCounter|redistribute|Redistribute|startAction|passForRound|pass\b|endTurn|EndTurn|turnEnd|doAnotherAction|finishComponentAction|componentAction|ComponentAction|lose1CC|gain_CC|planet|Planet|tile|Tile|system|System|unit|Unit|ship|Ship|mech|Mech|infantry|Infantry|fighter|Fighter'),
    ('faction/leaders (unclassified)', r'.'),
]

# ---------------------------------------------------------------- decision kinds
# name -> (description, option schema, owner agent)
KINDS = {
    # --- turn & flow
    'chooseTurnAction': ('Start-of-turn menu: tactical / component / strategic action / pass / end turn, plus per-faction start-of-turn abilities', '{action: "tactical"|"component"|"strategic"|"pass"|"endTurn"|"ability", ref?: string}', 'A03'),
    'endTurn': ('End turn / done with action / do another action', '{}', 'A03'),
    # --- setup/draft
    'draftPick': ('Draft a slice / faction / seat / speaker order / package / splice card / draft item', '{itemType: "slice"|"faction"|"seat"|"speaker"|"homeSystem"|"package"|"card"|..., itemId: string}', 'A01'),
    'chooseFaction': ('Pick faction (setup)', '{faction: FactionId}', 'A01'),
    'chooseColor': ('Pick player colour', '{color: ColorId}', 'A01'),
    'configureGame': ('Game/draft settings menus (jmfA_ settings framework, options, expansions); host-only, not a game decision', '{settingPath: string, value: string}', 'A01'),
    # --- strategy cards
    'pickStrategyCard': ('Strategy phase card pick', '{card: number}', 'A02'),
    'followStrategyCard': ('Secondary of an SC played by someone else: follow (possibly a variant) or decline; every other player answers', '{card: number, follow: boolean, variant?: string}', 'A02'),
    'resolveStrategyCardPrimary': ('Primary ability steps of a strategy card (e.g. Diplomacy system, Politics speaker, Imperial score, Construction placement, Warfare CC)', '{card: number, step: string, choice: PlanetId|TilePos|FactionId|number|string}', 'A02'),
    # --- tactical
    'activateSystem': ('Choose system to activate', '{tile: TilePos}', 'A03'),
    'moveUnits': ('Movement step: pick units from a system to move (count, damaged state), done moving', '{fromTile: TilePos, unit: UnitType, count: number, damaged?: boolean} | {done: true}', 'A03'),
    'landUnits': ('Commit ground forces / land units on planets', '{planet: PlanetId, unit: UnitType, count: number} | {done: true}', 'A03'),
    'adjustCommandTokens': ('Gain/lose/redistribute command tokens across tactic/fleet/strategy pools; place/remove a CC on board', '{pool?: "tactic"|"fleet"|"strategy", delta?: number, tile?: TilePos}', 'A03'),
    # --- combat
    'combatRoll': ('Roll dice for a combat step (space cannon, AFB, bombardment, space/ground combat)', '{tile: TilePos, planet?: PlanetId, rollType: "spaceCannonOffence"|"spaceCannonDefence"|"afb"|"bombardment"|"space"|"ground"}', 'A04'),
    'assignHits': ('Assign produced hits: destroy/sustain specific units', '{tile: TilePos, planet?: PlanetId, unit: UnitType, count: number, mode: "destroy"|"sustain"} | {auto: true}', 'A04'),
    'retreat': ('Announce retreat / choose retreat destination', '{tile?: TilePos, announce?: boolean}', 'A04'),
    'combatModifier': ('Apply or decline a combat-time ability / modifier', '{source: string, apply: boolean}', 'A04'),
    # --- economy
    'produceUnits': ('Production: pick unit type + location (+ count)', '{unit: UnitType, location: PlanetId|TilePos, count: number} | {done: true}', 'A05'),
    'payCost': ('Pay a cost: exhaust planets for resources/influence, spend TG/commodities, done paying', '{exhaust?: PlanetId[], tg?: number, commodities?: number, done?: boolean}', 'A05'),
    'gainOrConvertCommodities': ('Gain commodities / convert commodities to TG / TG gain choices', '{op: "gain"|"convert", amount: number}', 'A05'),
    'transaction': ('Build or respond to a transaction (pick partner, items, accept/reject deal)', '{op: "propose"|"accept"|"reject"|"add"|"remove", with?: FactionId, item?: {type: "tg"|"comms"|"pn"|"ac"|"frag"|"planet"|..., id?: string, amount?: number}}', 'A05'),
    # --- agenda
    'whenAfterWindow': ('Agenda when/after (and generic reaction) window: play a card/ability, queue, or pass', '{play?: CardRef, pass?: boolean, persistent?: boolean}', 'A06'),
    'castVotes': ('Vote on an agenda: choose outcome and vote amount (planets to exhaust, extra votes) or abstain', '{outcome: string, votes?: number, planets?: PlanetId[], abstain?: boolean}', 'A06'),
    'chooseAgendaOutcome': ('Speaker/tie-break/resolve outcome, elect target, rider placement', '{outcome: string}', 'A06'),
    'placeRider': ('Play a rider on an outcome', '{rider: string, outcome: string}', 'A06'),
    # --- status
    'scoreObjective': ('Score a public or secret objective (or decline)', '{objective: ObjectiveId, secret: boolean} | {none: true}', 'A07'),
    'discardSecret': ('Choose secret objective to keep/discard/draw', '{so: SecretId}', 'A07'),
    # --- cards
    'playActionCard': ('Play an action card from hand (and its target steps start)', '{ac: ActionCardId}', 'A08'),
    'sabotageWindow': ('Sabotage/cancel window when an AC is played: sabotage or decline', '{sabotage: boolean, card?: string}', 'A08'),
    'discardActionCard': ('Discard down to hand limit / discard a chosen AC', '{ac: ActionCardId}', 'A08'),
    'resolveCardEffect': ('Multi-step resolution of a specific card/ability (AC, PN, relic, leader, faction ability): each step picks one typed target', '{source: CardRef, step: string, target: PlanetId|TilePos|FactionId|UnitType|number|string}', 'A08'),
    'playPromissoryNote': ('Play a promissory note', '{pn: PromissoryNoteId, target?: FactionId}', 'A08'),
    # --- exploration
    'explore': ('Choose planet/trait/frontier to explore, or a card choice within an explore result', '{planet?: PlanetId, trait?: "cultural"|"hazardous"|"industrial"|"frontier", choice?: string}', 'A09'),
    'useRelic': ('Purge/exhaust a relic or fragments; choose relic effects', '{relic: RelicId, choice?: string}', 'A09'),
    # --- tech / leaders / abilities
    'acquireTechnology': ('Research / gain / swap a technology', '{tech: TechId}', 'A02'),
    'useLeader': ('Exhaust agent / unlock commander / purge hero; pick its first target', '{leader: LeaderId, target?: FactionId|PlanetId|TilePos}', 'A10'),
    'useBreakthrough': ('Thunder\'s Edge breakthrough / expedition / TE-specific mechanic', '{source: string, step?: string, choice?: string}', 'A10'),
    # --- shared primitive selections (target of a pending effect)
    'choosePlanet': ('Pick a planet as the target of the pending effect', '{planet: PlanetId}', 'A11'),
    'chooseSystem': ('Pick a system (tile position) as the target of the pending effect', '{tile: TilePos}', 'A11'),
    'choosePlayer': ('Pick a player (faction/colour) as the target of the pending effect', '{player: FactionId}', 'A11'),
    'chooseUnit': ('Pick a unit type (optionally in a location) for the pending effect', '{unit: UnitType, tile?: TilePos, planet?: PlanetId}', 'A11'),
    'chooseAmount': ('Pick a number', '{amount: number}', 'A11'),
    'chooseCard': ('Pick a card (generic: from deck/discard/hand) for the pending effect', '{deck: string, card: string}', 'A11'),
    'confirm': ('Yes/No, Done, Decline, Accept/Reject for the pending effect', '{yes: boolean}', 'A11'),
    'textInput': ('Modal / free-text input', '{fields: {[id: string]: string}}', 'A11'),
    'chooseOption': ('Generic fallback: choose one of N labelled options with semantic tags', '{optionId: string} (options carry {id, label, tags: string[], refs: {planet?, tile?, faction?, unit?, card?, amount?}})', 'A11'),
    # --- non-decisions (keep out of the decision stream)
    'ui:info': ('Info/refresh/show panels - becomes a State query, not a decision', '-', 'A11'),
    'ui:dismiss': ('deleteButtons / Done(cleanup) - message hygiene; drop', '-', 'A11'),
    'ui:undo': ('Undo / restore save - engine command', '{undoTo?: string}', 'A11'),
    'ui:admin': ('Bot-admin/testbed/stats/minigames - not part of a game decision stream', '-', 'A11'),
}

# ordered (regex on prefix, kind)
KIND_PREFIX_RULES = [
    (r'^(deleteButtons|deleteMessage_|editMessage_|markResolved)', 'ui:dismiss'),
    (r'^exhaust_$', 'castVotes'),
    (r'^(componentActionRes_|componentAction$|getComponentActionButtons)', 'chooseTurnAction'),
    (r'^(undo|ultimateUndo|restoreUndo)', 'ui:undo'),
    (r'^scPick_', 'pickStrategyCard'),
    (r'^(sc_follow_|sc_no_follow_|preDeclineSC_|getPreDeclineSCButtons_|sc_follow_trade|sc_trade_follow|sc_draw_so|sc_refresh|sc_ac_draw|lumiACdraw|nekroFollowTech|diploRefresh2|anarchy\d*secondary|scepterE_follow_|mahactA_follow_|thardentiag_follow_|warfareBuild|construction_|anarchy2secondary)', 'followStrategyCard'),
    (r'^(sabotage_|no_sabotage)', 'sabotageWindow'),
    (r'^(play_when|play_after|no_when|no_after|queueWhen_|queueAfter_|queueAWhen|queueAnAfter|declineToQueue|passOnEverythingWhensNAfters|lockAftersIn|unlockQueuedAfters|no_when_persistent|no_after_persistent)', 'whenAfterWindow'),
    (r'^(rider_|planetRider_|reverse_)', 'placeRider'),
    (r'^(outcome_|exhaustForVotes_|resolveAgendaVote_|proceedToFinalizingVote|eraseMyVote|forceAbstainForPlayer_|refreshVotes_|resolvePreassignment_|bidInfluence_|reviseBid)', 'castVotes'),
    (r'^(agendaResolution_|autoresolve_|resolveWithNoEffect|breakDocketTie_|distinguished|resolveVeto|hack_election|flip_agenda|proceedToVoting|topAgenda_|bottomAgenda_|discardAgenda_|retrieveAgenda_)', 'chooseAgendaOutcome'),
    (r'^(tacticalAction|startAction|doAnotherAction|finishComponentAction|componentAction$|passForRound|turnEnd|endTurn|doneWithTacticalAction|confirmSecondAction)', 'chooseTurnAction'),
    (r'^(ringTile_|getTilesThisFarAway_)', 'activateSystem'),
    (r'^(tacticalMoveFrom_|unitTactical|moveUnit|doneMoving|resetTacticalMove|tacticalMove)', 'moveUnits'),
    (r'^(landUnits_|spaceUnits_|doneLanding|reverseLanding)', 'landUnits'),
    (r'^(redistributeCCButtons|increase_|decrease_|resetCCs|lose1CC|gain_CC|gainCCNoDelete|confirm_cc|reinforcements_cc|removeCCFromBoard_|placeCCBack_|spendAStratCC|leadershipGenerateCCButtons)', 'adjustCommandTokens'),
    (r'^(assignHits_|assignDamage_|repairDamage_|autoAssign\w*Hits|cancel\w*Hits|getDamageButtons_|ASSIGN_HITS|autoAssignGroundHits)', 'assignHits'),
    (r'^(combatRoll_|announceReadyForDice_|automateGroundCombat_|rollForAmbush_|bombardConfirm_|assignBombardUnit_|unassignBombardUnit_)', 'combatRoll'),
    (r'^(retreat|announceARetreat|pay1tgToAnnounceARetreat)', 'retreat'),
    (r'^(applytempcombatmod|declinePDS_)', 'combatModifier'),
    (r'^(produceUnit|tacticalActionBuild_|warfareTeBuild|constructionBuild_|freelancersBuild_|place_|placeOneNDone_|anarchy7Build_|lumi7Build_)', 'produceUnits'),
    (r'^(exhaust_|spend_|reduceTG_|reduceComm_|resetSpend|done_spending|finishProduction|deleteSpend|exhaustTech_)', 'payCost'),
    (r'^(gain_\d_comms|convert_\d_comms|convertAllComms|convertComms_|gainComms_|resolveHarness|gain_\d_tg|gainTG)', 'gainOrConvertCommodities'),
    (r'^(transaction|newTransact_|getNewTransaction_|offerToTransact|send_|sendTradeHolder_|rescindOffer|acceptOffer|rejectOffer|respondToOffer|transactWith|resolveAlliancePlanetTrade_|resolveDMZTrade_)', 'transaction'),
    (r'^(score_imperial|scoreObjective|scorePublic|scoreSecret|score_|drawHeistObj_|revealHeistObj|scoreOtherPlayersSecrets|scoreOtherPsSO|autoProveEndurance_)', 'scoreObjective'),
    (r'^(discardSecret|so_discard|keepSecret|sc_draw_so|drawSpecificSO|dealSO)', 'discardSecret'),
    (r'^(ac_play_from_hand_|play_ac|playAC|ac_play)', 'playActionCard'),
    (r'^(ac_discard_from_hand_|getDiscardButtonsACs|discardAC|ac_discard)', 'discardActionCard'),
    (r'^(play_pn|pnPlay|resolvePNPlay|playPN)', 'playPromissoryNote'),
    (r'^(explore|resolveExp|exploreFront_|resolveRuins|planetExplore|warStoriesPlanetExplore)', 'explore'),
    (r'^(purge_Frags_|relic|useRelic|purgeRelic|exhaustRelic|jrResolution_|prophetsTears_|nanoforgePlanet_)', 'useRelic'),
    (r'^(acquireATech|acquireAFreeTech|getTech_|getAllTechOfType_|swapTechs|researchTech|tech_)', 'acquireTechnology'),
    (r'^(exhaustAgent_|purgeHero|unlockCommander|exhaustLeader|useLeader|leaderUse|purge\w*Hero)|(Agent|Commander|Hero)(Step\d)?_?$|^\w+(Agent|Commander|Hero)(Step\d+|Part\d+|Res|Resolution|In|On|Build|Select|Kill|Target|Use)?_?$', 'useLeader'),
    (r'(Info$|^refresh|^show|Info_?$|^cardsInfo|^offerDeckButtons|^offerPlayerPref|^playerPref|^ping|^notepad|^factionEmbedRefresh|^setHourAsAFK|^explainQueue|^gameInfo)', 'ui:info'),
    (r'^(jmfA_|enableDaneMode_|playerPref|chooseExp_|launchGame|signupModal|joinGameList|leaveGameList|addMapString|customHyperlane)', 'configureGame'),
]

AGENT_AREA = {'A01': 'setup/draft', 'A02': 'strategy cards', 'A03': 'tactical/movement', 'A04': 'combat',
              'A05': 'production/payment', 'A06': 'agenda', 'A07': 'status/scoring',
              'A08': 'action cards & promissory notes', 'A09': 'exploration/relics', 'A10': "thunder's edge",
              'A11': 'utility/info'}

# area-level kind defaults, used when no prefix rule fires and the grammar is not decisive
AREA_DEFAULT_KIND = {
    'setup/draft': 'draftPick', 'strategy cards': 'resolveStrategyCardPrimary', 'tactical/movement': 'chooseOption',
    'combat': 'chooseOption', 'production/payment': 'chooseOption', 'trade/transactions': 'transaction',
    'agenda': 'chooseOption', 'status/scoring': 'chooseOption', 'action cards & promissory notes': 'resolveCardEffect',
    'exploration/relics': 'explore', "thunder's edge": 'useBreakthrough', 'utility/info': 'ui:info', 'undo': 'ui:undo',
    'faction/leaders (unclassified)': 'resolveCardEffect', 'admin/tooling': 'ui:admin',
}

FIELD_KIND = [
    ({'planet'}, 'choosePlanet'),
    ({'tilePos'}, 'chooseSystem'),
    ({'faction'}, 'choosePlayer'),
    ({'color'}, 'choosePlayer'),
    ({'player'}, 'choosePlayer'),
    ({'unit'}, 'chooseUnit'),
    ({'n'}, 'chooseAmount'),
]

CONFIRM_RE = re.compile(r'(decline|Decline|^no_|^yes|accept|Accept|reject|Reject|done|Done|cancel|Cancel|confirm|Confirm|pass|Pass|skip|Skip|^dont|^doNot|^not)')
STEP_RE = re.compile(r'(Step|step|Part|part|Stage)\d|Res_?$|Resolution|resolve|Resolve')


def match_area(prefix, file, method):
    """Three passes: the id prefix is the most semantic signal, then handler method name, then file path."""
    for label, text in (('prefix', prefix or ''), ('method', method or ''), ('file', file)):
        for area, pat in AREA_RULES[:-1]:
            if re.search(pat, text):
                return area, label
    return 'faction/leaders (unclassified)', None


def match_content(file):
    for pat, c in CONTENT_RULES:
        if re.search(pat, file):
            return c
    return 'core'


def match_kind(prefix, area, fields, method):
    p = prefix or ''
    for pat, kind in KIND_PREFIX_RULES:
        if re.search(pat, p):
            return kind, 'prefix:' + pat[:40]
    if area in ('utility/info', 'undo', 'admin/tooling'):
        return AREA_DEFAULT_KIND[area], 'area'
    if area == 'setup/draft':
        if re.search(r'olor', p):
            return 'chooseColor', 'name'
        if re.search(r'[Ff]action', p) and 'select' in p.lower():
            return 'chooseFaction', 'name'
        if re.search(r'jmfA|jwds|setting|Setting|Settings', p + (method or '')):
            return 'configureGame', 'name'
        return 'draftPick', 'area'
    if CONFIRM_RE.search(p) and not fields:
        return 'confirm', 'name'
    fs = set(fields)
    for need, kind in FIELD_KIND:
        if fs and need <= fs and len(fs - {'n'} - need) == 0:
            if area == 'tactical/movement' and kind == 'chooseSystem':
                return 'activateSystem' if 'activat' in p.lower() else kind, 'fields'
            return kind, 'fields'
    if fs & {'planet', 'tilePos', 'faction', 'color', 'unit', 'player'}:
        # multiple typed fields: area-specific multi-field kind or typed card-effect step
        if area == 'combat':
            return 'assignHits' if re.search(r'hit|Hit|destroy|kill', p) else 'combatModifier', 'area+fields'
        if area == 'production/payment':
            return 'produceUnits' if re.search(r'uild|roduc|place', p) else 'payCost', 'area+fields'
        if area == 'tactical/movement':
            return 'moveUnits' if re.search(r'ove|ship|Ship', p) else 'resolveCardEffect', 'area+fields'
        return 'resolveCardEffect', 'fields-multi'
    if area in ('action cards & promissory notes', 'faction/leaders (unclassified)', 'exploration/relics', "thunder's edge") and STEP_RE.search(p):
        return AREA_DEFAULT_KIND[area], 'area+step'
    return AREA_DEFAULT_KIND.get(area, 'chooseOption'), 'area-default'
