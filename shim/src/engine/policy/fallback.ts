/**
 * Last-resort bot policy: a typed decision that waits on a bot seat and that no specific policy answered still gets a
 * legal, non-destructive answer, so no game ever waits on a bot. Pure: (decision, state, me) → option | null.
 *
 * Order: a passive answer (decline / pass / no / done / ready / continue …) first, else the first legal option that
 * is not destructive. Never: undo, cancel, delete, reset, rescind, purge, discard, destroy, queueing a card, info /
 * settings menus, needs-input options, or another faction's / another player's option. Every use is logged by the
 * caller ("fallback: …") so a specific policy can be added for that kind.
 *
 * When it applies (see fallbackDue): never for optional offers (a pre-play / queue / "play an action card" menu the
 * game does not wait for) unless they carry a reaction window; after FALLBACK_GRACE_MS for kinds whose specific
 * policy never waits on purpose; after FALLBACK_FORCE_MS (the shim watchdog) for kinds whose policy, or the planner,
 * may deliberately hold the answer (combat rolls ahead of the opponent, a strategy card primary waiting for its
 * sub-prompt, the tactical planner, payment / production).
 */
import { followWaits, turnStale, unplayedCards } from "./turn.js";
import type { TurnActionValue } from "../kinds/tactical.js";
import { awaits, optionsFor, type Decision, type DecisionKind, type GameState, type Option } from "../types.js";

/** Kinds with no specific policy that would wait on purpose: answered by the fallback this soon. */
export const FALLBACK_GRACE_MS = 5_000;
/** Kinds whose policy or planner may hold an answer on purpose: the watchdog forces the fallback after this long. */
export const FALLBACK_FORCE_MS = 60_000;

/**
 * optional: the game does not wait for it (offers / queues / info); the fallback leaves it unless it has a window.
 * planner: its policy or the planner may hold the answer on purpose; fallback only when forced (FALLBACK_FORCE_MS).
 * blocking: the game may wait for it; fallback after FALLBACK_GRACE_MS.
 * Record<DecisionKind, …>: a new kind fails to compile until it is classified here.
 */
