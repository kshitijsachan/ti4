import { getFactionImage } from "@/entities/lookup/factions";
import type { FragmentTrait } from "./types";

/** Icons shipped in web/public. */
export const ICONS = {
  tg: "/tg.png",
  comm: "/comms.png",
  pn: "/pnicon.png",
  relic: "/relicicon.webp",
} as const;

/** Fragment trait signal colours (CSS vars defined on the trade root). */
export const FRAGMENT_COLOR: Record<FragmentTrait, string> = {
  cultural: "var(--t-cultural)",
  hazardous: "var(--t-hazardous)",
  industrial: "var(--t-industrial)",
  frontier: "var(--t-frontier)",
};

export const FRAGMENT_LABEL: Record<FragmentTrait, string> = {
  cultural: "Cul",
  hazardous: "Haz",
  industrial: "Ind",
  frontier: "Fro",
};

/** Faction icon: the bot's faction emoji (served by the shim) when known, else the art tree. */
export const factionIcon = (faction: string, icon?: string | null) =>
  icon || getFactionImage(faction) || "";
