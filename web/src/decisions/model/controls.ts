import type { Component, Message } from "@/discord";

/** How prominently a choice is offered in the popup. */
export type ChoiceRank = "primary" | "secondary" | "more" | "undo";

/** One control of a bot prompt, flattened out of its action rows / V2 layout. */
export type Choice = {
  key: string;
  kind: "button" | "select" | "link";
  customId?: string;
  /** Label without emoji markup; falls back to the emoji's name. */
  label: string;
  emojiName?: string;
  /** Discord button style: 1 blurple, 2 grey, 3 green, 4 red, 5 link. */
  style: number;
  disabled: boolean;
  rank: ChoiceRank;
  /** The raw component (selects need their options). */
  component: Component;
  url?: string;
};

/** Buttons that ride along on most bot posts and never need an answer. */
const TRIVIAL = /^(undo|delete( these)?( buttons?)?|dismiss|done|refresh|show draft again|.*\binfo)$/i;

/** Controls that take a press back rather than move on ("Undo", "Un-move 1 Destroyer", "Reassign…"). */
const TAKE_BACK = /^(undo|un-|reassign|retrieve|reset)/i;
const TAKE_BACK_ID = /^(ultimateUndo|undo|resetSpend|resetCCs|erase|unlockQueued|reversepreScore|removePreset|getPreDeclineSCButtons)/i;

/**
 * Utilities the bot attaches to real prompts (and to its standing info panels). They are never the answer
 * to the question being asked, so they live under "More options" and do not make a message a decision.
 */
const UTILITY_ID =
  /^(transaction|getModifyTiles|showMap|showPlayerAreas|showGameAgain|offerPlayerPref|playerPref|searchMyGames|showObjInfo|chooseMapView|refreshInfoButtons|refresh\w*|notepad\w*|cardsInfo|gameInfoButtons|offerDeckButtons|requestAllFollow|pingNonresponders|proceedToVoting|editEndOfRoundSummaries|setwillPillage|setAutoPass|announceARetreat|announceReadyForDice|checkCombatACs|getRepairButtons|forceAbstainForPlayer|gmCheck\w*|showTextOfDeck|offerDeckButtons|miltyFactionInfo|startPlayerSetup|answerSurvey)/i;
const UTILITY_SUFFIX = /_?(moveAlongAfterAllHaveReactedToAC|endTurnWhenAllReactedTo)/i;
const UTILITY_LABEL = /^(show |refresh|ping |pause timer|\(for others\)|request all|skip waiting|modify units|transaction$|player settings|list my games)/i;

/** The hand tray's card menus (play / discard / score a card): the hand module answers those itself. */
const HAND_ID = /^(ac_play_from_hand_|ac_discard_from_hand_|so_score_hand_|discardSecret_|get_so_score_buttons|get_so_discard_buttons|getDiscardButtonsACs)/;

/** Draft and pre-draft configuration prompts: the draft view (and the game's creator) own those. */
const DRAFT_ID =
  /^(milty|queueMilyPick|jwds|draftPreset|setupStep|restartMiltyQueue|showMiltyDraft|miltyFactionInfo|startTFDraft|jmf[A-Z]|chooseExp|startDraftSystem|frankenSetup|setupBaseGameMode|startTFGame|toggleTfHomebrew|editTFHomebrew|getHomebrewButtons|offerGameOptionButtons|offerTEOptionButtons|miltySetup|addMapString|drawSpecificSO)/;

/**
 * Table-wide steps that move the game from setup into round 1. The bot posts them in the action log addressed to
 * nobody ("Press this button after every player is setup."): anyone at the table may press them.
 */
const TABLE_SETUP_ID = /^(deal2SOToAll|startOfGameObjReveal|startOfGameStrategyPhase)$/;

/** Round-one "keep one of the two secret objectives you were dealt" buttons in my hand thread. */
const SO_DISCARD_ID = /^(discardSecret_|SODISCARD_)\d+/;

/** Strips the `FFCC_<faction>_` prefix the bot uses to lock a button to one faction. */
export function baseId(customId: string | undefined): string {
  if (!customId) return "";
  return customId.replace(/^FFCC_[^_]+_/, "");
}

/** The faction a `FFCC_<faction>_...` button is locked to. */
export function idFaction(customId: string | undefined): string | undefined {
  return customId?.match(/^FFCC_([^_]+)_/)?.[1];
}

