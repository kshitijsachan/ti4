/** The tactical-action step one bot prompt stands for, read from its button ids (no prompt objects: unit-testable). */
export type StepKind = { kind: "turn" | "choose" } | { kind: "move" | "land"; target: string };

const CHOOSE = /^(ringTile_|ring_|getTilesThisFarAway_)/;
const REPICK = /^(ChooseDifferentDestination|resetTacticalMovement)/;
const MOVE = /^(tacticalMoveFrom_|concludeMove_)/;
const LAND = /^(landUnits_|doneLanding)/;

export function stepKindOf(ids: string[], active: string | null): StepKind | null {
  if (!active) {
    /*
     * After Undo of an activation the bot re-posts the move prompt with "Get a Different Ring" / "Reset all unit
     * movement". With no system active that is the choose step (playtest 5, pbd283: map clicks opened the dossier).
     */
    if (ids.some((id) => CHOOSE.test(id) || REPICK.test(id))) return { kind: "choose" };
    /* Any other move / land prompt with no system active is a leftover, not the step (playtest 5, pbd273). */
    if (ids.some((id) => LAND.test(id) || MOVE.test(id))) return null;
  }
  if (ids.some((id) => LAND.test(id))) {
    const target = ids.map((id) => id.match(/^(?:landUnits|doneLanding)_([^_]+)/)?.[1]).find(Boolean) ?? active ?? "";
    return { kind: "land", target };
  }
  if (ids.some((id) => /^concludeMove_/.test(id))) {
    const target = ids.map((id) => id.match(/^concludeMove_(\w+)/)?.[1]).find(Boolean) ?? active ?? "";
    return { kind: "move", target };
  }
  if (ids.some((id) => MOVE.test(id)) && active) return { kind: "move", target: active };
  if (ids.some((id) => CHOOSE.test(id))) return { kind: "choose" };
  if (ids.includes("tacticalAction")) return { kind: "turn" };
  return null;
}
