import { useMemo } from "react";
import type { Decision } from "./contract";
import { useEngine, useMyDecisions } from "./store";
import type { OrderExtras } from "./order";
import { orderDecisions } from "./order";

export { decisionEyebrow, decisionTitle, orderDecisions } from "./order";

/** My decisions in answering order, live (the popup's queue; background prompts excluded). */
export function useMyQueue(): Decision[] {
  const mine = useMyDecisions();
  const answeredAtSeq = useEngine((s) => s.lastAnswer?.seq ?? null);
  const answeredKind = useEngine((s) => s.lastAnswer?.decision.kind ?? null);
  const hidden = useEngine((s) => s.hidden);
  const state = useEngine((s) => s.view.state);
  const extra = useOrderExtras();
  return useMemo(() => orderDecisions(mine, answeredAtSeq, hidden, state, answeredKind, extra).queue, [mine, answeredAtSeq, hidden, state, answeredKind, extra]);
}

/** What the queue order needs besides my decisions: the decision I last answered, what I set aside or superseded. */
export function useOrderExtras(): OrderExtras {
  const answeredId = useEngine((s) => s.lastAnswer?.decision.id ?? null);
  const deferred = useEngine((s) => s.deferred);
  const superseded = useEngine((s) => s.superseded);
  return useMemo(() => ({ answeredId, deferred, superseded }), [answeredId, deferred, superseded]);
}
