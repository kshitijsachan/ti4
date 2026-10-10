import { useCallback, useEffect, useRef, useState } from "react";
import { CardFace } from "./CardFace";
import { CardPopup } from "./CardPopup";
import { timingOf, type CardGroup, type HandCard, type Timing } from "./model";
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
const CARD_W = 112;
const CARD_STEP = CARD_W + 8;
const GROUP_GAP = 53;
const SHELF_MAX = 1280;
const SHELF_CHROME = 36 + 24;

function useViewportWidth() {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

/**
 * Width each fan may take: every fan lies flat when the shelf has room;
 * otherwise small fans keep their room and the big ones overlap to share the rest.
 */
function fanBudgets(groups: CardGroup[], viewport: number): Map<string, number> {
  const shown = groups.filter((g) => g.cards.length > 0 || g.id !== "relic");
  const available =
    Math.min(SHELF_MAX, viewport - 24) - SHELF_CHROME - Math.max(0, shown.length - 1) * GROUP_GAP;
  const need = (g: CardGroup) => Math.max(1, g.cards.length) * CARD_STEP;
  const total = shown.reduce((sum, g) => sum + need(g), 0);
  const out = new Map<string, number>();
  // Phones: each fan gets about a screen of its own and the shelf scrolls sideways.
  if (viewport < 720) {
    for (const g of shown) out.set(g.id, Math.min(need(g), Math.max(CARD_W, viewport - 80)));
    return out;
  }
  if (total <= available) {
    for (const g of shown) out.set(g.id, need(g));
    return out;
  }
  const big = shown.filter((g) => g.cards.length >= 3);
  const fixed = shown.filter((g) => g.cards.length < 3).reduce((sum, g) => sum + need(g), 0);
  const bigCards = big.reduce((sum, g) => sum + g.cards.length, 0);
  for (const g of shown) {
    if (g.cards.length < 3) out.set(g.id, need(g));
    else out.set(g.id, Math.max(CARD_W, ((available - fixed) * g.cards.length) / bigCards));
  }
  return out;
}

/** Over the hand limit the bot refuses every action card until you discard down. */
function cardTiming(card: HandCard, hand: HandState): Timing {
  if (card.kind === "ac" && hand.acHeld > hand.acLimit) return "blocked";
  const timing = timingOf(card, hand.gameState, hand.myColor);
  // One action per turn: once it is spent, "Action:" cards wait for your next turn.
  if (timing === "now" && card.kind !== "so" && card.window === "Action" && hand.actionTaken) return "later";
  return timing;
}

function isPlayableNow(card: HandCard, hand: HandState) {
  const actions = actionsFor(card, hand);
  if (!actions.some((a) => a.id === "play" || a.id === "score")) return false;
  return cardTiming(card, hand) === "now";
}

/**
 * The player's hand, docked at the bottom of the table: a slim bar of card
 * counts that opens into fans of cards. Click a card for its full text and the
 * bot's actions for it (play, score, discard, show).
 */
export function HandTray({ gameName, token, defaultOpen = false, className }: Props) {
  const hand = useHand(gameName, token);
  const run = useRunCardAction(hand.threadId, hand.actionsId);
  const [pinned, setPinned] = useState(defaultOpen);
  const [hovered, setHovered] = useState(false);
  const [selected, setSelected] = useState<HandCard | null>(null);
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
  useEffect(() => {
    if (!pinned || selected) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPinned(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pinned, selected]);

  const closePopup = useCallback(() => setSelected(null), []);
  const allCards = hand.groups.flatMap((g) => g.cards);
  // The popup outlives the card (played, discarded, scored) so the player sees the outcome.
  const liveCard = selected && allCards.find((c) => c.key === selected.key && c.scored === selected.scored);
  const selectedCard = liveCard ?? selected;
  const playableCount = allCards.filter((c) => isPlayableNow(c, hand)).length;
  const overBy = Math.max(0, hand.acHeld - hand.acLimit);
  const total = allCards.length;
  const budgets = fanBudgets(hand.groups, useViewportWidth());

  return (
    <div
      className={`${classes.tray} ${open ? classes.open : ""} ${className ?? ""}`}
      onMouseEnter={enter}
      onMouseLeave={leave}
    >
      <div className={classes.shelf} aria-hidden={!open}>
        <div className={classes.groups}>
          {hand.groups.map((group) => (
            <GroupFan
              key={group.id}
              group={group}
              hand={hand}
              budget={budgets.get(group.id) ?? 520}
              onPick={setSelected}
            />
          ))}
        </div>
        {overBy > 0 && (
          <div className={classes.limitNote}>
            {hand.acHeld} action cards, hand limit {hand.acLimit}: discard {overBy} (open a card → Discard). The bot
            refuses action card plays until you do.
          </div>
        )}
        {hand.unnumbered > 0 && hand.index.refresh && (
          <div className={classes.syncNote}>Some cards are not listed by the bot yet — open one and press Sync with bot.</div>
        )}
      </div>

      <button
        type="button"
        className={`${classes.bar} ${playableCount > 0 ? classes.barPlayable : ""}`}
        onClick={() => setPinned((p) => !p)}
        aria-expanded={open}
        title={pinned ? "Put your hand away" : "Keep your hand open"}
      >
        <span className={classes.barTitle}>Hand</span>
        {hand.groups.map((group) => (
          <BarCount key={group.id} group={group} />
        ))}
        {overBy > 0 && <span className={classes.barLimit}>Discard {overBy}</span>}
        {playableCount > 0 && (
          <span className={classes.barLive}>
            <span className={classes.liveDot} />
            {playableCount} playable
          </span>
        )}
        {total === 0 && !hand.loading && <span className={classes.barEmpty}>{hand.error ?? "No cards"}</span>}
        <span className={classes.chevron} data-open={open}>▴</span>
      </button>

      {selectedCard && (
        <CardPopup
          card={selectedCard}
          number={hand.numbers.get(selectedCard.key)}
          timing={cardTiming(selectedCard, hand)}
          overBy={selectedCard.kind === "ac" ? Math.max(0, hand.acHeld - hand.acLimit) : 0}
          actions={liveCard ? actionsFor(selectedCard, hand) : []}
          gone={!liveCard}
          players={hand.players}
          myColor={hand.myColor}
          threadId={hand.threadId}
          actionsId={hand.actionsId}
          meId={hand.meId}
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
      <span className={classes.barSwatch} />
      <span className={classes.barNum}>{count}</span>
      <span className={classes.barLabel}>{SHORT[group.id]}</span>
      {scored > 0 && <span className={classes.barScored}>+{scored} scored</span>}
    </span>
  );
}

type GroupFanProps = {
  group: CardGroup;
  hand: HandState;
  budget: number;
  onPick: (card: HandCard) => void;
};

function GroupFan({ group, hand, budget, onPick }: GroupFanProps) {
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
        <div
          className={classes.fan}
          data-crowded={budget < group.cards.length * CARD_STEP || undefined}
          style={{ ["--n" as string]: group.cards.length, ["--budget" as string]: `${budget}px` }}
        >
          {group.cards.map((card, i) => {
            const actions = actionsFor(card, hand);
            const actionable = actions.some((a) => a.id === "play" || a.id === "score");
            const timing = cardTiming(card, hand);
            return (
              <button
                type="button"
                key={card.key}
                className={classes.slot}
                style={{ ["--i" as string]: i }}
                onClick={() => onPick(card)}
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
