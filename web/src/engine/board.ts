import { getFactionImage } from "@/entities/lookup/factions";
import { getPrimaryColorCSS } from "@/entities/lookup/colors";
import { getLeaderById } from "@/entities/lookup/leaders";
import { getPlanetData } from "@/entities/lookup/planets";
import { getStrategyCardByInitiative } from "@/entities/lookup/strategyCards";
import { SC_COLORS, SC_NAMES } from "@/entities/data/strategyCardColors";
import { countTechs, type LeaderState, type PlayerSummary } from "@/board/playerSummary";
import { phaseLabel, type TurnState } from "@/play/turn";
import type { Decision, GameState, PlayerState } from "./contract";
import { decisionTitle } from "./queue";
import { factionName } from "./names";

/** The engine's raw phase ("statusScoring", "agendaVoting", "miltydraft") as the board labels it. */
export function enginePhaseLabel(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  if (/draft/i.test(raw)) return "Draft";
  if (/setup/i.test(raw)) return "Setup";
  const m = /^(strategy|action|status|agenda)(.*)$/i.exec(raw);
  if (!m) return phaseLabel(raw);
  const step = m[2].replace(/^[_.]/, "").toLowerCase();
  return phaseLabel(step ? `${m[1].toLowerCase()}.${step}` : m[1].toLowerCase());
}

/** Whose move it is, from the engine state (the draft's current picker while a draft runs). */
export function engineTurn(state: GameState, myId: string | undefined): TurnState {
  const name = (id: string | null | undefined) => state.players.find((p) => p.userId === id)?.userName;
  if (state.draft?.currentPlayer) {
    return { mine: !!myId && state.draft.currentPlayer === myId, waitingOn: name(state.draft.currentPlayer), phase: "Draft" };
  }
  const turnPhase = /^(strategy|action)/i.test(state.phase ?? "");
  return {
    mine: turnPhase && !!myId && state.activePlayer === myId,
    waitingOn: turnPhase ? name(state.activePlayer) : undefined,
    phase: enginePhaseLabel(state.phase),
  };
}

export function activePlayerColor(state: GameState): string | undefined {
  const active = state.players.find((p) => p.userId === state.activePlayer);
  return active?.color ? getPrimaryColorCSS(active.color) : undefined;
}

const LEADER_TYPES = ["agent", "commander", "hero"] as const;

/** "<leaderId>[:locked|:exhausted]" → state per leader type (a leader missing from the list is gone, e.g. a purged hero). */
function leaderStates(leaders: string[]): PlayerSummary["leaders"] {
  const out: PlayerSummary["leaders"] = { agent: "gone", commander: "gone", hero: "gone" };
  for (const entry of leaders) {
    const [id, flag] = entry.split(":");
    const type = getLeaderById(id)?.type ?? LEADER_TYPES.find((t) => id.endsWith(t));
    if (!type || !(type in out)) continue;
    const state: LeaderState = flag === "locked" ? "locked" : flag === "exhausted" ? "exhausted" : "ready";
    out[type as keyof PlayerSummary["leaders"]] = state;
  }
  return out;
}

function planetSums(p: PlayerState) {
  const exhausted = new Set(p.exhaustedPlanets);
  const sums = { resources: 0, resourcesTotal: 0, influence: 0, influenceTotal: 0 };
  for (const id of p.planets) {
    const planet = getPlanetData(id);
    if (!planet) continue;
    sums.resourcesTotal += planet.resources ?? 0;
    sums.influenceTotal += planet.influence ?? 0;
    if (exhausted.has(id)) continue;
    sums.resources += planet.resources ?? 0;
    sums.influence += planet.influence ?? 0;
  }
  return sums;
}

