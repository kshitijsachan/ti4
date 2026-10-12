import { useMemo } from "react";
import type { Decision } from "./contract";
import { useEngine, useMyDecisions } from "./store";
import { orderDecisions } from "./order";

export { decisionEyebrow, decisionTitle, orderDecisions } from "./order";

/** My decisions in answering order, live (the popup's queue; background prompts excluded). */
export function useMyQueue(): Decision[] {
  const mine = useMyDecisions();
  const answeredAtSeq = useEngine((s) => s.lastAnswer?.seq ?? null);
  const answeredKind = useEngine((s) => s.lastAnswer?.decision.kind ?? null);
  const hidden = useEngine((s) => s.hidden);
  const state = useEngine((s) => s.view.state);
  return useMemo(() => orderDecisions(mine, answeredAtSeq, hidden, state, answeredKind).queue, [mine, answeredAtSeq, hidden, state, answeredKind]);
}
