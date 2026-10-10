import type { ReactNode } from "react";
import type { Decision } from "../model/classify";
import { AgendaBody, AgendaPeekBody } from "./Agenda";
import { CombatBody } from "./Combat";
import { GainTokensBody, SpendBody } from "./Economy";
import { GenericBody, TacticalBody } from "./Generic";
import { ScoringBody } from "./Objectives";
import { StatusBody } from "./Status";
import { ReactionBody } from "./Reaction";
import { ScFollowBody, ScPickBody, ScPrimaryBody } from "./Strategy";
import { SecretDiscardBody } from "./SecretDiscard";
import { TechBody } from "./Tech";
import { TradeBody } from "./Trade";
import { TurnBody } from "./Turn";
import type { RendererProps } from "./types";

/**
 * Per-card bodies for a played strategy card (my primary, or following someone else's), keyed by initiative.
 * Card-specific renderers register here (e.g. from renderers/strategy/**); a card without one gets the generic body.
 */
export type StrategyCardRenderer = Partial<Record<"primary" | "follow", (props: RendererProps) => ReactNode>>;
export const strategyCardRenderers: Partial<Record<number, StrategyCardRenderer>> = {};

export function registerStrategyCardRenderer(initiative: number, renderer: StrategyCardRenderer) {
  strategyCardRenderers[initiative] = { ...strategyCardRenderers[initiative], ...renderer };
}

/** The body of a decision popup, by decision kind. */
export function renderBody(d: Decision, props: RendererProps): ReactNode {
  const card = d.sc ? strategyCardRenderers[d.sc] : undefined;
  if (d.kind === "scPrimary" && card?.primary) return card.primary(props);
  if (d.kind === "scFollow" && !d.optional && card?.follow) return card.follow(props);
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
    case "tech":
      return <TechBody {...props} />;
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
    case "status":
      return <StatusBody {...props} />;
    case "scoring":
      return <ScoringBody {...props} />;
    case "secretDiscard":
      return <SecretDiscardBody {...props} />;
    default:
      return <GenericBody {...props} />;
  }
}

/** Decisions that lay out cards side by side get the wide popup. */
export function isWide(d: Decision) {
  return d.kind === "scPick" || d.kind === "combat" || d.kind === "turn";
}
