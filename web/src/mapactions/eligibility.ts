import type { PlayerData, PlayerDataResponse } from "@/entities/data/types";
import type { Tile } from "@/entities/game/types";
import { getTileById } from "@/entities/lookup/systems";
import type { TacticalStep } from "./context";

export type Activation = { ok: true } | { ok: false; reason: string };

/**
 * Whether I can activate a system from the map right now, and if not, why (shown in the hover tooltip). The bot
 * still decides: this only mirrors its menu (`ButtonHelper.canActivateTile`) closely enough to light the right hexes.
 */
export function activationOf(
  tile: Tile,
  me: PlayerData | undefined,
  web: PlayerDataResponse | undefined,
  step: TacticalStep,
): Activation {
  const info = getTileById(tile.systemId);
  if (info?.isHyperlane) return { ok: false, reason: "Hyperlanes can't be activated" };
  if (tile.position === "special" || !tile.systemId) return { ok: false, reason: "Not a system" };
  if (!me) return { ok: false, reason: "You're watching this game" };
  if (step.kind !== "turn" && step.kind !== "choose") {
    if (step.kind === "move" || step.kind === "land") return { ok: false, reason: "Finish your current tactical action first" };
    return { ok: false, reason: "Not your turn" };
  }
  if (me.tacticalCC < 1) return { ok: false, reason: "No command tokens in your tactic pool" };
  const ccs = web?.tileUnitData?.[tile.position]?.ccs ?? tile.commandCounters ?? [];
  if (ccs.includes(me.color) || ccs.includes(me.faction)) return { ok: false, reason: "Your command token is already here" };
  if (info?.id?.toLowerCase() === "silver_flame") return { ok: false, reason: "This system can't be activated" };
  return { ok: true };
}
