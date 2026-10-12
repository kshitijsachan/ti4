import type { PlayConnection } from "@/discord";
import type { PlanetId, UnitId } from "../../../shim/src/engine/types";
import type { TacticalLand } from "../../../shim/src/engine/kinds/tactical";
import { landViaEngine } from "./engine";

/** What the engine's landing step offers: per planet, which of my ground units can land. */
export type LandingOffer = {
  target: string;
  planets: string[];
  /** unit asyncId → planets it may land on. */
  units: Record<string, string[]>;
};

/** The landing offer from the tactical.land decision's "land" options. */
export function landingOffer(d: TacticalLand): LandingOffer | null {
  let target = "";
  const planets: string[] = [];
  const units: Record<string, string[]> = {};
  for (const o of d.options) {
    const v = o.value;
    if (o.disabled || !v || v.op !== "land") continue;
    target = v.position;
    if (!planets.includes(v.planet)) planets.push(v.planet);
    const list = (units[v.unit] ??= []);
    if (!list.includes(v.planet)) list.push(v.planet);
  }
  return target ? { target, planets, units } : null;
}

/** The landing step's gravity rift roll, when it offers one (an untyped option of the land decision). */
export function riftOption(d: TacticalLand) {
  return d.options.find((o) => !o.disabled && /^getRiftButtons_/.test(o.handler));
}

/** planet → unit → how many to land. */
export type LandingPlan = Record<string, Record<string, number>>;

/** Lands the planned ground forces and finishes landing, as one engine action. */
export async function commitLanding(
  conn: PlayConnection,
  decision: TacticalLand,
  plan: LandingPlan,
  onProgress?: (text: string) => void,
) {
  onProgress?.("Landing…");
  const landings = Object.entries(plan).flatMap(([planet, units]) =>
    Object.entries(units)
      .filter(([, n]) => n > 0)
      // Plan keys are the engine's planet / async unit ids.
      .map(([unit, count]) => ({ planet: planet as PlanetId, unit: unit as UnitId, count })),
  );
  await landViaEngine(conn, decision, landings);
}