/** Removes Discord emoji markup from a label. */
export function cleanLabel(label: string | undefined): string {
  return (label ?? "")
    .replace(/<a?:\w+:\d+>/g, "")
    .replace(/⁠/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function rankOf(c: Component, label: string): ChoiceRank {
  const id = baseId(c.custom_id);
  if (TAKE_BACK.test(label) || TAKE_BACK_ID.test(id)) return "undo";
  if (UTILITY_ID.test(id) || UTILITY_SUFFIX.test(id) || UTILITY_LABEL.test(label) || TRIVIAL.test(label))
    return "more";
  if (c.style === 2) return "secondary";
  return "primary";
}

/** Every control in a message, in reading order, with its rank. */
export function choicesOf(m: Message): Choice[] {
  const out: Choice[] = [];
  const walk = (list: Component[] | undefined) => {
    for (const c of list ?? []) {
      pushControl(c, out);
      walk(c.components);
      if (c.accessory) walk([c.accessory]);
      if (c.component) walk([c.component]);
    }
  };
  walk(m.components);
  return out;
}

function pushControl(c: Component, out: Choice[]) {
  if (c.type === 2) {
    if (c.style === 6) return;
    /* Links to asyncti4.com's own UI ("Move on Map (Desktop Only, BETA)") lead off this site. */
    if (c.style === 5 && /asyncti4\.com/i.test(c.url ?? "")) return;
    const label = cleanLabel(c.label) || c.emoji?.name || "";
    const kind = c.style === 5 ? "link" : "button";
    out.push({
      key: c.custom_id ?? c.url ?? `${out.length}`,
      kind,
      customId: c.custom_id,
      label,
      emojiName: c.emoji?.name ?? undefined,
      style: c.style ?? 2,
      disabled: !!c.disabled,
      rank: kind === "link" ? "more" : rankOf(c, label),
      component: c,
      url: c.url,
    });
    return;
  }
  if (![3, 5, 6, 7, 8].includes(c.type)) return;
  out.push({
    key: c.custom_id ?? `${out.length}`,
    kind: "select",
    customId: c.custom_id,
    label: cleanLabel(c.placeholder) || "Choose",
    style: 1,
    disabled: !!c.disabled,
    rank: "primary",
    component: c,
  });
}

/** Choices that move the game on: enabled, not a utility, not a take-back. */
export function forwardChoices(m: Message): Choice[] {
  return choicesOf(m).filter((c) => !c.disabled && c.kind !== "link" && (c.rank === "primary" || c.rank === "secondary"));
}

export function needsAnswer(m: Message): boolean {
  return forwardChoices(m).length > 0;
}

/** Draft / game-setup prompts, which the draft view and setup screen own. */
export function isDraftPrompt(m: Message): boolean {
  const ids = forwardChoices(m).map((c) => baseId(c.customId));
  return ids.length > 0 && ids.every((id) => DRAFT_ID.test(id));
}

/** A table-wide setup step anyone may press (deal secret objectives, reveal objectives and start round 1). */
export function isTableSetupPrompt(m: Message): boolean {
  const ids = forwardChoices(m).map((c) => baseId(c.customId));
  return ids.length > 0 && ids.some((id) => TABLE_SETUP_ID.test(id)) && ids.every((id) => TABLE_SETUP_ID.test(id));
}

/** "Use these buttons to discard a secret objective." with one button per secret: a real decision, not a menu. */
export function isSecretDiscardPrompt(m: Message): boolean {
  const ids = forwardChoices(m).map((c) => baseId(c.customId));
  return ids.length > 0 && ids.every((id) => SO_DISCARD_ID.test(id)) && /discard a secret objective/i.test(m.content);
}

/** A transient card menu from the hand thread, which the hand tray handles. */
export function isHandMenu(m: Message): boolean {
  if (isSecretDiscardPrompt(m)) return false;
  const ids = forwardChoices(m).map((c) => baseId(c.customId));
  return ids.length > 0 && ids.every((id) => HAND_ID.test(id));
}

/** The bot's general "player menu" (transaction, notes, map view, settings…): a toolbox, never a decision. */
const PLAYER_MENU_ID =
  /^(transaction|getModifyTiles|offerPlayerPref|searchMyGames|showObjInfo|chooseMapView|refreshInfoButtons|editEndOfRoundSummaries|notepad|cardsInfo|gameInfoButtons|offerDeckButtons|showMap|showPlayerAreas|passOnNextTurn|queueToPass|turnOffPass|player_?pref)/i;

export function isUtilityMenu(m: Message): boolean {
  if (/use these buttons to do various things/i.test(m.content ?? "")) return true;
  const ids = forwardChoices(m).map((c) => baseId(c.customId));
  return ids.length >= 3 && ids.filter((id) => PLAYER_MENU_ID.test(id)).length / ids.length >= 0.6;
}

/** The custom ids of a message's controls, sorted: the "question" it asks. */
export function buttonSignature(m: Message): string {
  return choicesOf(m)
    .map((c) => c.customId ?? "")
    .filter(Boolean)
    .sort()
    .join("|");
}
