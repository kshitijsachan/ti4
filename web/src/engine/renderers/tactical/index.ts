import type { ComponentType } from "react";
import {
  TacticalActivateView,
  TacticalConcludeView,
  TacticalLandView,
  TacticalMoveView,
  TacticalRiftView,
  TurnActionView,
  type RendererProps,
} from "./TacticalRenderers";

export type { DirectAction, RendererProps } from "./TacticalRenderers";

/** G3 renderers keyed by decision kind (wired by the engine renderer registry). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const renderers: Record<string, ComponentType<RendererProps<any>>> = {
  "turn.action": TurnActionView,
  "tactical.activate": TacticalActivateView,
  "tactical.move": TacticalMoveView,
  "tactical.land": TacticalLandView,
  "tactical.conclude": TacticalConcludeView,
  "tactical.rift": TacticalRiftView,
};
