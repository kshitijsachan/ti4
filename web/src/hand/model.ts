import { explorations } from "@/entities/data/explorations";
import { indexBy } from "@/entities/lookup/indexBy";
import type { GameState, PlayerData, PromissoryNote } from "@/entities/data/types";
import { actionCardData, promissoryData, relicData, secretData } from "./cardData";

export type HandResponse = {
  actionCards: string[];
  secretObjectives: string[];
  promissoryNotes: string[];
};

export type CardKind = "ac" | "so" | "pn" | "relic" | "fragment";

export type CardOwner = {
  faction: string;
  color: string;
  name: string;
};

/** One card in the player's hand (or face up in front of them), in display form. */
export type HandCard = {
  /** Unique within the hand (alias, plus `#n` for duplicate aliases). */
  key: string;
  kind: CardKind;
  alias: string;
  name: string;
  /** "Action card", "Secret objective", ... */
  typeLabel: string;
  /** When it can be used: "Action", "After an agenda is revealed", "Status phase"... */
  window?: string;
  text: string;
  flavor?: string;
  /** Secret objectives: points. */
  vp?: number;
  scored?: boolean;
  /** Promissory notes: whose note it is. */
  owner?: CardOwner;
  /** Promissory notes face up in my play area. */
  inPlayArea?: boolean;
  exhausted?: boolean;
  /** Real card art (relics). */
  imageUrl?: string;
  /** Fragments: how many of this kind. */
  count?: number;
};

export type CardGroupId = "ac" | "so" | "pn" | "relic";

export type CardGroup = {
  id: CardGroupId;
  label: string;
  cards: HandCard[];
};

const explorationMap = indexBy(explorations, (card) => card.id);

const FRAGMENT_TYPES: Record<string, string> = {
  c: "Cultural",
  h: "Hazardous",
  i: "Industrial",
  u: "Unknown",
};

/** Text before the first colon of a card text, when it reads like a timing window. */
function splitWindow(text: string): { window?: string; body: string } {
  const match = /^([^:.]{3,90}):\s*(.+)$/s.exec(text.trim());
  if (!match) return { body: text };
  const head = match[1].trim();
  if (!/^(action|when|after|at |during|before|once|you may|if )/i.test(head))
    return { body: text };
  return { window: head.toUpperCase() === "ACTION" ? "Action" : head, body: match[2] };
}

function resolvePromissoryNote(
  alias: string,
  players: PlayerData[],
): { note: Partial<PromissoryNote>; owner?: CardOwner } | undefined {
  const direct = promissoryData(alias);
  if (direct) {
    const ownerPlayer = players.find((p) => p.faction === direct.faction);
    return { note: direct, owner: ownerPlayer && toOwner(ownerPlayer) };
  }
  const cut = alias.indexOf("_");
  if (cut < 0) return undefined;
  const color = alias.slice(0, cut);
  const template = promissoryData(`<color>_${alias.slice(cut + 1)}`);
  if (!template) return undefined;
  const ownerPlayer = players.find((p) => p.color === color);
  return { note: template, owner: ownerPlayer ? toOwner(ownerPlayer) : undefined };
}

function toOwner(player: PlayerData): CardOwner {
  return { faction: player.faction, color: player.color, name: player.userName };
}

