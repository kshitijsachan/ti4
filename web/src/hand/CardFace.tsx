import { cdnImage } from "@/entities/data/cdnImage";
import { getFactionImage } from "@/entities/lookup/factions";
import type { HandCard, Timing } from "./model";
import classes from "./HandTray.module.css";

const BACKS: Record<string, string> = {
  ac: "/player_area/cardback_action.jpg",
  so: "/player_area/cardback_secret.jpg",
  pn: "/player_area/cardback_pn.png",
  relic: "/player_area/cardback_relic.jpg",
};

const FRAGMENT_BACKS: Record<string, string> = {
  Cultural: "/player_area/cardback_cultural.jpg",
  Hazardous: "/player_area/cardback_hazardous.jpg",
  Industrial: "/player_area/cardback_industrial.jpg",
  Unknown: "/player_area/cardback_frontier.jpg",
};

export function cardBack(card: Pick<HandCard, "kind" | "name">): string {
  if (card.kind === "fragment")
    return cdnImage(FRAGMENT_BACKS[card.name.split(" ")[0]] ?? FRAGMENT_BACKS.Unknown);
  return cdnImage(BACKS[card.kind]);
}

export function backForGroup(id: string): string {
  return cdnImage(BACKS[id] ?? BACKS.ac);
}

const KIND_LABEL: Record<HandCard["kind"], string> = {
  ac: "Action",
  so: "Secret",
  pn: "Note",
  relic: "Relic",
  fragment: "Fragment",
};

type Props = {
  card: HandCard;
  size: "mini" | "large";
  number?: number;
  timing?: Timing;
  actionable?: boolean;
};

/** A card drawn as a physical card: the deck's art across its head, then name, timing and text. */
export function CardFace({ card, size, number, timing, actionable }: Props) {
  const live = actionable && timing === "now";
  const stateClass = [
    classes.card,
    classes[`kind_${card.kind}`],
    size === "large" ? classes.large : classes.mini,
    card.scored ? classes.scored : "",
    card.exhausted ? classes.exhausted : "",
    live ? classes.live : "",
  ].join(" ");

  if (card.imageUrl) {
    return (
      <div className={stateClass} data-kind={card.kind}>
        <img className={classes.artFull} src={cdnImage(card.imageUrl)} alt={card.name} draggable={false} />
        {card.exhausted && <span className={classes.stamp}>Exhausted</span>}
      </div>
    );
  }

  const factionIcon = card.owner ? getFactionImage(card.owner.faction) : undefined;
  return (
    <div className={stateClass} data-kind={card.kind}>
      <div className={classes.head}>
        <img className={classes.headArt} src={cardBack(card)} alt="" draggable={false} />
        <span className={classes.kindLabel}>{KIND_LABEL[card.kind]}</span>
        {card.vp !== undefined && <span className={classes.vp}>{card.vp} VP</span>}
        {card.count !== undefined && <span className={classes.vp}>×{card.count}</span>}
        {factionIcon && <img className={classes.faction} src={factionIcon} alt={card.owner?.faction} />}
      </div>
      <div className={classes.body}>
        <div className={classes.name}>{card.name}</div>
        {card.window && <div className={classes.window}>{card.window}</div>}
        <div className={classes.text}>{card.text}</div>
        {size === "large" && card.flavor && <div className={classes.flavor}>{card.flavor}</div>}
      </div>
      <div className={classes.foot}>
        {number !== undefined && <span className={classes.num}>#{number}</span>}
        {card.inPlayArea && <span className={classes.tag}>In play</span>}
        {card.owner && size === "large" && <span className={classes.owner}>{card.owner.name}</span>}
      </div>
      {card.scored && <span className={classes.stamp}>Scored</span>}
      {live && <span className={classes.livePip} aria-label="Playable now" />}
    </div>
  );
}
