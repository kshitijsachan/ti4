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
  "setup.preference": "optional",
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
  "promissory_note.play": "optional",
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
  return (KIND_CLASS[d.kind] ?? "blocking") !== "optional";
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

/** The last-resort answer: a passive option, else the first legal non-destructive one; null when there is none. */
export function chooseFallback(d: Decision, state: GameState | null, me: string): { option: Option<any>; why: string } | null {
  const pick = fallbackCandidates(d, state, me)[0];
  if (!pick) return null;
  return { option: pick, why: `fallback: no specific policy answered ${d.kind}; pressed "${pick.label || pick.id}"` };
}
