import classes from "./Emoji.module.css";
import type { PartialEmoji } from "../types";

type Props = { id: string; name: string; animated?: boolean; size?: "text" | "jumbo" | "button" };

/** A custom emoji served by the shim at `/emojis/{id}`, sized to the surrounding text. */
export function Emoji({ id, name, size = "text" }: Props) {
  return (
    <img
      className={`${classes.emoji} ${classes[size]}`}
      src={`/emojis/${id}`}
      alt={`:${name}:`}
      title={`:${name}:`}
      loading="lazy"
      decoding="async"
      draggable={false}
    />
  );
}

/** Component emoji: custom (has id) or a unicode character in `name`. */
export function ComponentEmoji({ emoji }: { emoji: PartialEmoji | null | undefined }) {
  if (!emoji) return null;
  if (emoji.id) return <Emoji id={emoji.id} name={emoji.name ?? "emoji"} size="button" />;
  if (!emoji.name) return null;
  return <span className={classes.unicode}>{emoji.name}</span>;
}
