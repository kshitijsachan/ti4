import { cdnImage } from "@/entities/data/cdnImage";
import classes from "./FactionIcon.module.css";

/** A faction's small icon (hidden if the image fails). */
export function FactionIcon({ faction, size = 18 }: { faction?: string; size?: number }) {
  if (!faction) return null;
  return (
    <img
      src={cdnImage(`/factions/${faction}.png`)}
      alt=""
      width={size}
      height={size}
      className={classes.icon}
      onError={(e) => (e.currentTarget.style.visibility = "hidden")}
    />
  );
}
