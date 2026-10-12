import type { Message } from "@/discord";
import { getStrategyCardByInitiative } from "@/entities/lookup/strategyCards";
import { baseId, choicesOf, cleanLabel } from "../../prompts/controls";
import { buttonOutcome, secretName } from "../../prompts/phrasing";

const SO_DISCARD = /^(?:discardSecret_|SODISCARD_)\d+$/;
const NO_FOLLOW = /^(?:sc_no_follow_|preDeclineSC_)(\d+)/;

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
  return buttonOutcome(id, label === choice?.emojiName ? "" : label, m.content);
}
