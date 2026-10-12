import cx from "clsx";
import { TECH_SKIP_IMAGES, type TechType } from "@/shared/ui/TechSkipIcon";
import { PlanetTraitIcon } from "@/shared/ui/PlanetTraitIcon";
import type { PlanetTrait } from "@/entities/game/planetTraits";
import classes from "../Draft.module.css";

type GlyphProps = {
  src?: string | null;
  alt: string;
  size?: number;
  title?: string;
};

/** A small inline icon; renders nothing when the bot couldn't resolve the emoji. */
export function Glyph({ src, alt, size = 14, title }: GlyphProps) {
  if (!src) return null;
  return (
    <img
      className={classes.glyph}
      src={src}
      alt={alt}
      title={title ?? alt}
      width={size}
      height={size}
      draggable={false}
    />
  );
}

const WORMHOLE_LETTER: Record<string, string> = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
};

export function WormholeGlyph({
  type,
  icons,
  size = 14,
}: {
  type: string;
  icons: Record<string, string>;
  size?: number;
}) {
  const src = icons[type];
  if (src) return <Glyph src={src} alt={`${type} wormhole`} size={size} />;
  return (
    <span className={classes.wormholeLetter} title={`${type} wormhole`}>
      {WORMHOLE_LETTER[type] ?? type.slice(0, 1)}
    </span>
  );
}

export function SkipGlyph({
  skip,
  size = 14,
}: {
  skip: string;
  size?: number;
}) {
  const src = TECH_SKIP_IMAGES[skip as TechType];
  if (!src) return null;
  return <Glyph src={src} alt={`${skip} skip`} size={size} />;
}

export function TraitGlyph({
  traits,
  size = 14,
}: {
  traits: string[];
  size?: number;
}) {
  const valid = traits.filter(
    (t): t is PlanetTrait =>
      t === "cultural" || t === "hazardous" || t === "industrial",
  );
  if (valid.length === 0) return null;
  return (
    <span className={classes.traitGlyph} title={valid.join(" / ")}>
      <PlanetTraitIcon traits={valid} size={size} />
    </span>
  );
}

/** "R/I" pair: resources in the resource signal, influence in the influence signal. Always mono. */
export function ResInf({
  resources,
  influence,
  size = "md",
  className,
}: {
  resources: number;
  influence: number;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <span className={cx(classes.resInf, classes[`resInf_${size}`], className)}>
      <span className={classes.res}>{resources}</span>
      <span className={classes.resInfSep}>/</span>
      <span className={classes.inf}>{influence}</span>
    </span>
  );
}
