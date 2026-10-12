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
  if (/^componentAction(?!Res)/.test(id)) return { now: "Choosing a component action…", undo: "Opened the component actions" };
  /* "Score A Public" (Imperial) only lists the public objectives: nothing is scored until one is picked. */
  if (/^scoreAnObjective$/.test(id)) return { now: "Choosing a public objective to score…", undo: "Opened public objective scoring" };
  if (/^get_so_score_buttons$/.test(id)) return { now: "Choosing a secret objective to score…", undo: "Opened secret objective scoring" };
  if (/^get_so_discard_buttons$|^getDiscardButtons/.test(id)) return { now: "Choosing a card to discard…", undo: "Opened the discard choice" };
  if (/^diploSystem$/.test(id)) return { now: "Choosing a system to protect…", undo: "Started choosing a system to protect" };
  if (/^diploRefresh2$/.test(id)) return { now: "Choosing planets to ready…", undo: "Started readying planets" };
  if (/^redistributeCCButtons$/.test(id)) return { now: "Choosing command tokens…", undo: "Opened the command tokens" };
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
  if (/^no secret objective scored$/i.test(label)) return "Didn't score a secret";
  if (/^no public objective scored$/i.test(label)) return "Didn't score a public objective";
  if (/^done (redistributing|gaining|losing) command tokens$/i.test(label)) return "Command tokens confirmed";
  if (/^ready for (?:the )?(.+)$/i.test(label)) return `Marked ready for the ${label.replace(/^ready for (?:the )?/i, "").toLowerCase()}`;
  return undefined;
}

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
export function pastTense(label: string): string {
  const text = cleanButtonLabel(label);
  if (!text) return "";
  const negated = text.match(/^(?:don['’]?t|do not)\s+(.*)$/i);
  if (negated) return `Didn't ${negated[1].charAt(0).toLowerCase()}${negated[1].slice(1)}`;
  /* "Done Exhausting Planets", "No Sabotage": a status, said in sentence case. */
  if (/^no\b/i.test(text) || /^done\b/i.test(text)) return text.charAt(0) + text.slice(1).toLowerCase();
  if (/^ready\b/i.test(text)) return text.length > 5 ? text.charAt(0) + text.slice(1).toLowerCase() : "Marked ready";
  /* A system or a planet ("Nestphar (3/2)") is a name, not a command. */
  if (/^system \d/.test(text) || /\(\d+\/\d+\)\s*$/.test(label)) return `Chose ${text}`;
  const [first, ...rest] = text.split(" ");
  const past = PAST[first.toLowerCase()];
  if (!past) return `Chose “${text}”`;
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
