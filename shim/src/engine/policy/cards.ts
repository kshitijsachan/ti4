/**
 * Autopilot policy for action cards and promissory notes (G8). Conservative: never plays a card or a note on its
 * own initiative, always passes Sabotage windows promptly (never stalls one), discards only what it owes (hand limit,
 * Scheming), and finishes any card prompt addressed to it.
 *
 * Returns undefined for kinds outside this area, null to leave the decision alone (or to the legacy rule table).
 */
import { awaits, type Decision, type GameState, type Option, type PlayerState } from "../types.js";
import type { ActionCardDiscard, ActionCardStep, CardsDecision } from "../kinds/cards.js";

export type CardsChoice = { option: Option<any>; why: string };

const CARD_KINDS = new Set<string>([
  "action_card.play",
  "action_card.sabotage",
  "action_card.discard",
  "action_card.draw",
  "action_card.resolve",
  "action_card.target",
  "action_card.step",
  "action_card.when_after",
  "promissory_note.play",
  "promissory_note.resolve",
]);

/** After this many answers on one step prompt, finish it ("done") instead of choosing again. */
const MAX_STEP_CHOICES = 6;

/** Cards worth keeping when a discard is owed (cancel effects first). */
const KEEP = /^(sabo|sabotage|tf-shatter)/;

const live = (o: Option<any>) => !o.disabled && !o.needsInput;
const decline = (d: Decision) => d.options.find((o) => live(o) && !o.value && /^deleteButtons/.test(o.handler));

export function chooseCards(
  d: Decision,
  state: GameState | null,
  me: string,
  open: Decision[] = [],
  history: string[] = [],
): CardsChoice | null | undefined {
  if (!CARD_KINDS.has(d.kind)) return undefined;
  const c = d as CardsDecision;
  if (c.kind === "action_card.sabotage" && c.window) {
    if (!awaits(c, me)) return null;
    const pass = c.options.find((o) => live(o) && o.value?.action === "pass");
    return pass ? { option: pass, why: "sabotage window: no sabotage" } : null;
  }
  if (c.kind === "action_card.when_after") {
    // Non-queued agenda when/after window: bots never play whens/afters; pass for the whole agenda (no re-asks).
    if (!awaits(c, me)) return null;
    const opts = c.options.filter((o) => live(o) && o.value);
    const pass = opts.find((o) => o.value!.action === "pass_agenda") ?? opts.find((o) => o.value!.action === "pass");
    return pass ? { option: pass, why: `agenda: no ${c.options.find((o) => o.value)?.value?.timing ?? "when"}s` } : null;
  }
  if (c.scope !== "player" || c.target?.userId !== me) return null;
  const self = state?.players.find((p) => p.userId === me) ?? null;
  switch (c.kind) {
    case "action_card.sabotage": {
      // Private offer to cancel with a Watcher / Triune fighters / Instinct Training: decline it.
      const no = decline(c);
      return no ? { option: no, why: "sabotage: decline the private cancel offer" } : null;
    }
    case "action_card.discard":
      return chooseDiscard(c, self, open);
    case "action_card.resolve": {
      const go = c.options.find((o) => live(o) && o.value);
      return go ? { option: go, why: "own action card: resolve" } : null;
    }
    case "action_card.target": {
      // Our own card asks for a target: any other player first (never ourselves), else the first offered.
      const mine = self?.faction;
      const opts = c.options.filter((o) => live(o) && o.value);
      const pick = opts.find((o) => o.value!.player && o.value!.player !== mine) ?? opts.find((o) => !o.value!.player) ?? opts[0];
      return pick ? { option: pick, why: "own action card: first target" } : null;
    }
    case "action_card.draw": {
      // A free draw offered on its own (with at most a Decline): take it. Mixed with other choices: not ours.
      const draws = c.options.filter((o) => live(o) && o.value);
      const others = c.options.filter((o) => live(o) && !o.value && !/^deleteButtons/.test(o.handler));
      return draws.length === 1 && others.length === 0 ? { option: draws[0], why: "free action card draw" } : null;
    }
    case "action_card.step":
      return chooseStep(c, self, history);
    case "promissory_note.resolve": {
      // Optional note offers (Acquiescence) are declined; a note we already played asks for its target: finish it.
      const opts = c.options.filter((o) => live(o) && o.value);
      if (opts.some((o) => o.value!.step === "acquiescence")) {
        const no = decline(c);
        return no ? { option: no, why: "promissory note: decline Acquiescence" } : null;
      }
      const pick = opts.find((o) => o.value!.player !== self?.faction) ?? opts[0];
      return pick ? { option: pick, why: "promissory note: finish its step" } : null;
    }
    case "promissory_note.play": {
      // Never play notes unprompted; dismiss "this is the window to play X" reminders.
      const no = decline(c);
      return no ? { option: no, why: "promissory note: decline the optional play" } : null;
    }
    case "action_card.play":
    default:
      return null;
  }
}

const isScheming = (d: Decision) =>
  d.kind === "action_card.discard" && d.options.some((o) => o.value?.reason === "scheming");

/**
 * The engine can ask twice for one draw (hand limit and Scheming, and asks again after each discard while still over
 * the limit): Scheming prompts are always owed; a hand-limit prompt only for what the open Scheming prompts will not
 * already take off the hand (live count from state, not the count at capture).
 */
function chooseDiscard(d: ActionCardDiscard, self: PlayerState | null, open: Decision[]): CardsChoice | null {
  const opts = d.options.filter((o) => live(o) && o.value);
  if (!opts.length || opts.some((o) => o.value!.mode === "stall")) return null;
  const scheming = isScheming(d);
  const pendingScheming = open.filter((o) => o.id !== d.id && o.target?.userId === self?.userId && isScheming(o)).length;
  const count = (self?.actionCardCount ?? opts.length) - pendingScheming;
  const owed = scheming || count > opts[0].value!.handLimit;
  if (!owed) return null;
  const pick = opts.find((o) => !KEEP.test(o.value!.actionCard)) ?? opts[0];
  return { option: pick, why: scheming ? "Scheming: discard one action card" : "over the action card hand limit: discard" };
}

/**
 * A follow-up step of a card addressed to us: always finish it. Choose an option not pressed before on this prompt
 * (no toggling), another player before ourselves; after MAX_STEP_CHOICES answers, or when only finishers are left,
 * finish ("done"); with no typed option left, any live option (Done / delete) so the prompt never stalls.
 */
function chooseStep(d: ActionCardStep, self: PlayerState | null, history: string[]): CardsChoice | null {
  const opts = d.options.filter((o) => live(o) && o.value);
  const fresh = opts.filter((o) => !history.includes(o.id));
  const choose = fresh.filter((o) => o.value!.role === "choose");
  const done = opts.filter((o) => o.value!.role === "done");
  if (history.length < MAX_STEP_CHOICES && choose.length) {
    const mine = self?.faction;
    const pick =
      choose.find((o) => o.value!.player && o.value!.player !== mine) ?? choose.find((o) => !o.value!.player) ?? choose[0];
    return { option: pick, why: `action card step ${pick.value!.step}: choose` };
  }
  if (done.length) return { option: done[0], why: "action card step: finish" };
  // Only untyped options left (undo / shortcuts / a plain Done): the fallback picks a safe one.
  return null;
}
