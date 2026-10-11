import type { Message } from "@/discord";
import { getStrategyCardByInitiative } from "@/entities/lookup/strategyCards";
import { baseId, choicesOf, cleanLabel } from "../model/controls";

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

const SO_DISCARD = /^(?:discardSecret_|SODISCARD_)\d+$/;
const NO_FOLLOW = /^(?:sc_no_follow_|preDeclineSC_)(\d+)/;

/** "Discard (490) Become the Gatekeeper" → "Become the Gatekeeper". */
function secretName(label: string) {
  return label.replace(/^discard\s*(\(\s*\d+\s*\))?\s*/i, "").trim() || label;
}

/** A label read as something done: "End Turn" → "Ended turn", "Don't score" → "Didn't score", "Xxcha" → "Chose Xxcha". */
export function pastTense(label: string): string {
  const text = label.replace(/\s+/g, " ").trim();
  if (!text) return "";
  const negated = text.match(/^(?:don['’]?t|do not)\s+(.*)$/i);
  if (negated) return `Didn't ${negated[1].charAt(0).toLowerCase()}${negated[1].slice(1)}`;
  if (/^no\b/i.test(text) || /^done\b/i.test(text)) return text;
  if (/^ready\b/i.test(text)) return text.length > 5 ? text : "Marked ready";
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
 * What a press I just made did, in a few words, from the button itself: the fallback outcome note when the bot has
 * nothing to say in the game log ("Kept Strengthen Bonds", "Passed", "Ended turn", "Not following Technology").
 */
export function pressOutcome(m: Message | undefined, customId: string, values?: string[]): string | undefined {
  if (!m) return undefined;
  const choices = choicesOf(m);
  const choice = choices.find((c) => c.customId === customId);
  const id = baseId(customId);
  /* Utilities (refresh, show map, player settings) change nothing in the game: no note. */
  if (choice?.rank === "more") return undefined;

  const noFollow = id.match(NO_FOLLOW);
  if (noFollow) {
    const card = getStrategyCardByInitiative(Number(noFollow[1]))?.name;
    return card ? `Not following ${card}` : "Not following";
  }
  if (SO_DISCARD.test(id) && choice) {
    const secrets = choices.filter((c) => SO_DISCARD.test(baseId(c.customId)));
    const other = secrets.length === 2 ? secrets.find((c) => c !== choice) : undefined;
    return other ? `Kept ${secretName(other.label)}` : `Discarded ${secretName(choice.label)}`;
  }
  if (choice?.kind === "select") {
    const options = choice.component.options ?? [];
    const picked = (values ?? []).map((v) => cleanLabel(options.find((o) => o.value === v)?.label ?? v)).filter(Boolean);
    if (!picked.length) return undefined;
    return `Chose ${picked.join(", ")}`;
  }
  const label = choice?.label ?? "";
  return pastTense(label) || undefined;
}
