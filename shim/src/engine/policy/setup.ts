/**
 * Autopilot policy for the setup + draft kinds (G1). Pure: (decision, state, me) → option. Every check reads the
 * engine's GameState (draft picks, setup stage), never prompt text or the bot's own memory, so a refused or stale
 * answer cannot leave a wrong belief behind (e.g. a faction "picked" by a press the engine rejected).
 *
 * Returns undefined for kinds it does not own, null for "do not answer" (a person's choice, or not ready yet).
 */
import { is } from "../ids.js";
import type { Decision, GameState, Option, SetupPlayer } from "../types.js";

export type SetupChoice = { option: Option<any>; why: string };

/** Draft order of preference when several categories are open to us. */
const CATEGORY_ORDER = ["faction", "slice", "order"] as const;

const SETUP_KINDS = new Set<string>([
  "draft.milty.pick",
  "draft.milty.queue",
  "draft.milty.info",
  "setup.keleres_flavor",
  "setup.player",
  "setup.keleres_tech",
  "tech.choose_type",
  "setup.deal_secrets",
  "setup.reveal_objectives",
  "setup.game_settings",
]);

export function isSetupKind(kind: string) {
  return SETUP_KINDS.has(kind);
}

/** Table-scoped setup steps any seat may take (no target, no reaction window). */
export function isTableSetupStep(d: Decision) {
  return d.kind === "setup.deal_secrets" || d.kind === "setup.reveal_objectives";
}

export function chooseSetup(d: Decision, state: GameState | null, me: string, history: string[] = []): SetupChoice | null | undefined {
  if (!SETUP_KINDS.has(d.kind)) return undefined;
  const live = (d.options as Option<any>[]).filter((o) => !o.disabled && !o.needsInput && o.value);
  if (!live.length || !state) return null;
  if (isTableSetupStep(d)) return tableStep(d, state, live);
  if (d.scope !== "player" || d.target?.userId !== me) return null;
  switch (d.kind) {
    case "draft.milty.pick":
      return draftPick(state, me, live);
    case "setup.keleres_flavor": {
      // The preset during the draft is optional but waited on by the watchdog: pre-select the first flavour nobody
      // else holds (pbd175); once we play a flavour it is stale (fallback.staleForBot). After the draft the flavour
      // prompt blocks our setup: answer it.
      const pick = live.find((o) => !o.value.contested) ?? (live.some((o) => o.value.preset) ? undefined : live[0]);
      if (!pick) return null;
      return { option: pick, why: `setup: Keleres flavour ${pick.value.flavor}` };
    }
    case "setup.keleres_tech": {
      const waiting = othersStillSettingUp(state, me);
      if (waiting.length) return null;
      return { option: live[0], why: "setup: Keleres technology options (everyone else chose theirs)" };
    }
    case "tech.choose_type": {
      // Only an open starting-technology choice during setup; later "any technology" choices belong to the planner.
      if (!state.setup || !live.every((o) => o.value.free)) return null;
      return { option: live[0], why: live[0].value.techType ? "setup: first technology type" : "setup: get a starting technology" };
    }
    case "setup.player":
      return playerSetup(state, me, live, history);
    default:
      // draft.milty.queue / draft.milty.info / setup.game_settings: people's or the steward's.
      return null;
  }
}

/**
 * Manual player setup addressed to us (startPlayerSetup → user → faction → colour → home → speaker): set ourselves
 * up with official content. Live pbd147: three bots were set up only by the fallback (first option at each step,
 * "Setup a Player" pressed again on every watchdog pass).
 */
function playerSetup(state: GameState, me: string, live: Option<any>[], history: string[]): SetupChoice | null {
  const step = live[0]?.value?.step as string | undefined;
  const mine = state.players.find((p) => p.userId === me);
  const taken = new Set(state.players.filter((p) => p.userId !== me).flatMap((p) => [p.faction, p.color]).filter(Boolean) as string[]);
  const choices = live.filter((o) => o.value.step === step && !o.value.page);
  switch (step) {
    case "start":
      // Once per prompt (the message stays after it is pressed), and never once we are seated.
      if (mine?.faction || history.length) return null;
      return choices[0] ? { option: choices[0], why: "setup: set ourselves up" } : null;
    case "user": {
      const o = choices.find((x) => x.value.userId === me);
      return o ? { option: o, why: "setup: the player to set up is us" } : null;
    }
    case "faction": {
      if (choices.some((x) => x.value.userId && x.value.userId !== me)) return null;
      const o = choices.find((x) => is.faction(x.value.faction) && !taken.has(x.value.faction));
      return o ? { option: o, why: `setup: faction ${o.value.faction} (official, free)` } : null;
    }
    case "color": {
      const o = choices.find((x) => x.value.color && !taken.has(x.value.color)) ?? choices[0];
      return o ? { option: o, why: `setup: colour ${o.value.color ?? "default"}` } : null;
    }
    case "home":
      return choices[0] ? { option: choices[0], why: `setup: home position ${choices[0].value.position}` } : null;
    case "speaker": {
      const o = choices.find((x) => x.value.speaker === false) ?? choices[0];
      return o ? { option: o, why: `setup: ${o.value.speaker ? "take" : "do not take"} the speaker token` } : null;
    }
    default:
      return null;
  }
}

function draftPick(state: GameState, me: string, live: Option<any>[]): SetupChoice | null {
  const draft = state.draft;
  if (!draft || draft.status !== "drafting" || draft.currentPlayer !== me) return null;
  const mine = draft.players.find((p) => p.userId === me);
  if (!mine) return null;
  const held = { faction: mine.faction, slice: mine.slice, order: mine.speakerOrder };
  const onBoard = (o: Option<any>) => {
    const { category, pick } = o.value;
    if (category === "faction") return draft.available.factions.includes(pick);
    if (category === "slice") return draft.available.slices.includes(pick);
    return draft.available.speakerOrders.includes(Number(pick));
  };
  for (const category of CATEGORY_ORDER) {
    if (held[category] != null) continue;
    const opt = live.find((o) => o.value.category === category && onBoard(o));
    if (opt) return { option: opt, why: `draft: first ${category} on the board` };
  }
  return null;
}

function tableStep(d: Decision, state: GameState, live: Option<any>[]): SetupChoice | null {
  const stage = state.setup?.stage;
  if (d.kind === "setup.deal_secrets" && stage === "deal_secrets") return { option: live[0], why: "setup: everyone is set up; deal secret objectives" };
  if (d.kind === "setup.reveal_objectives" && stage === "reveal_objectives")
    return { option: live[0], why: "setup: everyone kept a secret objective; reveal objectives" };
  return null;
}

/** Players other than me still choosing a Keleres flavour or starting technologies (Keleres takes from theirs). */
export function othersStillSettingUp(state: GameState, me: string): SetupPlayer[] {
  return (state.setup?.players ?? []).filter(
    (p) => p.userId !== me && (p.keleresFlavorPending || (p.startingTechsNeeded > 0 && !p.faction?.startsWith("keleres"))),
  );
}