export const KIND_CLASS: Record<DecisionKind, "optional" | "planner" | "blocking"> = {
  legacy: "optional",
  "input.form": "blocking",
  // G1 setup / draft
  "draft.milty.pick": "planner",
  "draft.milty.queue": "optional",
  "draft.milty.info": "optional",
  "setup.player": "blocking",
  "setup.keleres_flavor": "planner", // the draft-time preset is optional; after the draft the setup policy answers
  "setup.keleres_tech": "planner",
  "setup.deal_secrets": "planner",
  "setup.reveal_objectives": "planner",
  "player.preference": "optional",
  "setup.game_settings": "optional",
  "tech.choose_type": "planner",
  "tech.gain": "planner",
  "secret_objective.discard": "planner",
  // G2 strategy cards
  "strategy_card.pick": "blocking",
  "strategy_card.queue_pick": "optional",
  "strategy_card.pre_decline": "optional",
  "strategy_card.resolve": "planner",
  "strategy_card.strategic_action": "planner",
  "strategy_card.diplomacy_system": "blocking",
  "strategy_card.politics_speaker": "blocking",
  "strategy_card.politics_agenda": "blocking",
  "strategy_card.construction_place": "blocking",
  "planet.ready": "planner",
  // G3 tactical
  "turn.action": "planner",
  "tactical.activate": "planner",
  "tactical.move": "planner",
  "tactical.land": "planner",
  "tactical.conclude": "planner",
  "tactical.rift": "blocking",
  // G4 combat
  "combat.round": "planner",
  "combat.hits": "planner",
  "combat.assign_units": "planner",
  "combat.retreat": "blocking",
  // G5 production / payment
  "payment.spend": "planner",
  "production.produce": "planner",
  // G6 agenda (whens / afters / pre-assignments without a window are offers; with one, the table waits)
  "agenda.when": "optional",
  "agenda.after": "optional",
  "agenda.preassign": "optional",
  "agenda.shenanigans": "blocking",
  "agenda.vote": "planner",
  "agenda.vote_step": "planner",
  "agenda.tiebreak": "blocking",
  "agenda.resolve": "planner",
  "agenda.rider": "blocking",
  "agenda.next": "planner",
  // G7 status
  // The table scoring prompt carries a window (so it is blocking); Imperial's own scoring list is an offer.
  "status.score": "optional",
  "status.score_secret": "blocking",
  "status.reveal_objective": "blocking",
  "status.homework": "planner",
  "status.advance": "planner",
  "status.imperial": "blocking",
  "command_tokens.adjust": "planner",
  // G8 cards
  "action_card.play": "optional",
  "action_card.sabotage": "blocking",
  "action_card.discard": "optional", // an owed discard is answered by the cards policy at once; the rest are stale asks
  "action_card.draw": "planner",
  "action_card.resolve": "blocking",
  "action_card.target": "blocking",
  "action_card.preassign": "optional",
  "action_card.step": "blocking", // C7: follow-up steps of a card already played (like action_card.target)
  "action_card.when_after": "optional", // C7: non-queued agenda whens / afters (offers, like agenda.when / after)
  "promissory_note.play": "optional",
  "promissory_note.resolve": "blocking", // C7: a played note's follow-up step (Acquiescence offer is declined)
  // G9 exploration
  "explore.planet": "blocking",
  "explore.card_pick": "blocking",
  "explore.frontier": "blocking",
  "explore.outcome": "blocking",
  "relic.fragments": "blocking",
  "relic.draw": "blocking",
  // G10 Thunder's Edge
  "te.fracture.roll": "blocking",
  "te.fracture.ingress": "blocking",
  "te.galvanize": "planner",
  "te.expedition": "blocking",
  "te.thunders_edge.place": "blocking",
  "te.visionaria.respond": "blocking",
  // G11 trade
  "trade.offer": "blocking",
  "trade.offer_sent": "optional",
  "trade.force_replenish": "blocking",
  // C1-C5 factions: the faction policy answers; abilities / leaders are often optional, so fallback only when forced
  "faction.ability": "planner",
  "leader.use": "planner",
  // C5 Thunder's Edge faction steps
  "te.breach": "planner",
  "te.breakthrough": "planner",
  "te.plot": "planner",
  // C12 perpetual prompts: affordances / info menus are never answered; select-only prompts by their policy
  "ui.undo_affordance": "optional",
  "ui.optional": "optional",
  "ui.info_menu": "optional",
  "choose.select": "planner",
  // C6 components: generic single-choice steps (the components policy answers our own at once); menus / relic offers
  "choose.planet": "blocking",
  "choose.system": "blocking",
  "choose.player": "blocking",
  "choose.unit": "blocking",
  "choose.card": "blocking",
  "choose.confirm": "blocking",
  "component.action": "optional",
  "relic.use": "optional",
  // C8 core tails
  "combat.bombard": "planner",
  "units.remove": "planner", // an over-limit reminder is the unit-limit desk's (pbd114): the fallback only when forced
  "production.place": "blocking",
  "commodities.gain": "blocking",
  // C6b tech follow-ups (the components policy answers our own: free gains taken, the rest declined)
  "tech.step": "blocking",
  // C8b
  "units.modify": "optional", // Modify Units menu: opened by the player
  "combat.automate": "blocking", // automate-ground-combat vote / confirm
  "combat.engage": "blocking", // engage in combat or coexist (combatPolicy engages)
  "combat.modifier": "optional",
  "strategy_card.construction_build": "blocking",
};

const WEAK_TARGET = new Set(["mention", "recent_press", "active_player", "none", "mixed_owners"]);

