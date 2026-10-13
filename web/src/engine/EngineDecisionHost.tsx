import { useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent } from "react";
import { Tooltip, UnstyledButton } from "@mantine/core";
import { IconAlertTriangle, IconBolt, IconChevronDown, IconChevronUp, IconEye, IconEyeOff, IconLoader2, IconMap, IconX } from "@tabler/icons-react";
import cx from "clsx";
import { useDecisionFocus, useWaitingOnMe } from "@/decisions/model/focus";
import { useMovementUI } from "@/mapactions/store";
import { mapTargets, useEngineMapPick } from "@/mapactions/enginePick";
import { useReserveRect } from "@/state/reservedArea";
import { usePlay, usePlayConnection } from "@/discord";
import type { Decision, GameState } from "./contract";
import { forgetClosedDrafts } from "./draftState";
import { useEngineAnswer } from "./link";
import { decisionEyebrow, decisionTitle, orderDecisions } from "./queue";
import { rendererFor } from "./registry";
import { engineStore, useEngine, useMyDecisions } from "./store";
import { DecisionFooter, FooterSlot, PopupLayer, popupClasses as classes, usePeek, useScrollEdges } from "./ui/Popup";
import { EngineOutcomeToast } from "./ui/OutcomeToast";
import { gameOverHeadline, gameOverView } from "./gameOver";
import { WinnerPanel } from "./renderers/game/WinnerPanel";
import { planetName } from "./renderers/tactical/names";

export { decisionTitle };

/** Decisions the draft board answers itself (through the engine) while it is on screen. */
const BOARD_KINDS = new Set(["draft.milty.pick", "draft.milty.info"]);

type Props = {
  gameName: string;
  placement?: "fixed" | "contained";
  rightInset?: number;
};

/** How long my turn may show no prompt at all before the popup says the engine is catching up. */
const STALL_MS = 10000;

/**
 * My action-phase turn with nothing to answer (the engine lost its prompts, e.g. right after a bot restart): true
 * after STALL_MS, so the player sees why there is no panel instead of a bare "Your turn".
 */
function useTurnStalled(state: GameState | null, empty: boolean): boolean {
  const mine = !!state?.activePlayer && state.players.find((p) => p.self)?.userId === state.activePlayer;
  const waiting = empty && mine && /^action/i.test(state?.phase ?? "");
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    if (!waiting) return setStalled(false);
    const t = window.setTimeout(() => setStalled(true), STALL_MS);
    return () => window.clearTimeout(t);
  }, [waiting]);
  return stalled;
}

/** How long the popup may stay empty while the engine stream connects before it says so. */
const CONNECTING_NOTE_MS = 1500;

/**
 * The popup's place while the engine stream connects (reload, server restart): after a moment, a one-line status
 * where the prompts will appear, instead of an empty corner (or the legacy popup flashing in).
 */
export function EngineConnecting({ rightInset = 0, restarting = false }: { rightInset?: number; restarting?: boolean }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setShow(true), CONNECTING_NOTE_MS);
    return () => window.clearTimeout(t);
  }, []);
  if (!show) return null;
  return (
    <PopupLayer contained rightInset={rightInset}>
      <div className={classes.stalled} role="status" data-engine-connecting>
        <IconLoader2 size={14} className={classes.spin} />
        {restarting ? "The game engine is restarting — your options will be back in a moment…" : "Loading your prompts…"}
      </div>
    </PopupLayer>
  );
}

/** The system a decision is about, for the map highlight. */
function decisionPosition(d: Decision | undefined, state: GameState | null): string | null {
  if (!d) return null;
  if (d.kind.startsWith("combat.")) return state?.combat?.tile ?? null;
  const acc = d.progress?.accumulated as { position?: unknown } | undefined;
  return typeof acc?.position === "string" ? acc.position : null;
}

