import { create } from "zustand";
import type { Decision, GameState } from "../../../shim/src/engine/types";

/*
 * Map-first answers for engine decisions whose choices are systems or planets (Umbat's system, Construction's planet,
 * a "choose a system / planet" step…): the decision popup publishes the shown decision's targets here, the map layer
 * marks those systems and a click there answers (one confirm on the system). The popup's buttons stay as a fallback.
 */

export type MapPickChoice = { optionId: string; label: string };

export type EngineMapPick = {
  decisionId: string;
  /** Map position → the choices it answers (several planets of one system: one per planet). */
  byPosition: Record<string, MapPickChoice[]>;
  answer: (optionId: string) => void;
};

export const useEngineMapPick = create<{ pick: EngineMapPick | null; set: (pick: EngineMapPick | null) => void }>((set) => ({
  pick: null,
  set: (pick) => set({ pick }),
}));

/** Kinds whose typed options target a system (`tile`) or a planet (`planet`) the player picks. */
const MAP_KINDS = new Set([
  "leader.use",
  "faction.ability",
  "strategy_card.construction_place",
  "strategy_card.diplomacy_system",
  "choose.system",
  "choose.planet",
]);

const STRUCTURE: Record<string, string> = { pds: "PDS", spacedock: "space dock" };

type MapValue = { tile?: unknown; planet?: unknown; planetName?: unknown; tileName?: unknown; unit?: unknown; action?: unknown };

/** The system a planet is in, from the engine's map. */
export function planetPosition(state: GameState | null | undefined, planet: string): string | undefined {
  return state?.tiles.find((t) => t.holders.some((h) => h.name === planet))?.position;
}

/**
 * The shown decision's map targets: each live typed option naming a system or a planet, by map position. Null when
 * the decision is not one picked on the map, or no option names a place on it.
 */
export function mapTargets(
  d: Decision | undefined,
  state: GameState | null | undefined,
  planetLabel: (planet: string) => string,
): Record<string, MapPickChoice[]> | null {
  if (!d || !MAP_KINDS.has(d.kind)) return null;
  const out: Record<string, MapPickChoice[]> = {};
  for (const o of d.options) {
    const v = o.value as MapValue | null;
    if (!v || o.disabled || o.needsInput) continue;
    if (v.action === "skip") continue;
    const planet = typeof v.planet === "string" && v.planet ? v.planet : null;
    const tile = typeof v.tile === "string" && v.tile && v.tile !== "null" ? v.tile : null;
    const position = tile ?? (planet ? planetPosition(state, planet) : undefined);
    if (!position) continue;
    const where = planet ? (typeof v.planetName === "string" && v.planetName) || planetLabel(planet) : `system ${position}`;
    const label =
      d.kind === "strategy_card.construction_place" && typeof v.unit === "string"
        ? `Place a ${STRUCTURE[v.unit] ?? v.unit} on ${where}`
        : planet
          ? `Choose ${where}`
          : `Choose ${(typeof v.tileName === "string" && v.tileName) || where}`;
    (out[position] ??= []).push({ optionId: o.id, label });
  }
  return Object.keys(out).length ? out : null;
}