/** A compact player board from the engine's PlayerState (same shape the legacy web-data summary produces). */
export function summarizeEnginePlayer(p: PlayerState, state: GameState): PlayerSummary {
  const faction = p.faction ?? "";
  const played = new Set(state.strategyCards.filter((sc) => sc.played).map((sc) => sc.number));
  return {
    key: p.color ?? p.userId,
    name: p.userName,
    faction,
    factionName: factionName(faction),
    factionImage: faction ? getFactionImage(faction) : undefined,
    color: getPrimaryColorCSS(p.color ?? ""),
    vp: p.victoryPoints,
    active: p.active,
    passed: p.passed,
    speaker: p.speaker,
    eliminated: p.eliminated,
    strategyCards: p.strategyCards.map((initiative) => ({
      initiative,
      name: getStrategyCardByInitiative(initiative)?.name ?? SC_NAMES[initiative] ?? `Card ${initiative}`,
      color: SC_COLORS[initiative] ?? "gray",
      played: played.has(initiative),
    })),
    tg: p.tg,
    commodities: p.commodities,
    commoditiesMax: p.commoditiesMax,
    tactic: p.commandTokens.tactic,
    fleet: p.commandTokens.fleet,
    strategy: p.commandTokens.strategy,
    planets: p.planets.length,
    ...planetSums(p),
    techs: countTechs(p.techs),
    relics: p.relics.length,
    fragments: p.fragments.length,
    leaders: leaderStates(p.leaders),
    actionCards: p.actionCardCount,
    secrets: p.secretObjectiveCount,
    promissory: p.promissoryNoteCount,
  };
}

function listed(names: string[]) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const SETUP_STEP: Record<string, string> = {
  settings: "the game's settings to be chosen",
  player_setup: "players to finish setting up",
  deal_secrets: "secret objectives to be dealt",
  keep_secrets: "players to choose which secret objective to keep",
  reveal_objectives: "the objectives to be revealed",
};

const SETUP_TASK: Record<string, string> = {
  settings: "choose the game's settings",
  player_setup: "finish setting up",
  keep_secrets: "choose which secret objective to keep",
};

/** What a setup waits on, in plain words, and whether I am among those waited on (the setup screen's note). */
export function engineSetupWaiting(state: GameState, myId: string | undefined): { text: string; me: boolean } | undefined {
  const setup = state.setup;
  if (!setup || setup.stage === "draft") return undefined;
  const name = (id: string) => (id === myId ? "you" : (state.players.find((p) => p.userId === id)?.userName ?? "a player"));
  if (!setup.waitingOn.length) return SETUP_STEP[setup.stage] ? { text: `Waiting for ${SETUP_STEP[setup.stage]}…`, me: false } : undefined;
  const task = setup.stage === "player_setup" ? playerSetupTask(setup, setup.waitingOn) : SETUP_TASK[setup.stage];
  return {
    text: `Waiting for ${listed(setup.waitingOn.map(name))}${task ? ` to ${task}` : ""}…`,
    me: !!myId && setup.waitingOn.includes(myId),
  };
}

function playerSetupTask(setup: NonNullable<GameState["setup"]>, waiting: string[]) {
  const players = setup.players.filter((p) => waiting.includes(p.userId));
  if (players.length && players.every((p) => p.startingTechsNeeded > 0)) return "choose a starting technology";
  if (players.length && players.every((p) => p.keleresFlavorPending)) return "choose a Keleres flavour";
  return SETUP_TASK.player_setup;
}

/** Who the table waits on when it is nobody's turn (setup, an agenda vote), for the header note. */
export function engineWaitingNote(state: GameState, myId: string | undefined): string | null {
  const name = (id: string) => state.players.find((p) => p.userId === id)?.userName ?? "a player";
  const setup = state.setup;
  if (setup && setup.stage !== "draft") {
    const others = setup.waitingOn.filter((id) => id !== myId);
    if (others.length) return `Waiting for ${listed(others.map(name))}…`;
    if (!setup.waitingOn.length && SETUP_STEP[setup.stage]) return `Waiting for ${SETUP_STEP[setup.stage]}…`;
  }
  const voter = state.agenda?.currentVoter;
  if (voter && voter !== myId) return `Waiting for ${name(voter)} to vote…`;
  const status = state.status;
  if (status) {
    const seated = state.players.filter((p) => p.real && !p.eliminated).map((p) => p.userId);
    const scoring = status.step === "scoring";
    const owing = seated.filter((id) => {
      const st = status.players[id];
      if (!st || id === myId) return false;
      return scoring ? st.publicScored === null || st.secretScored === null : !st.ready;
    });
    if (owing.length) return `Waiting for ${listed(owing.map(name))} to ${scoring ? "score" : "finish the status phase"}…`;
  }
  return null;
}

/** The header's "Your move" count and tooltip (the popup's queue), else what the table waits on. */
export function engineWaiting(state: GameState, queue: Decision[], myId: string | undefined) {
  return { count: queue.length, title: queue[0] ? decisionTitle(queue[0], state) : null, note: queue.length ? null : engineWaitingNote(state, myId) };
}