function typingIn(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

/**
 * The decision popup driven by the engine stream: my open decisions in answering order (queue.ts), one at a time,
 * each drawn by its kind's renderer (src/engine/renderers) or as plain option buttons. It docks right of the map's
 * middle and reserves its area so the board keeps clear; it can be peeked through, folded down to its title, and
 * jumped around ("N more waiting"); background prompts sit behind "Available now". Escape closes a list, then folds.
 */
export function EngineDecisionHost({ gameName, placement = "contained", rightInset = 0 }: Props) {
  const decisions = useMyDecisions();
  const state = useEngine((s) => s.view.state);
  const status = useEngine((s) => s.view.status);
  const openIds = useEngine((s) => s.view.decisions);
  const pending = useEngine((s) => s.view.pending);
  const errors = useEngine((s) => s.view.errors);
  const answeredAtSeq = useEngine((s) => s.lastAnswer?.seq ?? null);
  const hidden = useEngine((s) => s.hidden);
  const answer = useEngineAnswer();
  const answeredKind = useEngine((s) => s.lastAnswer?.decision.kind ?? null);
  const ordered = useMemo(
    () => orderDecisions(decisions, answeredAtSeq, hidden, state, answeredKind),
    [decisions, answeredAtSeq, hidden, state, answeredKind],
  );
  /* While the draft runs, the draft board (the table's takeover) is where picks are made: no popup on top of it. */
  const drafting = state?.draft?.status === "drafting";
  /* While the map answers the move / land step (its own panel on the board), that step is the map's, not the popup's. */
  const movement = useMovementUI();
  const mapKind = movement.step === "move" ? "tactical.move" : movement.step === "land" ? "tactical.land" : null;
  /* …and while it does, my own played card's panel stays out of the way: the tactical action is what I am doing. */
  const myFaction = state?.players.find((p) => p.self)?.faction;
  const queue = useMemo(
    () =>
      ordered.queue.filter(
        (d) =>
          !(drafting && BOARD_KINDS.has(d.kind)) &&
          d.kind !== mapKind &&
          !(mapKind && d.kind === "strategy_card.resolve" && !!myFaction && d.window?.subject?.holder === myFaction),
      ),
    [drafting, ordered.queue, mapKind, myFaction],
  );
  const offers = ordered.offers;

  const [jumpId, setJumpId] = useState<string | null>(null);
  const [offerId, setOfferId] = useState<string | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const [offerList, setOfferList] = useState(false);
  const [collapsedId, setCollapsedId] = useState<string | null>(null);
  const [bodyEl, setBodyEl] = useState<HTMLDivElement | null>(null);
  const [footerEl, setFooterEl] = useState<HTMLDivElement | null>(null);
  const edges = useScrollEdges(bodyEl);
  const peek = usePeek();
  const cardRef = useReserveRect("decision-card");
  const offersRef = useReserveRect("decision-offers");

  /* A new decision the game waits on takes the panel back from an optional offer I had open (required leads). */
  const headId = queue[0]?.id ?? null;
  const [seenHead, setSeenHead] = useState<string | null>(headId);
  if (headId !== seenHead) {
    setSeenHead(headId);
    if (headId && offerId) setOfferId(null);
  }
  const openOffer = offers.find((d) => d.id === offerId);
  const shown = openOffer ?? queue.find((d) => d.id === jumpId) ?? queue[0];
  const more = queue.filter((d) => d.id !== shown?.id).length;
  const collapsed = !!shown && collapsedId === shown.id && !errors[shown.id];
  const over = useMemo(() => gameOverView(state, Object.values(openIds)), [state, openIds]);
  /* Empty means nothing at all is open for me: not a step the map is answering (move / land), not one in flight. */
  const nothingOpen = !shown && ordered.queue.length === 0 && !movement.step && Object.keys(pending).length === 0;
  const stalled = useTurnStalled(over ? null : state, nothingOpen);
  const [overFolded, setOverFolded] = useState(false);
  /* The game's actions channel: where `/game end` runs when the end-of-game prompt was dismissed. */
  const conn = usePlayConnection();
  const actionsChannel = usePlay((s) => Object.values(s.channels).find((c) => c.name === `${gameName}-actions`)?.id ?? null);
  const endByCommand = (rematch: boolean) => {
    if (!actionsChannel) return;
    conn.runCommand(actionsChannel, "game", [
      {
        type: 1,
        name: "end",
        options: [
          { type: 3, name: "confirm", value: "YES" },
          { type: 5, name: "rematch", value: rematch },
        ],
      },
    ]);
  };

  /* The header's "Your move" pill: what is really waiting on me (background prompts never count). */
  const publishWaiting = useWaitingOnMe((s) => s.set);
  const firstTitle = ordered.queue[0] ? decisionTitle(ordered.queue[0], state) : null;
  useEffect(() => publishWaiting(ordered.queue.length, firstTitle), [publishWaiting, ordered.queue.length, firstTitle]);
  useEffect(() => () => publishWaiting(0, null), [publishWaiting]);

  /* Half-made selections of decisions that closed are forgotten (only once the stream is live: not mid-reload). */
  useEffect(() => {
    if (status === "live") forgetClosedDrafts(new Set(Object.keys(openIds)));
  }, [status, openIds]);

  const setFocus = useDecisionFocus((s) => s.set);
  const position = decisionPosition(shown, state);
  const focusLabel = shown?.kind.startsWith("combat.") ? "Combat" : null;
  useEffect(() => setFocus(position, "prompt", focusLabel), [position, focusLabel, setFocus]);
  useEffect(() => () => setFocus(null, null), [setFocus]);

  /* Map-first: the shown decision's systems / planets answer from the map too (its buttons stay as the fallback). */
  const setMapPick = useEngineMapPick((s) => s.set);
  const shownPending = !!shown && !!pending[shown.id];
  const targets = useMemo(() => (shownPending ? null : mapTargets(shown, state, planetName)), [shown, state, shownPending]);
  useEffect(() => {
    if (!shown || !targets) return setMapPick(null);
    setMapPick({ decisionId: shown.id, byPosition: targets, answer: (optionId) => answer(shown, optionId) });
    /* `answer` is a new function every render: the pick follows the decision and its targets only. */
  }, [shown, targets, setMapPick]);
  useEffect(() => () => setMapPick(null), [setMapPick]);

  /* The queue and "Available now" lists close on any click outside them (and on Escape, below). */
  useEffect(() => {
    if (!queueOpen && !offerList) return;
    const onDown = (e: globalThis.PointerEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.("[data-engine-menu]")) return;
      setQueueOpen(false);
      setOfferList(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [queueOpen, offerList]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || typingIn(e.target)) return;
      if (queueOpen || offerList) {
        setQueueOpen(false);
        setOfferList(false);
        return;
      }
      if (openOffer) return setOfferId(null);
      if (shown) setCollapsedId((c) => (c === shown.id ? null : shown.id));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [queueOpen, offerList, openOffer, shown]);

  /* Prompts I hid that are still open: one page-wide control brings them all back. */
  const hiddenOpen = decisions.filter((d) => hidden.has(d.id)).length;
  const unhidePill = hiddenOpen > 0 && (
    <Tooltip label="Show the prompts you hid again" position="right">
      <UnstyledButton className={classes.unhidePill} onClick={() => engineStore.getState().unhideAll()} data-engine-hidden={hiddenOpen}>
        <IconEye size={14} />
        {hiddenOpen} hidden · Show
      </UnstyledButton>
    </Tooltip>
  );
  const offerPill = (offers.length > 0 || unhidePill) && (
    <div ref={offersRef} className={classes.offers} data-engine-menu>
      {offerList && (
        <div className={classes.offerList} role="menu" aria-label="Available now">
          {offers.map((o) => (
            <UnstyledButton
              key={o.id}
              role="menuitem"
              className={classes.offerItem}
              onClick={() => {
                setOfferId(o.id);
                setOfferList(false);
              }}
            >
              {decisionTitle(o, state)}
            </UnstyledButton>
          ))}
        </div>
      )}
      {offers.length > 0 && (
      <UnstyledButton
        className={classes.offerPill}
        onClick={() => (offers.length === 1 ? setOfferId(offerId ? null : offers[0].id) : setOfferList((v) => !v))}
        aria-expanded={offerList}
        data-engine-offers={offers.length}
      >
        <IconBolt size={14} />
        Available now{offers.length > 1 ? ` · ${offers.length}` : ""}
      </UnstyledButton>
      )}
      {unhidePill}
    </div>
  );

  /* Game over: the winner screen takes the popup's place (nothing else is asked of anyone any more). */
  if (over) {
    const endPending = over.endPrompt ? (pending[over.endPrompt.id]?.optionId ?? null) : null;
    const endError = over.endPrompt ? errors[over.endPrompt.id] : undefined;
    return (
      <>
        <PopupLayer contained={placement === "contained"} rightInset={rightInset} peeking={peek.peeking}>
          <section
            ref={cardRef}
            className={cx(classes.card, overFolded && classes.collapsed)}
            role="dialog"
            aria-modal="false"
            aria-label={gameOverHeadline(over)}
            data-engine-decision="game.over"
          >
            <header className={classes.head}>
              <div className={classes.headTop}>
                <div className={classes.titles}>
                  <span className={classes.eyebrow}>{over.finish === "ended" ? "Game ended" : "Game over"}</span>
                  <h2 className={classes.title}>Final standings</h2>
                </div>
                <Tooltip label="Hold to see the map, or click to toggle" position="bottom">
                  <UnstyledButton
                    className={classes.peekBtn}
                    onPointerDown={(e: PointerEvent) => {
                      e.preventDefault();
                      e.stopPropagation();
                      peek.hold();
                    }}
                    aria-label="Peek at map (hold, or click to toggle)"
                  >
                    <IconMap size={14} />
                    <span>Peek at map</span>
                  </UnstyledButton>
                </Tooltip>
                <Tooltip label={overFolded ? "Show the standings" : "Fold down to the title"} position="bottom">
                  <UnstyledButton
                    className={classes.iconBtn}
                    onClick={() => setOverFolded((v) => !v)}
                    aria-label={overFolded ? "Expand" : "Collapse"}
                    aria-expanded={!overFolded}
                  >
                    {overFolded ? <IconChevronDown size={15} /> : <IconChevronUp size={15} />}
                  </UnstyledButton>
                </Tooltip>
              </div>
            </header>
            <div className={classes.body} hidden={overFolded}>
              <WinnerPanel view={over} answer={answer} pendingOptionId={endPending} endByCommand={actionsChannel ? endByCommand : undefined} />
            </div>
            {endError && over.endPrompt && (
              <div className={classes.error} role="alert">
                <IconAlertTriangle size={14} />
                <span>{endError}</span>
                <span className={classes.grow} />
                <UnstyledButton className={classes.errorClose} onClick={() => engineStore.getState().dismissError(over.endPrompt!.id)}>
                  Dismiss
                </UnstyledButton>
              </div>
            )}
          </section>
        </PopupLayer>
        <EngineOutcomeToast gameName={gameName} rightInset={rightInset} />
      </>
    );
  }

  if (!shown) {
    return (
      <>
        {(offerPill || stalled) && (
          <PopupLayer contained={placement === "contained"} rightInset={rightInset}>
            {stalled && (
              <div className={classes.stalled} role="status" data-engine-stalled>
                <IconLoader2 size={14} className={classes.spin} />
                It's your turn, but the game engine has not offered your options yet — reconnecting…
              </div>
            )}
            {offerPill}
          </PopupLayer>
        )}
        <EngineOutcomeToast gameName={gameName} rightInset={rightInset} />
      </>
    );
  }

  const Renderer = rendererFor(shown.kind);
  const error = errors[shown.id];
  const title = decisionTitle(shown, state);
  const eyebrow = openOffer ? "Available now · optional" : decisionEyebrow(shown, state);

  return (
    <>
      <PopupLayer contained={placement === "contained"} rightInset={rightInset} peeking={peek.peeking}>
        <section
          key={shown.id}
          ref={cardRef}
          className={cx(classes.card, collapsed && classes.collapsed)}
          role="dialog"
          aria-modal="false"
          aria-label={title}
          data-engine-decision={shown.kind}
          data-collapsed={collapsed || undefined}
        >
          <header className={classes.head}>
            <div className={classes.headTop}>
              <div className={classes.titles}>
                {eyebrow && <span className={classes.eyebrow}>{eyebrow}</span>}
                <h2 className={classes.title}>{title}</h2>
              </div>
              {more > 0 && (
                <span className={classes.moreWrap} data-engine-menu>
                  {openOffer && queue[0] ? (
                    /* An optional offer is open: what the game waits on leads, one click back to it. */
                    <UnstyledButton
                      className={classes.moreText}
                      onClick={() => (more === 1 ? setOfferId(null) : setQueueOpen((v) => !v))}
                      aria-expanded={more === 1 ? undefined : queueOpen}
                      data-engine-required={more}
                    >
                      {more === 1 ? `Waiting on you: ${decisionTitle(queue[0], state)}` : `${more} waiting on you`}
                    </UnstyledButton>
                  ) : (
                    <UnstyledButton className={classes.moreText} onClick={() => setQueueOpen((v) => !v)} aria-expanded={queueOpen}>
                      {more === 1 ? "1 more after this" : `${more} more waiting`}
                    </UnstyledButton>
                  )}
                  {queueOpen && (
                    <span className={classes.queueList} role="menu" aria-label="Decisions waiting">
                      {queue.filter((d) => d.kind === "legacy").length >= 3 && (
                        <UnstyledButton
                          role="menuitem"
                          className={classes.queueItem}
                          onClick={() => {
                            for (const d of queue) if (d.kind === "legacy") engineStore.getState().hide(d.id);
                            setQueueOpen(false);
                          }}
                        >
                          Hide the {queue.filter((d) => d.kind === "legacy").length} untyped prompts (leftovers)
                        </UnstyledButton>
                      )}
                      {queue.map((d) => (
                        <UnstyledButton
                          key={d.id}
                          role="menuitem"
                          className={cx(classes.queueItem, d.id === shown.id && classes.queueItemCurrent)}
                          onClick={() => {
                            setJumpId(d.id);
                            setOfferId(null);
                            setQueueOpen(false);
                          }}
                        >
                          {decisionTitle(d, state)}
                        </UnstyledButton>
                      ))}
                    </span>
                  )}
                </span>
              )}
              <Tooltip label="Hold to see the map, or click to toggle" position="bottom">
                <UnstyledButton
                  className={classes.peekBtn}
                  onPointerDown={(e: PointerEvent) => {
                    e.preventDefault();
                    e.stopPropagation();
                    peek.hold();
                  }}
                  onKeyDown={(e: ReactKeyboardEvent) => {
                    if (e.key !== " " && e.key !== "Enter") return;
                    e.preventDefault();
                    peek.toggle();
                  }}
                  aria-label="Peek at map (hold, or click to toggle)"
                >
                  <IconMap size={14} />
                  <span>Peek at map</span>
                </UnstyledButton>
              </Tooltip>
              <Tooltip label={collapsed ? "Show this prompt" : "Fold down to the title (Esc)"} position="bottom">
                <UnstyledButton
                  className={classes.iconBtn}
                  onClick={() => setCollapsedId(collapsed ? null : shown.id)}
                  aria-label={collapsed ? "Expand" : "Collapse"}
                  aria-expanded={!collapsed}
                >
                  {collapsed ? <IconChevronDown size={15} /> : <IconChevronUp size={15} />}
                </UnstyledButton>
              </Tooltip>
              {shown.kind === "legacy" && (
                <Tooltip label="Not for me — hide this prompt" position="bottom">
                  <UnstyledButton
                    className={classes.iconBtn}
                    onClick={() => {
                      engineStore.getState().hide(shown.id);
                      setOfferId(null);
                    }}
                    aria-label="Hide this prompt"
                  >
                    <IconEyeOff size={15} />
                  </UnstyledButton>
                </Tooltip>
              )}
              {openOffer && (
                <Tooltip label="Close — it stays under “Available now”" position="bottom">
                  <UnstyledButton className={classes.iconBtn} onClick={() => setOfferId(null)} aria-label="Close">
                    <IconX size={15} />
                  </UnstyledButton>
                </Tooltip>
              )}
            </div>
          </header>
          <div
            ref={setBodyEl}
            className={classes.body}
            hidden={collapsed}
            data-more-above={edges.above || undefined}
            data-more-below={edges.below || undefined}
          >
            <FooterSlot.Provider value={footerEl}>
              <Renderer
                decision={shown}
                state={state}
                answer={(choice) => answer(shown, choice)}
                pendingOptionId={pending[shown.id]?.optionId ?? null}
              />
            </FooterSlot.Provider>
          </div>
          <div ref={setFooterEl} className={classes.footer} hidden={collapsed} />
          {error && (
            <div className={classes.error} role="alert">
              <IconAlertTriangle size={14} />
              <span>{error}</span>
              <span className={classes.grow} />
              <UnstyledButton className={classes.errorClose} onClick={() => engineStore.getState().dismissError(shown.id)}>
                Dismiss
              </UnstyledButton>
            </div>
          )}
        </section>
        {offerPill}
      </PopupLayer>
      <EngineOutcomeToast gameName={gameName} rightInset={rightInset} />
    </>
  );
}

export { DecisionFooter };
