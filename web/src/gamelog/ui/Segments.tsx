import { Fragment } from "react";
import { colors } from "@/entities/data/colors";
import type { Actor, Seg } from "../types";
import { actorLabel, needsGap, titleCase } from "../parse/markup";
import classes from "./Segments.module.css";

type RGB = { red: number; green: number; blue: number };
const byName = new Map<string, (typeof colors)[number]>();
for (const c of colors) {
  for (const n of [c.name, c.displayName, c.alias, ...c.aliases]) if (n) byName.set(n.toLowerCase(), c);
}

function rgbOf(name: string | undefined, which: "primary" | "secondary", depth = 0): RGB | undefined {
  const c = name ? byName.get(name.toLowerCase()) : undefined;
  if (!c || depth > 3) return undefined;
  const direct = which === "primary" ? c.primaryColor : c.secondaryColor;
  if (direct) return direct;
  const ref = which === "primary" ? c.primaryColorRef : c.secondaryColorRef;
  return ref ? rgbOf(ref, "primary", depth + 1) : undefined;
}

/** Faction keys as players say them. */
const FACTION_NAMES: Record<string, string> = {
  jolnar: "Jol-Nar",
  naaz: "Naaz-Rokha",
  nekro: "Nekro",
  keleresa: "Keleres",
  keleresm: "Keleres",
  keleresx: "Keleres",
  mahact: "Mahact",
  l1z1x: "L1Z1X",
  vaden: "Vaden",
  nomad: "Nomad",
  ghost: "Creuss",
  yin: "Yin",
  yssaril: "Yssaril",
  saar: "Saar",
  muaat: "Muaat",
  argent: "Argent",
  cabal: "Vuil'raith",
  empyrean: "Empyrean",
  titans: "Titans",
  winnu: "Winnu",
  xxcha: "Xxcha",
  hacan: "Hacan",
  sol: "Sol",
  mentak: "Mentak",
  sardakk: "Sardakk",
  arborec: "Arborec",
  letnev: "Letnev",
};

export function factionLabel(key: string): string {
  return FACTION_NAMES[key] ?? titleCase(key);
}

const css = (c: RGB) => `rgb(${c.red}, ${c.green}, ${c.blue})`;

/** The player's colour as a small swatch (split for two-tone colours). */
export function ColorDot({ color }: { color?: string }) {
  const p = rgbOf(color, "primary");
  if (!p) return null;
  const s = rgbOf(color, "secondary");
  const background = s ? `linear-gradient(135deg, ${css(p)} 50%, ${css(s)} 50%)` : css(p);
  return <span className={classes.dot} style={{ background }} title={color} aria-hidden />;
}

type EmojiProps = { id: string; name: string; size?: "text" | "icon"; decorative?: boolean };

/** A bot emoji. One that fails to load disappears rather than leaving its name jammed against the next word. */
export function EmojiImg({ id, name, size = "text", decorative }: EmojiProps) {
  return (
    <img
      className={size === "icon" ? classes.icon : classes.emoji}
      src={`/emojis/${id}`}
      alt={decorative ? "" : ` ${name} `}
      title={name}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={(e) => (e.currentTarget.style.display = "none")}
    />
  );
}

/** Faction icon + name (faction) + colour swatch: "Kshitij (Sardakk)". Real spaces, so copied text reads right too. */
export function ActorName({ actor, iconless }: { actor: Actor; iconless?: boolean }) {
  const label = actorLabel(actor) || "Someone";
  const faction = actor.name && actor.faction ? factionLabel(actor.faction) : undefined;
  return (
    <span className={classes.actor} title={[actor.name, actor.faction, actor.color].filter(Boolean).join(" · ")}>
      {!iconless && actor.factionEmoji && <EmojiImg id={actor.factionEmoji.id} name={actor.faction ?? ""} size="icon" decorative />}
      <span className={classes.actorName}>{label}</span>
      {faction && (
        <>
          {" "}
          <span className={classes.actorFaction}>({faction})</span>
        </>
      )}
      <ColorDot color={actor.color} />
    </span>
  );
}

export function Segments({ segs }: { segs: Seg[] }) {
  return (
    <>
      {segs.map((s, i) => {
        const gap = needsGap(segs[i - 1], s) ? " " : null;
        let el;
        if (s.t === "text") el = <span>{s.v}</span>;
        else if (s.t === "b") el = <strong className={classes.key}>{s.v}</strong>;
        else if (s.t === "emoji") el = <EmojiImg id={s.id} name={s.name} />;
        else el = <ActorName actor={s.actor} />;
        return (
          <Fragment key={i}>
            {gap}
            {el}
          </Fragment>
        );
      })}
    </>
  );
}
