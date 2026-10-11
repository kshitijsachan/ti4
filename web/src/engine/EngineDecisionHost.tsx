import { useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent } from "react";
import { Tooltip, UnstyledButton } from "@mantine/core";
import { IconAlertTriangle, IconBolt, IconChevronDown, IconChevronUp, IconEyeOff, IconMap, IconX } from "@tabler/icons-react";
import cx from "clsx";
import { useDecisionFocus, useWaitingOnMe } from "@/decisions/model/focus";
import { useReserveRect } from "@/state/reservedArea";
import type { Decision, GameState } from "./contract";
import { forgetClosedDrafts } from "./draftState";
import { useEngineAnswer } from "./link";
import { decisionEyebrow, decisionTitle, orderDecisions } from "./queue";
import { rendererFor } from "./registry";
import { engineStore, useEngine, useMyDecisions } from "./store";
import { DecisionFooter, FooterSlot, PopupLayer, popupClasses as classes, usePeek, useScrollEdges } from "./ui/Popup";
import { EngineOutcomeToast } from "./ui/OutcomeToast";

export { decisionTitle };

type Props = {
  gameName: string;
  placement?: "fixed" | "contained";
  rightInset?: number;
};

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
  const { queue, offers } = useMemo(() => orderDecisions(decisions, answeredAtSeq, hidden, state), [decisions, answeredAtSeq, hidden, state]);

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

  const openOffer = offers.find((d) => d.id === offerId);
  const shown = openOffer ?? queue.find((d) => d.id === jumpId) ?? queue[0];
  const more = queue.filter((d) => d.id !== shown?.id).length;
  const collapsed = !!shown && collapsedId === shown.id && !errors[shown.id];

  /* The header's "Your move" pill: what is really waiting on me (background prompts never count). */
  const publishWaiting = useWaitingOnMe((s) => s.set);
  const firstTitle = queue[0] ? decisionTitle(queue[0], state) : null;
  useEffect(() => publishWaiting(queue.length, firstTitle), [publishWaiting, queue.length, firstTitle]);
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

  const offerPill = offers.length > 0 && (
    <div ref={offersRef} className={classes.offers}>
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
      <UnstyledButton
        className={classes.offerPill}
        onClick={() => (offers.length === 1 ? setOfferId(offerId ? null : offers[0].id) : setOfferList((v) => !v))}
        aria-expanded={offerList}
        data-engine-offers={offers.length}
      >
        <IconBolt size={14} />
        Available now{offers.length > 1 ? ` · ${offers.length}` : ""}
      </UnstyledButton>
    </div>
  );

  if (!shown) {
    return (
      <>
        {offerPill && (
          <PopupLayer contained={placement === "contained"} rightInset={rightInset}>
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
  const eyebrow = openOffer ? "Available now · optional" : decisionEyebrow(shown);

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
                <span className={classes.moreWrap}>
                  <UnstyledButton className={classes.moreText} onClick={() => setQueueOpen((v) => !v)} aria-expanded={queueOpen}>
                    {more === 1 ? "1 more after this" : `${more} more waiting`}
                  </UnstyledButton>
                  {queueOpen && (
                    <span className={classes.queueList} role="menu" aria-label="Decisions waiting">
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
