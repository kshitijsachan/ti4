import type { Message } from "@/discord";
import { compareSnowflakes } from "@/discord/shared/snowflake";
import { baseId, forwardChoices } from "./controls";

/** Where one player stands on one half of status-phase scoring. */
export type ScoreState =
  /** Not answered yet. */
  | { kind: "open" }
  /** Answered, but waits for an earlier player in scoring order. */
  | { kind: "queued" }
  /** Chose not to score. */
  | { kind: "none" }
  /** Scored this objective. */
  | { kind: "scored"; name: string };

export type ScoringLine = { name: string; po: ScoreState; so: ScoreState };

const STATUS_ID = /^(po_scoring_|po_no_scoring$|so_no_scoring$|get_so_score_buttons$)/;

/** The bot's status-phase "Please score objectives" message, with its live scoring summary. */
export function isScoringSummary(m: Message): boolean {
  return forwardChoices(m).some((c) => /^(po_no_scoring|so_no_scoring)$/.test(baseId(c.customId))) &&
    forwardChoices(m).every((c) => STATUS_ID.test(baseId(c.customId)) || /^(refreshStatusSummary|getSwapButtons_)/.test(baseId(c.customId)));
}

function stateOf(line: string): ScoreState {
  const rest = line.replace(/<a?:\w+:\d+>/g, "").replace(/^>\s*/, "").trim();
  if (rest.includes("❓")) return { kind: "open" };
  if (/queued/i.test(rest)) return { kind: "queued" };
  if (rest.includes("🙅")) return { kind: "none" };
  const scored = rest.match(/✅\s*(.+)$/)?.[1]?.trim();
  return scored ? { kind: "scored", name: scored.replace(/[_*]/g, "") } : { kind: "open" };
}

/**
 * The summary under "# Scoring Summary": per player, a header line (strategy card back, faction, name, colour)
 * then "> <public emojis> ❓|🙅|Queued|✅ name" and "> <secret emoji> …".
 */
export function scoringSummary(content: string): ScoringLine[] {
  const lines = content.split("\n");
  const start = lines.findIndex((l) => /Scoring Summary/i.test(l));
  if (start < 0) return [];
  const out: ScoringLine[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const head = lines[i];
    if (!head.trim() || head.startsWith(">")) continue;
    const po = lines[i + 1];
    const so = lines[i + 2];
    if (!po?.startsWith(">") || !so?.startsWith(">")) continue;
    const name = head
      .replace(/<a?:\w+:\d+>/g, "")
      .replace(/\*\*[^*]+\*\*\s*$/, "")
      .replace(/^\d+\.\s*/, "")
      .trim();
    out.push({ name, po: stateOf(po), so: stateOf(so) });
    i += 2;
  }
  return out;
}

/** My line of the summary, by any of my names. */
export function myScoringLine(lines: ScoringLine[], names: (string | undefined)[]): ScoringLine | undefined {
  const mine = names.filter((n): n is string => !!n).map((n) => n.toLowerCase());
  return lines.find((l) => mine.includes(l.name.toLowerCase())) ?? lines.find((l) => mine.some((n) => l.name.toLowerCase().startsWith(n)));
}

/** Whether I still owe an answer on a scoring summary message (true when it cannot tell). */
export function scoringOpenFor(m: Message, names: (string | undefined)[]): boolean | undefined {
  const line = myScoringLine(scoringSummary(m.content), names);
  if (!line) return undefined;
  return line.po.kind === "open" || line.so.kind === "open";
}

type Foldable = { id: string; kind: string; scoring?: { secretPick?: boolean }; steps?: Foldable[]; choices: { customId?: string }[] };

function foldInto<T extends Foldable>(list: T[], isLead: (d: T) => boolean, isStep: (d: T) => boolean): T[] {
  const lead = list.find(isLead);
  const steps = list.filter((d) => d !== lead && isStep(d));
  if (!lead || !steps.length) return list;
  return list.filter((d) => !steps.includes(d)).map((d) => (d === lead ? { ...d, steps: [...(d.steps ?? []), ...steps] } : d));
}

/** Status homework: the bot's "Redistribute, gain & confirm command tokens" button posts the token prompt. */
export function isHomework(d: Foldable) {
  return d.kind === "status" && d.choices.some((c) => baseId(c.customId) === "pass_on_abilities");
}

/**
 * Status-phase prompts that answer a press on another one belong inside it, so they show where I pressed rather
 * than queued behind it: the list of secrets to score (after "Score A Secret Objective") inside the scoring popup,
 * and the command-token prompt inside the status homework.
 */
export function foldScoring<T extends Foldable>(list: T[]): T[] {
  const scored = foldInto(
    list,
    (d) => d.kind === "scoring" && !d.scoring?.secretPick,
    (d) => d.kind === "scoring" && !!d.scoring?.secretPick,
  );
  const lead = scored.find(isHomework);
  return lead ? foldInto(scored, isHomework, (d) => d.kind === "gainTokens" && compareSnowflakes(d.id, lead.id) > 0) : scored;
}
