/**
 * Autopilot policy for the setup + draft kinds (G1). Pure: (decision, state, me) → option. Every check reads the
 * engine's GameState (draft picks, setup stage), never prompt text or the bot's own memory, so a refused or stale
 * answer cannot leave a wrong belief behind (e.g. a faction "picked" by a press the engine rejected).
 *
 * Returns undefined for kinds it does not own, null for "do not answer" (a person's choice, or not ready yet).
 */
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
  "fracture.roll",
  "setup.preference",
  "setup.game_settings",
]);

export function isSetupKind(kind: string) {
  return SETUP_KINDS.has(kind);
}

/** Table-scoped setup steps any seat may take (no target, no reaction window). */
export function isTableSetupStep(d: Decision) {
  return d.kind === "setup.deal_secrets" || d.kind === "setup.reveal_objectives";
}

export function chooseSetup(d: Decision, state: GameState | null, me: string): SetupChoice | null | undefined {
  if (!SETUP_KINDS.has(d.kind)) return undefined;
  const live = (d.options as Option<any>[]).filter((o) => !o.disabled && !o.needsInput && o.value);
  if (!live.length || !state) return null;
  if (isTableSetupStep(d)) return tableStep(d, state, live);
  if (d.scope !== "player" || d.target?.userId !== me) return null;
  switch (d.kind) {
    case "draft.milty.pick":
      return draftPick(state, me, live);
    case "setup.keleres_flavor": {
      // The preset during the draft is optional; the flavour prompt after the draft blocks our setup: answer it.
      if (live.some((o) => o.value.preset)) return null;
      const pick = live.find((o) => !o.value.contested) ?? live[0];
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
    case "fracture.roll":
      return { option: live[0], why: live[0].value.automatic ? "spawn The Fracture" : "roll for The Fracture" };
    case "setup.preference":
      return preference(live);
    default:
      // draft.milty.queue / draft.milty.info / setup.player / setup.game_settings: people's or the steward's.
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

/** Same answers as the legacy rule table: let the bot auto-pass secret scoring and Sabotage; auto-react on agendas. */
function preference(live: Option<any>[]): SetupChoice | null {
  const by = (pref: string, choice: string) => live.find((o) => o.value.preference === pref && o.value.choice === choice);
  const pick = by("sandbag", "bot") ?? by("auto_pass_sabotage", "1") ?? by("agenda", "true");
  return pick ? { option: pick, why: `preferences: ${pick.value.preference} = ${pick.value.choice}` } : null;
}
