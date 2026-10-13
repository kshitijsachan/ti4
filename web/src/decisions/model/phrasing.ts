/**
 * Bot buttons in plain words: what a press did ("Readied Nestphar", "Passed", "Picked Construction"), for the outcome
 * toast after a press and for the Undo button's "you readied Nestphar". Pure (no imports), so the rollback planner
 * and its node tests can share it.
 */

/** Imperative first words of bot button labels → their past tense, for "Passed", "Kept Strengthen Bonds"… */
const PAST: Record<string, string> = {
  abstain: "Abstained",
  accept: "Accepted",
  activate: "Activated",
  add: "Added",
  allow: "Allowed",
  assign: "Assigned",
  attach: "Attached",
  build: "Built",
  buy: "Bought",
  cancel: "Cancelled",
  choose: "Chose",
  claim: "Claimed",
  conclude: "Concluded",
  confirm: "Confirmed",
  decline: "Declined",
  dismiss: "Dismissed",
  deploy: "Deployed",
  discard: "Discarded",
  draw: "Drew",
  end: "Ended",
  exhaust: "Exhausted",
  explore: "Explored",
  finish: "Finished",
  flip: "Flipped",
  follow: "Followed",
  gain: "Gained",
  get: "Got",
  give: "Gave",
  keep: "Kept",
  land: "Landed",
  lose: "Lost",
  move: "Moved",
  pass: "Passed",
  pay: "Paid",
  pick: "Picked",
  place: "Placed",
  play: "Played",
  produce: "Produced",
  purge: "Purged",
  redistribute: "Redistributed",
  refresh: "Refreshed",
  reject: "Rejected",
  remove: "Removed",
  replenish: "Replenished",
  research: "Researched",
  resolve: "Resolved",
  retreat: "Retreated",
  reveal: "Revealed",
  roll: "Rolled",
  score: "Scored",
  select: "Selected",
  send: "Sent",
  skip: "Skipped",
  spend: "Spent",
  start: "Started",
  steal: "Stole",
  take: "Took",
  trade: "Traded",
  undo: "Undid",
  use: "Used",
  vote: "Voted",
  wash: "Washed",
};

const STRUCTURE_NAMES: Record<string, string> = { spacedock: "space dock", sd: "space dock", pds: "PDS", facility: "facility", monument: "monument" };

/** A button id without the bot's faction lock ("FFCC_arborec_refresh_nestphar" → "refresh_nestphar"). */
export function plainId(customId: string | undefined): string {
  return (customId ?? "").replace(/^FFCC_[^_]+_/, "");
}

/** "307 (Nestphar - Arborec)" → "system 307 (Nestphar)"; undefined when the label is not a system. */
function systemName(label: string): string | undefined {
  const m = label.match(/^(?:space area of\s+)?(\d{2,4}[a-z]?)\s*\(([^()]*?)(?:\s+-\s+[^()]*)?\)$/i);
  if (!m) return undefined;
  const planets = m[2].trim();
  return planets && !/^\d+$/.test(planets) ? `system ${m[1]} (${planets})` : `system ${m[1]}`;
}

/** Bot button labels that read as bot jargon, by handler (without the faction lock): plain words for the web UI. */
const DISPLAY_LABELS: [RegExp, string][] = [
  [/^constructionPrimary_produce$/, "Produce at a space dock instead"],
  [/(^|_)generic_$/, "Other component action (resolve by hand)"],
];

/**
 * An engine option's label for display: plain words for known jargon ("[Primary] Use Production", "Generic Component
 * Action"), and no "[Primary]" tag otherwise (pt9 labels).
 */
export function displayLabel(handler: string | null | undefined, label: string): string {
  const id = (handler ?? "").replace(/^FFCC_[^_]+_/, "");
  const known = DISPLAY_LABELS.find(([re]) => re.test(id));
  if (known) return known[1];
  return label.replace(/^\[[^\]]*\]\s*/, "");
}

/**
 * A bot button's label as words: no "[Primary]" tag, no "(2)" index, no "(3/2)" planet values, and a system button
 * ("307 (Nestphar - Arborec)") as "system 307 (Nestphar)".
 */
export function cleanButtonLabel(label: string): string {
  const text = label
    .replace(/<a?:\w+:\d+>/g, "")
    .replace(/⁠/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\[[^\]]*\]\s*/, "")
    .replace(/^\(\d+\)\s*/, "")
    .replace(/\s*\(\d+\/\d+\)$/, "")
    .trim();
  return systemName(text) ?? text;
}