function colorize(text: string, owner?: CardOwner) {
  return text.replace(/<color>/g, owner ? capitalize(owner.color) : "the owning");
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function actionCard(alias: string): HandCard {
  const data = actionCardData(alias);
  if (!data?.name)
    return { key: alias, kind: "ac", alias, name: alias, typeLabel: "Action card", text: "" };
  return {
    key: alias,
    kind: "ac",
    alias,
    name: data.name,
    typeLabel: "Action card",
    window: data.window?.replace(/:$/, ""),
    text: data.text ?? "",
    flavor: data.flavorText,
  };
}

function secretObjective(alias: string, scored: boolean): HandCard {
  const data = secretData(alias);
  const phase = data?.phase ? capitalize(data.phase.toLowerCase()) : undefined;
  return {
    key: alias,
    kind: "so",
    alias,
    name: data?.name ?? alias,
    typeLabel: "Secret objective",
    window: phase ? `${phase} phase` : undefined,
    text: data?.text ?? "",
    vp: data?.points ?? 1,
    scored,
  };
}

function promissoryNote(
  alias: string,
  players: PlayerData[],
  inPlayArea: boolean,
): HandCard {
  const resolved = resolvePromissoryNote(alias, players);
  if (!resolved)
    return { key: alias, kind: "pn", alias, name: alias, typeLabel: "Promissory note", text: "", inPlayArea };
  const { note, owner } = resolved;
  const text = colorize(note.text ?? "", owner);
  const { window, body } = splitWindow(text);
  return {
    key: alias,
    kind: "pn",
    alias,
    name: colorize(note.name ?? alias, owner),
    typeLabel: "Promissory note",
    window,
    text: body,
    owner,
    inPlayArea,
  };
}

function relic(alias: string, exhausted: boolean): HandCard {
  const data = relicData(alias);
  const { window, body } = splitWindow(data?.text ?? "");
  return {
    key: alias,
    kind: "relic",
    alias,
    name: data?.name ?? alias,
    typeLabel: "Relic",
    window,
    text: body,
    flavor: data?.flavourText,
    imageUrl: data?.imageURL,
    exhausted,
  };
}

function fragments(ids: string[]): HandCard[] {
  const byType = new Map<string, string[]>();
  for (const id of ids) {
    const type = FRAGMENT_TYPES[id.charAt(0)] ?? "Unknown";
    byType.set(type, [...(byType.get(type) ?? []), id]);
  }
  return [...byType.entries()].map(([type, list]) => {
    const data = explorationMap.get(list[0]);
    return {
      key: `frag-${type}`,
      kind: "fragment" as const,
      alias: list[0],
      name: `${type} fragment`,
      typeLabel: "Relic fragment",
      window: "Action",
      text:
        type === "Unknown"
          ? "Counts as a fragment of any type when you purge fragments to gain a relic."
          : (data?.text ?? "").replace(/^ACTION:\s*/i, ""),
      count: list.length,
    };
  });
}

/** Builds the grouped hand from the seat's hand endpoint and its public web-data row. */
export function buildHand(
  hand: HandResponse | undefined,
  me: PlayerData | undefined,
  players: PlayerData[],
): CardGroup[] {
  const acs = (hand?.actionCards ?? []).map(actionCard);
  // The hand endpoint can lag a fresh score by a poll; the public scored list wins.
  const scoredIds = Object.keys(me?.secretsScored ?? {});
  const unscored = (hand?.secretObjectives ?? []).filter((a) => !scoredIds.includes(a)).map((a) => secretObjective(a, false));
  const scored = scoredIds.map((a) => secretObjective(a, true));
  const playArea = new Set(me?.promissoryNotesInPlayArea ?? []);
  const handPns = (hand?.promissoryNotes ?? []).filter((a) => !playArea.has(a));
  // Notes from other players first (those are the ones you can play), then those in play, then your own.
  const mine = (card: HandCard) => !!me && card.owner?.color === me.color;
  const held = handPns.map((a) => promissoryNote(a, players, false));
  const pns = [
    ...held.filter((c) => !mine(c)),
    ...[...playArea].map((a) => promissoryNote(a, players, true)),
    ...held.filter(mine),
  ];
  const exhaustedRelics = new Set(me?.exhaustedRelics ?? []);
  const relics = [
    ...(me?.relics ?? []).map((a) => relic(a, exhaustedRelics.has(a))),
    ...fragments(me?.fragments ?? []),
  ];
  return [
    { id: "ac", label: "Action cards", cards: dedupeKeys(acs) },
    { id: "so", label: "Secret objectives", cards: [...unscored, ...scored] },
    { id: "pn", label: "Promissory notes", cards: dedupeKeys(pns) },
    { id: "relic", label: "Relics", cards: relics },
  ];
}

function dedupeKeys(cards: HandCard[]): HandCard[] {
  const seen = new Map<string, number>();
  return cards.map((card) => {
    const n = seen.get(card.key) ?? 0;
    seen.set(card.key, n + 1);
    return n === 0 ? card : { ...card, key: `${card.key}#${n}` };
  });
}

/** "blocked": its window may be open, but the bot refuses it (over the action card hand limit). */
export type Timing = "now" | "later" | "reaction" | "blocked";

/**
 * Whether a card's timing window is open right now, judged from the public game
 * state. "reaction" means it answers an event the state does not track.
 */
export function timingOf(
  card: HandCard,
  state: GameState | undefined,
  myColor: string | undefined,
): Timing {
  const window = (card.window ?? "").toLowerCase();
  const phase = state?.phase ?? "unknown";
  const myTurn = !!myColor && state?.activePlayer === myColor;
  if (card.kind === "so") {
    // Action-phase secrets score the moment you achieve one, which the public state cannot tell, so they never
    // light up as open; the popup still offers Score.
    if (window.startsWith("action")) return "later";
    // Secrets score in the status phase's scoring step only, not during its homework.
    if (window.startsWith("status")) return phase === "status.scoring" ? "now" : "later";
    return "later";
  }
  if (window === "action") return phase === "action" && myTurn ? "now" : "later";
  if (/agenda is revealed/.test(window)) {
    if (window.startsWith("when")) return phase === "agenda.whens" ? "now" : "later";
    if (window.startsWith("after")) return phase === "agenda.afters" ? "now" : "later";
  }
  if (/start of the agenda phase/.test(window))
    return phase === "agenda.readyToFlip" ? "now" : "later";
  if (/status phase/.test(window)) return phase.startsWith("status") ? "now" : "later";
  if (/strategy phase/.test(window)) return phase === "strategy" ? "now" : "later";
  if (/vot/.test(window)) return phase === "agenda.voting" ? "now" : "later";
  if (/combat/.test(window)) {
    const inCombat = !!myColor && !!state?.activeCombat?.participantColors?.includes(myColor);
    return inCombat ? "now" : "later";
  }
  return "reaction";
}
