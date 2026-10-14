/**
 * Setup + draft decision kinds (workstream G1). Mirrors the bot's ti4.selfhost.engine.kinds.* setup kinds 1:1:
 * MiltyDraftPickKind, MiltyDraftQueueKind, MiltyDraftInfoKind, KeleresFlavorKind, PlayerSetupKind,
 * KeleresTechOptionsKind, TechTypeChoiceKind, DealSecretsKind, RevealObjectivesKind,
 * GameSettingsKind. Live readiness (who still sets up, what is left in the draft) is in
 * GameState.draft / GameState.setup, not in option values (those are snapshots taken when the prompt was posted).
 */
import type { ColorName, DecisionBase, FactionId, TilePosition, UserId } from "../types.js";

export type DraftCategory = "slice" | "faction" | "order";

/** Milty board (slices / factions / speaker order). target = drafter on the clock (draft_turn). */
export type MiltyDraftPick = DecisionBase<"draft.milty.pick", { category: DraftCategory; pick: string }>;

/** Queue picks for when it is your turn (cards-info thread). */
export type MiltyDraftQueue = DecisionBase<
  "draft.milty.queue",
  { action: "queue" | "restart" | "restart_all"; category: DraftCategory | null; pick: string | null }
>;

/** "<player> is up to draft!" read-only views; table scope, target = drafter on the clock. */
export type MiltyDraftInfo = DecisionBase<"draft.milty.info", { view: "board" | "all" | "picked" | "remaining" }>;

export type KeleresFlavor = "mentak" | "xxcha" | "argent";

/**
 * Which Keleres to play. preset=true during the draft (changeable), false after it (sets the player up).
 * contested: that faction was drafted / is still on the board (a preset of it is cancelled if it gets picked).
 * current (preset only): this flavour is already the preset; the bot refuses pressing it again (the preset handler
 * re-posts its buttons after every press, so a preset prompt never closes by being answered). The preset is
 * obsolete (closed, refused) once the draft is over.
 */
export type SetupKeleresFlavor = DecisionBase<
  "setup.keleres_flavor",
  {
    flavor: KeleresFlavor;
    faction: FactionId;
    preset: boolean;
    contested: boolean;
    current?: boolean;
    homePosition: TilePosition | null;
    speaker: boolean | null;
  }
>;

/** Manual player setup (no draft). Fields not known at that step are null; page = "Get More …" paging marker. */
export type SetupPlayerStep = DecisionBase<
  "setup.player",
  {
    step: "start" | "user" | "faction" | "color" | "home" | "speaker";
    userId: UserId | null;
    faction: FactionId | null;
    color: ColorName | null;
    position: TilePosition | null;
    speaker: boolean | null;
    page: string | null;
  }
>;

/** Keleres asks for its starting technologies; refused until nobody else is still choosing (see setup.waitingOn). */
export type SetupKeleresTech = DecisionBase<"setup.keleres_tech", { waitingOn: UserId[] }>;

/**
 * "Get a technology" by type; the technologies follow as tech.gain. techType null = type not chosen yet. `starting`: a
 * "choose your starting technology" prompt in round 1 (Deepwrought): its "Done" is refused while starting
 * technologies are owed.
 */
export type TechChooseType = DecisionBase<"tech.choose_type", { techType: string | null; free: boolean; starting?: boolean }>;

/** Table step: deal 2 secret objectives to everyone (refused until setup.stage === "deal_secrets"). */
export type SetupDealSecrets = DecisionBase<"setup.deal_secrets", Record<string, never>>;

/** Table step: reveal the first objectives and start the strategy phase (refused until stage reveal_objectives). */
export type SetupRevealObjectives = DecisionBase<"setup.reveal_objectives", Record<string, never>>;

// Preference questions moved to player.preference (kinds/ui.ts): asked all game, not only during setup.

/** Game creation: expansion, alternate modes, starting the draft, Milty settings pages. */
export type SetupGameSettings = DecisionBase<
  "setup.game_settings",
  { setting: "expansion" | "base_game" | "game_modes" | "game_options" | "draft_start" | "draft_settings"; choice: string }
>;

export type SetupDecision =
  | MiltyDraftPick
  | MiltyDraftQueue
  | MiltyDraftInfo
  | SetupKeleresFlavor
  | SetupPlayerStep
  | SetupKeleresTech
  | TechChooseType
  | SetupDealSecrets
  | SetupRevealObjectives
  | SetupGameSettings;