/** Typed answers that move on without doing anything costly. Ranked: earlier is preferred. */
const PASSIVE_ACTIONS = ["decline", "pass", "no_public", "no_secret", "no_effect", "abstain", "reject", "done", "end_turn", "ready", "continue", "conclude", "decline_space_cannon"];
const PASSIVE_LABEL = /^(decline|pass\b|no\b|not following|don'?t\b|do not\b|skip|done|end turn|ready|continue|conclude|refuse|reject|move on)/i;
/** Never pressed by the fallback (value.action). */
const DESTRUCTIVE_ACTIONS = new Set([
  "cancel",
  "reset",
  "purge",
  "destroy",
  "destroy_all",
  "destroy_all_ships",
  "rescind",
  "queue",
  "restart",
  "restart_all",
  "back",
  "force_abstain",
  "lock",
  "ask_again",
  "ungalvanize",
  "retreat",
  "retreat_to",
  "retreat_ground",
  "announce_retreat",
  "assign_manual",
  "manual",
  "wait",
]);
/** Never pressed by the fallback (handler id without owner prefix): take-backs, info / settings menus, queues. */
const DESTRUCTIVE_HANDLER =
  /(undo|cancel|^delete(?!Buttons)|rescind|purge|erase|reset|discard|destroy|^remove|unqueue|queue|^transaction$|getModifyTiles|showMap|showPlayerAreas|offerPlayerPref|searchMyGames|showObjInfo|chooseMapView|refresh|notepad|cardsInfo|requestAll|pingNon|~MDL|forceAbstain|^sabotage|ac_play_from_hand|getDiscardButtonsACs|editRoundSummary|offerDeckButtons|gameInfoButtons|showGameAgain)/i;
const DESTRUCTIVE_LABEL = /(\bundo\b|\bcancel|\bdelete|rescind|\bpurge|\berase|\breset|\bdiscard|\bdestroy|\bremove\b|\bsabotage|\bun-?queue|be asked again)/i;

/** The faction an option is locked to (FFCC_<faction>_…), if any. */
const lockOf = (id: string) => /^FFCC_([^_]+)_/.exec(id)?.[1] ?? null;
const sameFaction = (a: string, b: string) => a === b || a.startsWith(b) || b.startsWith(a);

/**
 * Never another player's option: a per-option owner that is someone else, a dummy seat's copy, or an owner lock
 * (FFCC_<faction>_) of another faction. With our faction unknown (setup), a lock is ours only on a prompt targeted at us.
 */
export function mayPress(o: Option<any>, d: Decision, state: GameState | null, me: string): boolean {
  if (o.owner?.userId && o.owner.userId !== me) return false;
  if (o.id.includes("dummyPlayerSpoof")) return false;
  const lock = lockOf(o.id);
  if (!lock) return true;
  const faction = state?.players.find((p) => p.userId === me)?.faction ?? (d.target?.userId === me ? d.target.faction : null);
  if (faction) return sameFaction(lock, faction);
  return d.target?.userId === me;
}

/** Whether `me` already has the whole supply of that structure on the board (unknown board: no). */
export function overSupply(unit: "spacedock" | "pds", state: GameState | null, me: string): boolean {
  const self = state?.players.find((p) => p.userId === me);
  if (!state || !self) return false;
  const id = unit === "spacedock" ? "sd" : "pd";
  let n = 0;
  for (const t of state.tiles) for (const h of t.holders) for (const u of h.units) if ((u.owner === self.faction || u.color === self.color) && u.unit === id) n += u.count;
  return n >= (unit === "spacedock" ? 3 : 6);
}

/** Options of `d` the fallback may press for `me`, passive ones first. */
export function fallbackCandidates(d: Decision, state: GameState | null, me: string): Option<any>[] {
  const opts = (optionsFor(d, me) as Option<any>[]).filter((o) => {
    if (o.disabled || o.needsInput) return false;
    if (!mayPress(o, d, state, me)) return false;
    const action = typeof o.value?.action === "string" ? (o.value.action as string) : null;
    if (action && DESTRUCTIVE_ACTIONS.has(action)) return false;
    // Claims the engine says we cannot make (an objective we do not meet, a secret not met).
    if (Array.isArray(o.value?.eligible) && !(o.value.eligible as unknown[]).includes(me)) return false;
    if (o.value?.met === false) return false;
    // A structure past the unit supply (3 space docks / 6 PDS: pbd171's 4th space dock).
    if (d.kind.startsWith("strategy_card.") && (o.value?.unit === "spacedock" || o.value?.unit === "pds") && overSupply(o.value.unit, state, me)) return false;
    const handler = (o.handler || o.id).replace(/^FFCC_[^_]+_/, "");
    // A discard prompt's options are discards: that is the answer it asks for.
    const discardKind = d.kind.endsWith(".discard") && /discard/i.test(handler);
    if (DESTRUCTIVE_HANDLER.test(handler) && !discardKind) {
      // deleteButtons… doubles as "Done" / "Decline"; it is fine when the label says so.
      if (!/^deleteButtons/i.test(handler) || !PASSIVE_LABEL.test(o.label.trim())) return false;
    }
    // "No Sabotage", "Done Removing Units": a passive answer may name what it declines.
    const passive = (!!action && PASSIVE_ACTIONS.includes(action)) || PASSIVE_LABEL.test(o.label.trim());
    if (DESTRUCTIVE_LABEL.test(o.label) && !passive && !discardKind) return false;
    return true;
  });
  const rank = (o: Option<any>) => {
    const action = typeof o.value?.action === "string" ? (o.value.action as string) : null;
    const i = action ? PASSIVE_ACTIONS.indexOf(action) : -1;
    if (i >= 0) return i;
    if (PASSIVE_LABEL.test(o.label.trim())) return PASSIVE_ACTIONS.length;
    // Turn menu: a strategy card owed is played first; starting a tactical / component action we did not plan is
    // the very last thing to do.
    if (action === "strategic") return 50;
    if (action === "tactical" || action === "component") return 300;
    // Typed options before untyped ones; otherwise keep the engine's order.
    return o.value ? 100 : 200;
  };
  return opts.map((o, i) => ({ o, i, r: rank(o) })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.o);
}

/** Does `d` wait on `me` (target, or a window that has not had my answer)? */
export function waitsOn(d: Decision, me: string): boolean {
  if (d.window) return awaits(d, me);
  return d.scope === "player" && d.target?.userId === me;
}

/** Is the decision one the game may wait on (not an optional offer)? */
export function isBlocking(d: Decision): boolean {
  if (d.window) return true;
  if (isBackgroundPanel(d)) return false;
  return (KIND_CLASS[d.kind] ?? "blocking") !== "optional";
}

/**
 * A bookkeeping panel nobody waits on although its kind is otherwise blocking: the Firmament / Obsidian plot panel on
 * the cards-info thread (te.plot, every typed option panel=true). It stays open for good (the cards-info message is
 * edited in place), so the watchdog forced the fallback on it every FALLBACK_FORCE_MS (live pbd161: "Seethe" pressed
 * 4x after 582 s, each press adding a puppet through the faction picker that followed). Neither the fallback nor the
 * watchdog acts on it.
 */
export function isBackgroundPanel(d: Decision): boolean {
  if (d.kind !== "te.plot") return false;
  const typed = (d.options as Option<any>[]).filter((o) => o.value);
  return typed.length > 0 && typed.every((o) => o.value.panel === true);
}

/**
 * Whether the fallback may answer now: it waits on me, it is not an optional offer, and it has waited long enough
 * (waitedMs: how long it has awaited this seat; force: the watchdog's re-evaluation).
 */
export function fallbackDue(d: Decision, me: string, opts: { waitedMs?: number; force?: boolean }): boolean {
  if (!waitsOn(d, me) || !isBlocking(d)) return false;
  if (opts.force) return true;
  // A weakly resolved target (a mention, whoever pressed last) is not certainly ours: only the watchdog answers it.
  if (!d.window && WEAK_TARGET.has(d.target?.resolvedBy ?? "none")) return false;
  const waited = opts.waitedMs ?? 0;
  return KIND_CLASS[d.kind] === "planner" ? waited >= FALLBACK_FORCE_MS : waited >= FALLBACK_GRACE_MS;
}

/**
 * A decision that still lists this seat but that the game no longer waits on (the engine has not closed it yet):
 * - turn.action outside our own action-phase turn: another player active (pbd86, pbd160: "It is not your turn"),
 *   another phase (pbd42: "The action phase is over"), or no state to tell (policy/turn.ts turnStale);
 * - "Setup a Player" once we are seated; the draft-time Keleres preset once we play a flavour;
 * - a bombardment / barrage hits opener once its fight has rolled a round;
 * - an agent prompt once that agent of ours is exhausted;
 * - a combat roll window whose fight is over or is not the combat on the board (pbd60: rounds of a finished space
 *   combat stayed open with us "eligible"; the fallback pressed "Check Combat Action Cards" / rolled them).
 * Neither the fallback nor the watchdog acts on it. Needs the state; without one nothing is stale.
 */
export function staleForBot(d: Decision, state: GameState | null, me: string): boolean {
  // Turn menus: only during our own action-phase turn (policy/turn.ts; without a state, never).
  if (d.kind === "turn.action") return turnStale(d, state, me);
  if (!state) return false;
  // The tactical action's own prompts (move / land / conclude / activate / rift) belong to the active player's turn: a
  // copy left over after the turn ended (status phase, another player active, we passed) waits on nobody (live
  // pbd181 02:11: "Conclude Tactical Action" / "Done moving" from the previous round pressed during the status phase).
  if (d.kind.startsWith("tactical.")) {
    if (state.phase !== "action" || state.activePlayer !== me) return true;
    return !!state.players.find((p) => p.userId === me)?.passed;
  }
  // "Setup a Player" stays up after it is pressed: once we are seated it asks nothing of us (pbd147).
  // Manual player setup needs a map ("After setting up the map, you may use this button"): on a fresh game the
  // steward (solo.ts: expansion → Milty draft) is still choosing how to set up, and the bots must not race it (live
  // pbd182: five bots pressed "Setup a Player" 13 times and all chose Arborec / green before any map existed).
  if (d.kind === "setup.player" && !state.tiles.length) return true;
  if (d.kind === "setup.player" && d.options.every((o) => !o.value || (o.value as { step?: string }).step === "start")) {
    return !!state.players.find((p) => p.userId === me)?.faction;
  }
  // An agent prompt ("Use on <player>": exhaustAgent_<agent>_…) once that agent of ours is exhausted: each press
  // re-runs the agent's effect (pbd31: the Winnu agent's buttons on a spent payment, pressed 783 times).
  if (d.kind === "leader.use") {
    const typed = d.options.filter((o) => o.value && !/^(deleteButtons|ultimateUndo)/.test(o.handler));
    const agents = typed.map((o) => o.value as { step?: string; leader?: string });
    if (!agents.length || agents.some((v) => v.step !== "exhaustAgent" || !v.leader)) return false;
    const leaders = state.players.find((p) => p.userId === me)?.leaders ?? [];
    return agents.every((v) => leaders.includes(`${v.leader}:exhausted` as never));
  }
  // A milty board whose every pick is a category we already hold (live pbd223: our faction and speaker boards stayed
  // open while we owed a slice, the watchdog pressed them, both refused "You already drafted…", the draft stalled).
  // Not waiting on us; the shim re-snapshots the draft instead (autopilot draftResnapshot).
  if (d.kind === "draft.milty.pick") return draftBoardStale(d, state, me);
  // The draft-time Keleres preset once we play a flavour (pbd175: still open in setup, reported as a stall).
  if (d.kind === "setup.keleres_flavor" && d.options.some((o) => (o.value as { preset?: boolean } | null)?.preset)) {
    const f: string = state.players.find((p) => p.userId === me)?.faction ?? "";
    return f.startsWith("keleres") && f !== "keleres";
  }
  // Hits taken before a fight (bombardment before ground combat, anti-fighter barrage before space combat) are past
  // once that fight has rolled a round in the system (pbd60: a bombardment opener re-pressed every minute after a
  // 6-round ground combat). Same rule as the bot's UnitsRemoveKind.obsolete.
  if (d.kind === "units.remove") {
    const openers = d.options.filter((o) => (o.value as { action?: string } | null)?.action === "open").map((o) => o.value as { tile: string; assignType: string });
    if (!openers.length || openers.some((v) => v.assignType !== "bombardment" && v.assignType !== "afb")) return false;
    return openers.every((v) => {
      const combat = state.combat;
      if (!combat || combat.tile !== v.tile) return false;
      const space = v.assignType === "afb";
      return combat.fronts.some((f) => (f.holder === "space") === space && f.sides.some((side) => side.roundsRolled > 0));
    });
  }
  // Secret objective list in the status phase once we declared this round's secret (or "none"): every option is
  // refused, "You already declared your secret objective this round" (pbd160, re-pressed for 20 min).
  if (d.kind === "status.score_secret" && state.status) {
    const declared = state.status.players[me]?.secretScored;
    if (declared !== null && declared !== undefined) return true;
  }
  if (d.kind === "combat.round") {
    const w = d.window;
    if (!w || w.kind !== "combat_roll") return false;
    const subject = w.subject as Record<string, unknown>;
    const combat = state.combat;
    if (!combat || String(subject.tile ?? "") !== combat.tile) return true;
    if (subject.rollType !== "combat") return false;
    const front = combat.fronts.find((f) => f.holder === String(subject.holder ?? ""));
    if (!front) return true;
    return front.sides.length < 2 || front.sides.some((side) => !side.units.length);
  }
  return false;
}

/** A draft.milty.pick board that offers us nothing we still need (or it is not our pick). */
export function draftBoardStale(d: Decision, state: GameState, me: string): boolean {
  const draft = state.draft;
  if (!draft) return false;
  if (draft.status !== "drafting" || draft.currentPlayer !== me) return true;
  const mine = draft.players.find((p) => p.userId === me);
  if (!mine) return false;
  const held: Record<string, unknown> = { faction: mine.faction, slice: mine.slice, order: mine.speakerOrder };
  return d.options.every((o) => {
    const category = (o.value as { category?: string } | null)?.category;
    return !category || held[category] != null;
  });
}

/**
 * The draft categories we still owe on our milty turn that no open draft.milty.pick decision offers (empty when it
 * is not our pick, or every owed category has a board).
 */
export function draftBoardsMissing(open: Decision[], state: GameState | null, me: string): string[] {
  const draft = state?.draft;
  if (!draft || draft.status !== "drafting" || draft.currentPlayer !== me) return [];
  const mine = draft.players.find((p) => p.userId === me);
  if (!mine) return [];
  const held: Record<string, unknown> = { faction: mine.faction, slice: mine.slice, order: mine.speakerOrder };
  const owed = ["slice", "faction", "order"].filter((c) => held[c] == null);
  const offered = new Set(
    open
      .filter((d) => d.kind === "draft.milty.pick")
      .flatMap((d) => d.options.filter((o) => !o.disabled).map((o) => (o.value as { category?: string } | null)?.category)),
  );
  return owed.filter((c) => !offered.has(c));
}

/** The last-resort answer: a passive option, else the first legal non-destructive one; null when there is none. */
export function chooseFallback(d: Decision, state: GameState | null, me: string): { option: Option<any>; why: string } | null {
  if (staleForBot(d, state, me)) return null;
  // Turn menus: never start an unplanned tactical / component action, never pass with a strategy card unplayed.
  if (d.kind === "turn.action") {
    // (No `open` here: chooseFallback has no view of our other decisions; the shim's engineStep skips turn menus while
    // an action is in flight or the planner is busy.)
    // A follow window holds the turn (policy/turn.ts followWaits): never press the refused end / pass.
    const held = followWaits(d.options as Option<TurnActionValue>[]).length > 0;
    const pick = fallbackCandidates(d, state, me).find((o) => {
      const action = o.value?.action;
      if (held) return action === "end_turn_when_followed";
      if (action === "end_turn" || action === "strategic") return true;
      return action === "pass" && !unplayedCards(state, me).length;
    });
    return pick ? { option: pick, why: `fallback: no specific policy answered ${d.kind}; pressed "${pick.label || pick.id}"` } : null;
  }
  let candidates = fallbackCandidates(d, state, me);
  // In the status phase only status-phase secrets score (the engine refuses action / agenda ones: "… is not scored in
  // the status phase"); an objective the engine cannot judge (met: null) is not claimed blind either.
  if (d.kind === "status.score_secret") {
    candidates = candidates.filter((o) => o.value?.met === true && (!state?.status || o.value.phase === "status"));
  }
  // A combat round asks for dice: the fallback rolls the window's own roll or nothing (never "Check Combat Action
  // Cards", "Repair Damage", "Declare Ready", another roll type).
  if (d.kind === "combat.round" && d.window?.kind === "combat_roll") {
    const rollType = String((d.window.subject as Record<string, unknown>).rollType ?? "");
    candidates = candidates.filter((o) => o.value?.action === "roll" && o.value.rollType === rollType);
  }
  const pick = candidates[0];
  if (!pick) return null;
  return { option: pick, why: `fallback: no specific policy answered ${d.kind}; pressed "${pick.label || pick.id}"` };
}
