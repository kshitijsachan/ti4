import { strategyStepRenderers } from "../index";
import type { RendererProps } from "../types";
import { isVoteExhaustStep, isVoteTotalStep, VoteExhaustBody, VoteTotalBody } from "./AgendaVotes";
import { CommodityBody, FragmentBody, isCommodityStep, isFragmentStep, isScTradeGoodStep, ScTradeGoodBody } from "./Economy";
import { isLadderStep, LadderBody } from "./Ladder";

/**
 * Counter panels: prompts the bot asks as ladders of buttons or repeated presses, each rebuilt as one panel with
 * `Quantity` counters and one confirm (see docs/COUNTERS.md). Registered as step renderers (first match wins).
 * Imported for its side effect by `decisions/index.ts`.
 */
strategyStepRenderers.push((props: RendererProps) => {
  const { d } = props;
  if (isVoteExhaustStep(d.choices)) return <VoteExhaustBody {...props} />;
  if (isVoteTotalStep(d.choices)) return <VoteTotalBody {...props} />;
  if (isCommodityStep(d.choices)) return <CommodityBody {...props} />;
  if (isFragmentStep(d.choices)) return <FragmentBody {...props} />;
  if (isScTradeGoodStep(d.choices)) return <ScTradeGoodBody {...props} />;
  if (isLadderStep(d)) return <LadderBody {...props} />;
  return null;
});
