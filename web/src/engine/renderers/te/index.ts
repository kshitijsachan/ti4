import type { ComponentType } from "react";
import { Breach, Breakthrough, Plot } from "./TeStepRenderers";
import { Expedition, FractureIngress, FractureRoll, Galvanize, PlaceThundersEdge, Visionaria, type TeRendererProps } from "./TeRenderers";

/** Thunder's Edge (G10) renderers by decision kind; wired by the engine renderer registry (import.meta.glob). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const renderers: Record<string, ComponentType<TeRendererProps<any>>> = {
  "te.fracture.roll": FractureRoll,
  "te.fracture.ingress": FractureIngress,
  "te.galvanize": Galvanize,
  "te.expedition": Expedition,
  "te.thunders_edge.place": PlaceThundersEdge,
  "te.visionaria.respond": Visionaria,
  "te.breakthrough": Breakthrough,
  "te.breach": Breach,
  "te.plot": Plot,
};
