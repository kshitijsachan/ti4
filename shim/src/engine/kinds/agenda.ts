/**
 * Agenda phase (workstream G6). Mirrors bot ti4.selfhost.engine.kinds.Agenda*Kind and EngineModels.AgendaState.
 * Outcome ids: "for"/"against", a faction (or colour in fog), a planet id, a secret objective id, a strategy card
 * number as text, a law (agenda) id, a tech alias (unit / unit upgrade).
 */
import type { DecisionBase, UserId } from "../types.js";

export type AgendaOutcomeType =
  | "for_against"
  | "player"
  | "planet"
  | "secret_objective"
  | "strategy_card"
  | "law"
  | "unit_upgrade"
  | "unit"
  | "other";

// ---------------------------------------------------------------- state (GameState.agenda)

export type AgendaVoteCast = { userId: UserId | null; faction: string; votes: number };
export type AgendaRider = { userId: UserId | null; faction: string; rider: string };
export type AgendaOutcomeState = { outcome: string; name: string; votes: number; voters: AgendaVoteCast[]; riders: AgendaRider[] };

export type AgendaState = {
  agendaId: string | null;
  name: string | null;
  /** "Law" | "Directive" */
  type: string;
  /** The card's target line: "For/Against", "Elect Player", "Elect Cultural Planet", ... */
  target: string;
  outcomeType: AgendaOutcomeType;
  /** 1st, 2nd (3rd) agenda of this phase. */
  number: number;
  /** Engine phase: "agendawaiting" (whens/afters), "agendaVoting", "agendaEnd" (resolve). */
  stage: string;
  whensResolved: boolean;
  aftersResolved: boolean;
  awaitingWhens: UserId[];
  awaitingAfters: UserId[];
  currentVoter: UserId | null;
  /** Empty in fog of war / hidden agenda games. */
  votingOrder: UserId[];
  /** Votes each player can cast now (fog / hidden agenda: only the viewer's). */
  availableVotes: Record<UserId, number>;
  /** Votes and riders cast so far, most votes first (empty in fog / hidden agenda). */
  outcomes: AgendaOutcomeState[];
};

// ---------------------------------------------------------------- decisions

export type AgendaOutcomeChoice = { id: string; name: string; userId?: UserId };
export type PlanetVotes = { planet: string; votes: number };

/** What a voter chooses from (vote and pre-vote options). */
export type Ballot = {
  outcomeType: AgendaOutcomeType;
  outcomes: AgendaOutcomeChoice[];
  /** Ready planets with a vote value for the voter. */
  planets: PlanetVotes[];
  /** Votes the engine lets the voter cast now (0 = cannot vote). */
  available: number;
};

/**
 * Your turn to vote. Answer atomically with `payload: VotePayload` (the engine runs vote → outcome → exhaust →
 * confirm), or press the abstain option. force_abstain = "(for others) abstain for this player".
 */
export type AgendaVote = DecisionBase<
  "agenda.vote",
  ({ action: "vote" } & Ballot) | { action: "abstain" } | { action: "force_abstain"; faction: string }
>;

/** Structured answer for agenda.vote (and the pre-vote option of agenda.preassign). */
export type VotePayload = {
  outcome?: string;
  /** Planet ids to exhaust (must be ready planets listed in the ballot). */
  planets?: string[];
  /** Exhaust every voting planet instead of listing them. */
  allPlanets?: boolean;
  /** Other vote sources by engine id as shown on the exhaust step, e.g. "zeal_6", "predictive_3", "hacanCommanderTg". */
  sources?: string[];
  abstain?: boolean;
};

/** One step of a vote in progress (what the structured answer walks through); progress.accumulated: VoteProgress. */
export type AgendaVoteStep = DecisionBase<
  "agenda.vote_step",
  | { step: "outcome"; outcome: string; name: string }
  | { step: "planet_owner"; faction: string; userId: UserId | null }
  | { step: "exhaust"; planet: string; votes: number | null }
  | { step: "exhaust_all"; votes: number | null }
  | { step: "source"; source: string; votes: number | null }
  | { step: "done_exhausting" }
  | { step: "reset" }
  | { step: "confirm"; votes: number }
  | { step: "modify_up" | "modify_down"; votes: number | null }
>;

export type VoteProgress = {
  outcome?: string;
  outcomeName?: string;
  planets: string[];
  sources: string[];
  votes: number;
  available: number;
  prevote: boolean;
};

/** Speaker breaks a tie (target: speaker). planetOwner options lead to that player's planets. */
export type AgendaTieBreak = DecisionBase<
  "agenda.tiebreak",
  { outcome: string; name: string } | { planetOwner: string; userId: UserId | null }
>;

type QueueValue = { action: "open" } | { action: "pass" } | { action: "queue"; cardType: string; card: string };

/** "When" queue in your cards-info thread: open the list, pass, or queue a card (ac/pn/ability). */
export type AgendaWhen = DecisionBase<"agenda.when", QueueValue>;
/** "After" queue: open, pass, queue (ac/pn/planet/leader/tech/ability), lock (play regardless), ask_again. */
export type AgendaAfter = DecisionBase<"agenda.after", QueueValue | { action: "lock" } | { action: "ask_again" }>;

/** Ahead-of-time choices in your cards-info thread. The prevote option takes a VotePayload answer. */
export type AgendaPreassign = DecisionBase<
  "agenda.preassign",
  | { preset: "pass_shenanigans" | "abstain" | "erase_prevote" | "pass_whens_afters" | "undo_pass_whens_afters" }
  | ({ preset: "prevote" } & Ballot)
>;

/** Table window (window.kind "shenanigans"): confirm you will not play Deadly Plot / Bribery / Legal Texts. */
export type AgendaShenanigans = DecisionBase<
  "agenda.shenanigans",
  { decline: "deadly_plot" | "bribery" | "legal_text" | "confusing_legal_text" }
>;

/** Resolve the agenda (target: speaker): with the current winner / a chosen outcome, manually, or with no effect. */
export type AgendaResolve = DecisionBase<
  "agenda.resolve",
  | { action: "resolve"; outcome: string; name: string }
  | { action: "planet_owner"; planetOwner: string; userId: UserId | null }
  | { action: "manual" }
  | { action: "no_effect" }
>;

/** After resolution (target: speaker): flip the next agenda or move on. */
export type AgendaNext = DecisionBase<"agenda.next", { action: "flip" | "strategy_phase" | "scoring" | "elect_voice_of_the_council" }>;

/** Place a rider on an outcome (outcomeKind: fa | player | planet | law | so | sc), or pick a planet's owner first. */
export type AgendaRiderPlacement = DecisionBase<
  "agenda.rider",
  { rider: string; outcomeKind: string; outcome: string; name: string } | { rider: string; planetOwner: string; userId: UserId | null }
>;

export type AgendaDecision =
  | AgendaVote
  | AgendaVoteStep
  | AgendaTieBreak
  | AgendaWhen
  | AgendaAfter
  | AgendaPreassign
  | AgendaShenanigans
  | AgendaResolve
  | AgendaNext
  | AgendaRiderPlacement;
