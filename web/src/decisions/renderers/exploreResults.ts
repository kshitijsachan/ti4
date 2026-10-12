import { usePlay } from "@/discord";
import { cleanLabel } from "../../prompts/controls";

/**
 * What this tactical action's explores found so far ("Quann → Mining World: gain 1 trade good"), oldest first: every
 * explore since the newest activation in this channel (and within this turn), so each step keeps the earlier results
 * in view and nothing from an earlier action leaks into a later one.
 */
export function useExploreResults(channelId: string): string[] {
  const data = usePlay((s) => s.messages[channelId]);
  if (!data) return [];
  const out: string[] = [];
  for (let i = data.ids.length - 1; i >= 0; i--) {
    const m = data.byId[data.ids[i]];
    if (!m?.author.bot) continue;
    /* This action's only: stop at its activation, or at the turn boundary before it (a strategic action explores nothing). */
    if (/\bactivated \d+|\bended turn\b|\bit is now your turn\b|\bplayed by\b/i.test(m.content)) break;
    const embed = m.embeds?.[0];
    if (!/\bexplored\b/i.test(m.content) || !embed?.title) continue;
    const planet = /explored the\s*(?:<a?:\w+:\d+>)?\s*frontier token/i.test(m.content)
      ? "Frontier token"
      : cleanLabel(m.content).match(/explored\s+(?:\w+\s+)?Planet\s+(.+?)\s+in tile/i)?.[1]?.replace(/[_*]/g, "").trim();
    const name = cleanLabel(embed.title).replace(/[_*]/g, "").trim();
    const what = cleanLabel(embed.description ?? "").replace(/[_*]/g, "").trim();
    out.unshift(`${planet ? `${planet} → ` : ""}${name}${what ? `: ${what}` : ""}`);
  }
  return out;
}
