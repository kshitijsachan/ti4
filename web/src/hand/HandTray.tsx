import { useCallback, useEffect, useRef, useState } from "react";
import { CardFace, backForGroup } from "./CardFace";
import { CardPopup } from "./CardPopup";
import { timingOf, type CardGroup, type HandCard } from "./model";
import { useHand, type HandState } from "./useHand";
import { actionsFor, useRunCardAction } from "./useHandActions";
import classes from "./HandTray.module.css";

type Props = {
  gameName: string;
  /** Seat token; defaults to this tab's (`play/session.ts`). */
  token?: string;
  /** Start expanded (and pinned). */
  defaultOpen?: boolean;
  className?: string;
};

const SHORT: Record<CardGroup["id"], string> = {
  ac: "Actions",
  so: "Secrets",
  pn: "Promissory",
  relic: "Relics",
};

const CLOSE_DELAY_MS = 280;

function isPlayableNow(card: HandCard, hand: HandState) {
  const actions = actionsFor(card, hand);
  if (!actions.some((a) => a.id === "play" || a.id === "score")) return false;
  return timingOf(card, hand.gameState, hand.myColor) === "now";
}

/**
 * The player's hand, docked at the bottom of the table: a slim bar of card
 * counts that opens into fans of cards. Click a card for its full text and the
 * bot's actions for it (play, score, discard, show).
 */
export function HandTray({ gameName, token, defaultOpen = false, className }: Props) {
  const hand = useHand(gameName, token);
  const run = useRunCardAction(hand.threadId);
  const [pinned, setPinned] = useState(defaultOpen);
  const [hovered, setHovered] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const open = pinned || hovered;

  const enter = () => {
    window.clearTimeout(closeTimer.current);
    setHovered(true);
  };
  const leave = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setHovered(false), CLOSE_DELAY_MS);
  };
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  const closePopup = useCallback(() => setSelected(null), []);
  const allCards = hand.groups.flatMap((g) => g.cards);
  const selectedCard = allCards.find((c) => c.key === selected);
  const playableCount = allCards.filter((c) => isPlayableNow(c, hand)).length;
  const total = allCards.length;

  return (
    <div
      className={`${classes.tray} ${open ? classes.open : ""} ${className ?? ""}`}
      onMouseEnter={enter}
      onMouseLeave={leave}
    >
      <div className={classes.shelf} aria-hidden={!open}>
        <div className={classes.groups}>
          {hand.groups.map((group) => (
            <GroupFan key={group.id} group={group} hand={hand} onPick={setSelected} />
          ))}
        </div>
        {hand.unnumbered > 0 && hand.index.refresh && (
          <div className={classes.syncNote}>Some cards are still being dealt — the bot has not listed them yet.</div>
        )}
      </div>

      <button
        type="button"
        className={classes.bar}
        onClick={() => setPinned((p) => !p)}
        aria-expanded={open}
        title={pinned ? "Put your hand away" : "Keep your hand open"}
      >
        <span className={classes.barTitle}>Your hand</span>
        {hand.groups.map((group) => (
          <BarCount key={group.id} group={group} />
        ))}
        {playableCount > 0 && (
          <span className={classes.barLive}>
            <span className={classes.liveDot} />
            {playableCount} playable now
          </span>
        )}
        {total === 0 && !hand.loading && <span className={classes.barEmpty}>{hand.error ?? "No cards"}</span>}
        <span className={classes.chevron} data-open={open}>▴</span>
      </button>

      {selectedCard && (
        <CardPopup
          card={selectedCard}
          number={hand.numbers.get(selectedCard.key)}
          timing={timingOf(selectedCard, hand.gameState, hand.myColor)}
          actions={actionsFor(selectedCard, hand)}
          players={hand.players}
          myColor={hand.myColor}
          threadId={hand.threadId}
          run={run}
          onClose={closePopup}
        />
      )}
    </div>
  );
}

function BarCount({ group }: { group: CardGroup }) {
  const scored = group.cards.filter((c) => c.scored).length;
  const count = group.cards.reduce((n, c) => n + (c.count ?? 1), 0) - scored;
  if (group.id === "relic" && group.cards.length === 0) return null;
  return (
    <span className={`${classes.barGroup} ${classes[`group_${group.id}`]}`}>
      <img className={classes.barBack} src={backForGroup(group.id)} alt="" />
      <span className={classes.barNum}>{count}</span>
      <span className={classes.barLabel}>{SHORT[group.id]}</span>
      {scored > 0 && <span className={classes.barScored}>+{scored} scored</span>}
    </span>
  );
}

function GroupFan({ group, hand, onPick }: { group: CardGroup; hand: HandState; onPick: (key: string) => void }) {
  if (group.cards.length === 0 && group.id === "relic") return null;
  return (
    <section className={`${classes.group} ${classes[`group_${group.id}`]}`}>
      <header className={classes.groupHead}>
        <span className={classes.groupLabel}>{group.label}</span>
        <span className={classes.groupCount}>{group.cards.length}</span>
      </header>
      {group.cards.length === 0 ? (
        <div className={classes.emptyFan}>None</div>
      ) : (
        <div className={classes.fan} style={{ ["--n" as string]: group.cards.length }}>
          {group.cards.map((card, i) => {
            const actions = actionsFor(card, hand);
            const actionable = actions.some((a) => a.id === "play" || a.id === "score");
            const timing = timingOf(card, hand.gameState, hand.myColor);
            return (
              <button
                type="button"
                key={card.key}
                className={classes.slot}
                style={{ ["--i" as string]: i }}
                onClick={() => onPick(card.key)}
                title={card.name}
              >
                <CardFace
                  card={card}
                  size="mini"
                  number={hand.numbers.get(card.key)}
                  timing={timing}
                  actionable={actionable}
                />
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
