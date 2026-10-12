import type { PlayerData, PlayerDataResponse } from "@/entities/data/types";

/**
 * What concluding a tactical action does to a frontier token in the active system. The bot explores it on
 * "Conclude" (ButtonHelper.exploreDET) only when the player has Dark Energy Tap (or Twilight's Fall Antimatter)
 * and still has ships there; there is no separate button for it.
 * - `explores`: concluding explores the token.
 * - `needsTech`: my ships are there but I lack the technology, so the token stays.
 * - `noShips`: I have the technology but no ships left there.
 */
export type FrontierOutcome = "explores" | "needsTech" | "noShips";

const FRONTIER_TECHS = ["det", "antimatter"];
/** Units in a space area that are not ships (ground forces carried along, structures). */
const NOT_SHIPS = new Set(["gf", "mf", "pd", "sd"]);

export function frontierOutcome(web: PlayerDataResponse | undefined, me: PlayerData | undefined, position: string | undefined): FrontierOutcome | null {
  if (!web || !me || !position) return null;
  const space = web.tileUnitData?.[position]?.space;
  if (!space) return null;
  const hasFrontier = Object.values(space).some((entities) => entities.some((e) => e.entityType === "token" && e.entityId === "frontier"));
  if (!hasFrontier) return null;
  const mine = space[me.faction] ?? space[me.color] ?? [];
  const ships = mine.some((e) => e.entityType === "unit" && e.count > 0 && !NOT_SHIPS.has(e.entityId));
  const tech = FRONTIER_TECHS.some((t) => me.techs?.includes(t));
  if (!tech) return ships ? "needsTech" : null;
  return ships ? "explores" : "noShips";
}

export const FRONTIER_NOTE: Record<FrontierOutcome, string> = {
  explores: "Concluding the action explores the frontier token here (Dark Energy Tap).",
  needsTech: "Frontier tokens can only be explored with Dark Energy Tap, so this one stays on the map.",
  noShips: "You have no ships left here, so Dark Energy Tap cannot explore this frontier token.",
};

export const FRONTIER_CONCLUDE_LABEL = "Explore the frontier token (Dark Energy Tap) & conclude";
