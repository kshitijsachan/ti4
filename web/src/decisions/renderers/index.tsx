import type { ReactNode } from "react";
import type { Decision } from "../model/classify";
import { AgendaBody, AgendaPeekBody } from "./Agenda";
import { CombatBody } from "./Combat";
import { GainTokensBody, SpendBody } from "./Economy";
import { GenericBody, TacticalBody } from "./Generic";
import { ReactionBody } from "./Reaction";
import { ScFollowBody, ScPickBody, ScPrimaryBody } from "./Strategy";
import { TradeBody } from "./Trade";
import { TurnBody } from "./Turn";
import type { RendererProps } from "./types";

/** The body of a decision popup, by decision kind. */
export function renderBody(d: Decision, props: RendererProps): ReactNode {
  switch (d.kind) {
    case "scPick":
      return <ScPickBody {...props} />;
    case "scPrimary":
      return <ScPrimaryBody {...props} />;
    case "scFollow":
      return <ScFollowBody {...props} />;
    case "turn":
      return <TurnBody {...props} />;
    case "tactical":
      return <TacticalBody {...props} />;
    case "agendaPeek":
      return <AgendaPeekBody {...props} />;
    case "agenda":
      return <AgendaBody {...props} />;
    case "combat":
      return <CombatBody {...props} />;
    case "transaction":
      return <TradeBody {...props} />;
    case "spend":
      return <SpendBody {...props} />;
    case "gainTokens":
      return <GainTokensBody {...props} />;
    case "reaction":
      return <ReactionBody {...props} />;
    default:
      return <GenericBody {...props} />;
  }
}

/** Decisions that lay out cards side by side get the wide popup. */
export function isWide(d: Decision) {
  return d.kind === "scPick" || d.kind === "combat" || d.kind === "turn";
}