/**
 * Public objectives paid in planets / trade goods when scored (ObjectiveSpendService.COST): picking one only opens its
 * payment. (Lead from the Front / Galvanize score at once unless the token split is a choice: not listed.)
 */
const SPEND_OBJECTIVES = /^(erect a monument|found a golden age|sway the council|manipulate galactic law|amass wealth|hold vast reserves)$/i;

/** Presses that only open the next step: what is being chosen now, and what undoing the press takes back. */
type Opening = { now: string; undo: string };

/**
 * Presses that only open the next step (an ability menu before passing, the planet picker for a structure): nothing
 * is done yet, so the note says what is being chosen, never that it happened.
 */
function openingStep(id: string, label: string): Opening | undefined {
  if (/^passingAbilities/.test(id) || (/^pass/i.test(label) && /\(\+\d+ abilit/i.test(label)))
    return { now: "Choosing abilities before passing…", undo: "Opened the abilities before passing" };
  /* "End Turn" alone ends it; "End Turn (+1 ability)" opens the ability menu first. */
  if (/\(\+\d+ abilit/i.test(label)) return { now: "Choosing end-of-turn abilities…", undo: "Opened the end-of-turn abilities" };
  const structure = id.match(/^construction_(\w+)$/)?.[1];
  if (structure) {
    const name = STRUCTURE_NAMES[structure.toLowerCase()] ?? structure;
    return { now: `Choosing a planet for the ${name}…`, undo: `Started placing a ${name}` };
  }
  if (/^tacticalAction(?!Build)/.test(id)) return { now: "Choosing a system to activate…", undo: "Started a tactical action" };
  /* "Build in This System (4 PRODUCTION value)": opens the production panel; nothing is built yet. */
  if (/^tacticalActionBuild/.test(id) || /^build in this system\b/i.test(label)) return { now: "Choosing units to produce…", undo: "Started producing units" };
  /* A spend objective (Sway the Council…): picking it opens its payment; it is scored once paid. */
  const objective = cleanButtonLabel(label);
  if (/^po_scoring_\d+$/.test(id) && SPEND_OBJECTIVES.test(objective)) return { now: `Paying for ${objective}…`, undo: `Started scoring ${objective}` };
  if (/^componentAction(?!Res)/.test(id)) return { now: "Choosing a component action…", undo: "Opened the component actions" };
  /* "Score A Public" (Imperial) only lists the public objectives: nothing is scored until one is picked. */
  if (/^scoreAnObjective$/.test(id)) return { now: "Choosing a public objective to score…", undo: "Opened public objective scoring" };
  if (/^get_so_score_buttons$/.test(id)) return { now: "Choosing a secret objective to score…", undo: "Opened secret objective scoring" };
  if (/^get_so_discard_buttons$|^getDiscardButtons/.test(id)) return { now: "Choosing a card to discard…", undo: "Opened the discard choice" };
  if (/^diploSystem$/.test(id)) return { now: "Choosing a system to protect…", undo: "Started choosing a system to protect" };
  if (/^diploRefresh2$/.test(id)) return { now: "Choosing planets to ready…", undo: "Started readying planets" };
  if (/^redistributeCCButtons(_|$)/.test(id)) return { now: "Choosing command tokens…", undo: "Opened the command tokens" };
  if (/^mitosisInf$/.test(id)) return { now: "Mitosis: choosing a planet for the infantry…", undo: "Started Mitosis (infantry)" };
  if (/^mitosisMech$/.test(id)) return { now: "Mitosis: choosing an infantry to replace with a mech…", undo: "Started Mitosis (mech)" };
  return undefined;
}

/** "Nar, Jol" → "Nar and Jol"; three or more keep their commas. */
function listed(names: string[]) {
  return names.length === 2 ? `${names[0]} and ${names[1]}` : names.join(", ");
}

/** What the readying prompt (as it stood when Done was pressed) says it readied; `undefined` when unknown. */
function readiedPlanets(content: string | undefined): string[] | undefined {
  if (content === undefined) return undefined;
  const readied = content.match(/\bReadied\b(.*)$/s)?.[1] ?? "";
  return readied
    .replace(/<a?:\w+:\d+>/g, "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Bot buttons whose label is a command or a status ("Done Readying Planets", "No Secret Objective Scored"), as what
 * happened. `content` is the pressed message as it stood (the readying prompt lists what it readied).
 */
function doneOutcome(id: string, label: string, content: string | undefined): string | undefined {
  if (/^diplo_\w+?_diploP$/.test(id)) return `Protected ${systemName(label) ?? label}`;
  if (/^deleteButtons_diplomacy$/.test(id) || /^done readying planets$/i.test(label)) {
    const names = readiedPlanets(content);
    if (!names) return "Finished readying planets";
    return names.length ? `Readied ${listed(names)}` : "Skipped readying planets";
  }
  if (/^doneWithTacticalAction$/.test(id) && /frontier/i.test(label)) return "Explored the frontier token and concluded the action";
  if (/^refresh_\w+$/.test(id)) return `Readied ${cleanButtonLabel(label)}`;
  if (/^scPick_\d+$/.test(id)) return `Picked ${cleanButtonLabel(label)}`;
  if (/^po_scoring_\d+$/.test(id)) return `Scored ${cleanButtonLabel(label)}`;
  if (/^done exhausting planets$/i.test(label)) return "Finished paying";
  /* "Discard (576) Drive the Debate": the card's name, not its number. */
  if (/^discard\s*\(\s*\d+\s*\)/i.test(label)) return `Discarded ${secretName(label)}`;
  if (/^no secret objective scored$/i.test(label)) return "Didn't score a secret";
  if (/^no public objective scored$/i.test(label)) return "Didn't score a public objective";
  if (/^done (redistributing|gaining|losing) command tokens$/i.test(label)) return "Command tokens confirmed";
  if (/^dismiss( these)? buttons?$/i.test(label) || /^deleteButtons$/.test(id)) return "Dismissed a prompt";
  const words = ID_WORDS.find(([re]) => re.test(id));
  if (words) return typeof words[1] === "string" ? words[1] : words[1](id.match(words[0])!);
  if (/^ready for (?:the )?(.+)$/i.test(label)) return `Marked ready for the ${label.replace(/^ready for (?:the )?/i, "").toLowerCase()}`;
  return undefined;
}

/**
 * Buttons known by their id (wordless steppers "+" / "−", or ids whose label says nothing): what the press did. One
 * table for the outcome toast, the Undo button and the game log.
 */
const ID_WORDS: [RegExp, string | ((m: RegExpMatchArray) => string)][] = [
  [/^increase_(tactic|fleet|strategy)_cc$/, (m) => `Added 1 ${m[1]} token`],
  [/^decrease_(tactic|fleet|strategy)_cc$/, (m) => `Removed 1 ${m[1]} token`],
  [/^resetCCs$/, "Reset command tokens"],
  [/^resetSpend/, "Started paying over"],
  [/^declinePillage_/, "Didn't pillage"],
  [/^pillage_\w+_unchecked$/, "Started pillaging"],
];

/** Milty draft buttons carry only an emoji ("sliceD", "position3"): their words. */
function draftPick(id: string, label: string): string | undefined {
  const m = id.match(/^(milty|queueMilyPick)_(slice|order|faction)_(\w+)$/);
  if (!m) return undefined;
  const verb = m[1] === "milty" ? "Picked" : "Queued";
  if (m[2] === "slice") return `${verb} slice ${m[3].toUpperCase()}`;
  if (m[2] === "order") return `${verb} seat ${m[3]}`;
  return `${verb} ${label.trim() || m[3]}`;
}

/** "Discard (490) Become the Gatekeeper" → "Become the Gatekeeper". */
export function secretName(label: string) {
  return label.replace(/^discard\s*(\(\s*\d+\s*\))?\s*/i, "").trim() || label;
}

/** A label read as something done: "End Turn" → "Ended turn", "Don't score" → "Didn't score", "Xxcha" → "Chose Xxcha". */
/** Engine answers logged by their kind ("tactical.move") instead of a button's words: what they did. */
const KIND_PAST: Record<string, string> = {
  "tactical.activate": "Activated a system",
  "tactical.move": "Moved ships",
  "tactical.land": "Landed ground forces",
  "tactical.rift": "Rolled for the gravity rift",
  "tactical.conclude": "Finished the tactical action",
  "production.produce": "Produced units",
  "production.place": "Placed units",
  "payment.spend": "Paid",
  "command_tokens.adjust": "Placed command tokens",
  "status.homework": "Placed command tokens",
  "planet.ready": "Readied planets",
  "agenda.vote": "Voted",
  "agenda.vote_step": "Voted",
  "combat.assign_hits": "Assigned hits",
  "combat.hits": "Assigned hits",
  "combat.assign_units": "Chose units",
  "explore.planet": "Explored",
  "trade.offer": "Answered a trade offer",
  "tactical.activate_system": "Activated a system",
  "strategy_card.construction_place": "Placed a structure",
  "strategy_card.construction_build": "Placed a structure",
  "strategy_card.diplomacy_system": "Chose a system for Diplomacy",
  "tech.gain": "Researched a technology",
  "tech.choose_type": "Chose a technology type",
  "units.remove": "Removed units",
  "units.modify": "Changed units",
  "combat.round": "Rolled for combat",
  "combat.retreat": "Answered the retreat",
  "status.score": "Scored an objective",
  "trade.offer_sent": "Sent a trade offer",
  "action_card.play": "Played an action card",
  "action_card.discard": "Discarded an action card",
};

/** A kind id never reads as an id ("strategy_card.foo_bar" → "Answered foo bar"). */
function kindWords(kind: string): string {
  const last = kind.split(".").pop() ?? kind;
  return `Answered ${last.replace(/_/g, " ")}`;
}

export function pastTense(label: string): string {
  const text = cleanButtonLabel(label);
  if (!text) return "";
  const kind = KIND_PAST[text.trim()];
  if (kind) return kind;
  /* An engine kind with no plain words yet ("strategy_card.construction_place"): say it as words, not as an id. */
  if (/^[a-z_]+(\.[a-z_]+)+$/.test(text.trim())) return kindWords(text.trim());
  /* A stepper's "-" / "+" (no words): nothing to say; the caller says a button was pressed. */
  if (!/[\p{L}\p{N}]/u.test(text)) return "";
  const negated = text.match(/^(?:don['’]?t|do not)\s+(.*)$/i);
  if (negated) return `Didn't ${negated[1].charAt(0).toLowerCase()}${negated[1].slice(1)}`;
  /* "Done Landing Troops" → "Finished landing troops"; a bare "Done" → "Finished". */
  const done = text.match(/^done\b\s*(.*)$/i);
  if (done) return done[1] ? `Finished ${done[1].toLowerCase()}` : "Finished";
  /* "No Sabotage": a status, said in sentence case. */
  if (/^no\b/i.test(text)) return text.charAt(0) + text.slice(1).toLowerCase();
  if (/^ready\b/i.test(text)) return text.length > 5 ? text.charAt(0) + text.slice(1).toLowerCase() : "Marked ready";
  /* A system or a planet ("Nestphar (3/2)") is a name, not a command. */
  if (/^system \d/.test(text) || /\(\d+\/\d+\)\s*$/.test(label)) return `Chose ${text}`;
  const [first, ...rest] = text.split(" ");
  const past = PAST[first.toLowerCase()];
  if (!past) return `Chose ${text}`;
  const tail = rest.join(" ");
  if (!tail) return past;
  /* "End Turn" → "Ended turn"; keep proper names ("Keep Strengthen Bonds") as written. */
  const lowerTail = rest.length <= 2 && /^(turn|action|tactical action|component action|a |an |the |your )/i.test(tail);
  return `${past} ${lowerTail ? tail.toLowerCase() : tail}`;
}

/**
 * What pressing a bot button did, from its id (without the faction lock) and label. `content` is the pressed message's
 * text when known. A press that only opens the next step says what is being chosen ("Choosing a system to protect…").
 */
export function buttonOutcome(id: string, label: string, content?: string): string | undefined {
  const opening = openingStep(id, label);
  if (opening) return opening.now;
  return doneOutcome(id, label, content) ?? draftPick(id, label) ?? (pastTense(label) || undefined);
}

/**
 * The same press as something to take back: "Readied Nestphar", "Opened the end-of-turn abilities", "Picked Trade".
 * Undefined for a button with no words.
 */
export function buttonUndoPhrase(id: string, label: string): string | undefined {
  const opening = openingStep(id, label);
  if (opening) return opening.undo;
  return doneOutcome(id, label, undefined) ?? draftPick(id, label) ?? (label.trim() ? pastTense(label) : undefined);
}

/** "Readied Nestphar" → "readied Nestphar" (after "you" or a player's name). */
export function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * A saved action's label as words: "Alice pressed “command_tokens.adjust”" → "Alice placed command tokens", without
 * the engine's "(engine)" / "(engine answer)" marks. `id` is the pressed button's id when known.
 */
export function humanActionLabel(label: string, id = ""): string {
  const text = label.replace(/\s*\((?:engine|engine answer)\)\s*$/i, "").trim();
  const m = /^(.*?) pressed “(.*)”$/.exec(text);
  if (!m) return text;
  const phrase = buttonUndoPhrase(plainId(id), m[2]) ?? doneOutcome(plainId(id), "", undefined);
  return `${m[1]} ${phrase ? lowerFirst(phrase) : "made a choice"}`;
}
