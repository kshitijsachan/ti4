import { getFactionImage } from "@/entities/lookup/factions";
import { getPrimaryColorCSS } from "@/entities/lookup/colors";
import { getLeaderById } from "@/entities/lookup/leaders";
import { getPlanetData } from "@/entities/lookup/planets";
import { getStrategyCardByInitiative } from "@/entities/lookup/strategyCards";
import { SC_COLORS, SC_NAMES } from "@/entities/data/strategyCardColors";
import { factionKeyDisplayName } from "@/entities/game/playerUtils";
import { countTechs, type LeaderState, type PlayerSummary } from "@/board/playerSummary";
import { phaseLabel, type TurnState } from "@/play/turn";
import type { GameState, PlayerState } from "./contract";

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
    factionName: factionKeyDisplayName(faction),
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
