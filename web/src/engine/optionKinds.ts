import type { Option } from "./contract";

/** Handlers that take a step back (undo, reset a selection): small, after the real choices. */
const TAKE_BACK = /^(ultimateUndo|undo|resetSpend|resetCCs|erase|unlockQueued|reversepreScore|removePreset|drawSpecificSO_)/i;

/**
 * Utilities riding along on prompts (refresh, show map, player settings, ping, deck info, transaction): never the
 * answer to the question asked, so they fold under "More".
 */
const UTILITY =
  /^(transaction|getModifyTiles|showMap|showPlayerAreas|showGameAgain|offerPlayerPref|playerPref|searchMyGames|showObjInfo|chooseMapView|refreshInfoButtons|refreshView|notepad\w*|cardsInfo|gameInfoButtons|offerDeckButtons|requestAllFollow|pingNonresponders|editEndOfRoundSummaries|setwillPillage|setAutoPass|gmCheck\w*|showTextOfDeck|miltyFactionInfo|answerSurvey|deleteButtons$|modifyUnits|getModifyUnits|getToggleGalvanizeTiles)/i;

function handlerOf(o: Option<unknown>) {
  return (o.handler || o.id).replace(/^FFCC_[^_]+_/, "");
}

/** Game creation, settings and draft-queue prompts: moot once the game is under way. */
const SETUP_ONLY =
  /^(startPlayerSetup|offerGameOptionButtons|getHomebrewButtons|offerTEOptionButtons|startTFGame|frankenSetup|setupBaseGameMode|chooseExp_|jmf[A-Z]_|milty|queueMilyPick|draftPreset|setupStep|miltySetup|startDraftSystem|showMiltyDraft|restartMiltyQueue)/;

export type OptionRole = "main" | "back" | "utility";

/** An untyped prompt whose real choices only make sense while the game is being set up. */
export function setupOnly(options: Option<unknown>[]): boolean {
  const main = options.filter((o) => optionRole(o) === "main");
  return main.length > 0 && main.every((o) => SETUP_ONLY.test(handlerOf(o)));
}

/** An untyped prompt with nothing to decide (only utilities and step-backs): an info panel, not a decision. */
export function nothingToDecide(options: Option<unknown>[]): boolean {
  return !options.some((o) => optionRole(o) === "main");
}

/** How prominently an untyped option is offered: a real choice, a step back, or a utility for under "More". */
export function optionRole(o: Option<unknown>): OptionRole {
  const h = handlerOf(o);
  if (TAKE_BACK.test(h)) return "back";
  if (UTILITY.test(h)) return "utility";
  return "main";
}
