import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { UnstyledButton, Tooltip } from "@mantine/core";
import { IconBolt, IconChevronDown, IconChevronUp, IconEyeOff, IconMap, IconAlertTriangle, IconX } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import cx from "clsx";
import { usePlay, usePlayConnection } from "@/discord";
import { snowflakeTime } from "@/discord/shared/snowflake";
import { usePlayerData } from "@/api/usePlayerData";
import type { PlayerDataResponse } from "@/entities/data/types";
import { getToken } from "@/play/session";
import { useMovementUI } from "@/mapactions/store";
import { useReserveRect } from "@/state/reservedArea";
import { findGame } from "../detect/games";
import { turnMenuFallback, usePendingPrompts } from "../detect/pending";
import { useSetupWaiting } from "../detect/waiting";
import { classify, isNoise, type Decision } from "../model/classify";
import { combatWaitsOnMe, offersOf, orderQueue } from "../model/queue";
import { foldScoring } from "../model/scoring";
import { baseId, type Choice } from "../model/controls";
import { useDecisionFocus } from "../model/focus";
import { useDecisionPress } from "../model/usePress";
import { renderBody, isWide } from "../renderers";
import type { DecisionData } from "../renderers/types";
import { OutcomeToast } from "./OutcomeToast";
import classes from "./DecisionHost.module.css";

export type DecisionHostProps = {
  gameName: string;
  /**
   * `fixed` (default) floats the popup over the viewport, centred; `contained` positions it absolutely in
   * the nearest positioned ancestor (the board area).
   */
  placement?: "fixed" | "contained";
  className?: string;
  /** Width of a side drawer open on the right: the popup docks left of it instead of covering it. */
  rightInset?: number;
};

function useHandAliases(gameName: string, enabled: boolean) {
  const query = useQuery({
    queryKey: ["decisions", "hand", gameName],
    enabled,
    staleTime: 15_000,
    retry: false,
    queryFn: async () => {
      const token = getToken();
      const res = await fetch(`/bot/api/game/${encodeURIComponent(gameName)}/hand`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`hand ${res.status}`);
      return (await res.json()) as { actionCards?: string[] };
    },
  });
  return query.data?.actionCards;
}

/**
 * Whether the setup draft is over (or the game never had one): the bot's draft state, polled while it runs. Until
 * then the draft view owns the screen and the table-wide setup steps stay hidden.
 */
function useSetupOpen(gameName: string) {
  const query = useQuery({
    queryKey: ["decisions", "draft", gameName],
    staleTime: 4_000,
    retry: false,
    refetchInterval: (q) => (q.state.data === "finished" || q.state.data === "none" ? 60_000 : 5_000),
    queryFn: async () => {
      const res = await fetch(`/bot/api/public/game/${encodeURIComponent(gameName)}/draft`);
      if (!res.ok) return "none" as const;
      const body = (await res.json()) as { status?: string };
      return body.status === "drafting" ? ("drafting" as const) : body.status === "finished" ? ("finished" as const) : ("none" as const);
    },
  });
  return query.data === "finished" || query.data === "none";
}

/** A combat is over (or never was) once fewer than two players have units fighting there; the bot leaves its buttons up. */
function combatOver(d: Decision, web?: PlayerDataResponse) {
  const c = d.combat;
  if (!web) return false;
  /* No system, or a system the game has no fight in: a leftover (or a space-cannon prompt), nothing to fight. */
  if (!c?.position) return !web.gameState?.activeCombat;
  const tile = web.tileUnitData?.[c.position];
  if (!tile) return false;
  const unit = (u: { entityType: string; count: number }) => u.entityType === "unit" && u.count > 0;
  const ground = ["gf", "mf"];
  if (c.kind === "ground") {
    /* A ground combat is over once fewer than two players have ground forces on the planet. */
    const planets = c.planet ? [tile.planets?.[c.planet]] : Object.values(tile.planets ?? {});
    return !planets.some((p) => Object.values(p?.entities ?? {}).filter((us) => us.some((u) => unit(u) && ground.includes(u.entityId))).length >= 2);
  }
  /* A space combat is over once fewer than two players have ships here. */
  const sides = Object.values(tile.space ?? {}).filter((us) => us.some((u) => unit(u) && !ground.includes(u.entityId)));
  return sides.length < 2;
}

/** The bot often answers one press with a few prompts at once (pay, then gain tokens): keep those in posting order. */
const BURST_MS = 3000;

/** Oldest first, a burst's prompts in posting order, combat and my strategy card's steps folded together. */
function inBursts(newestFirst: Decision[]): Decision[] {
  return foldScoring(foldCombat(bursts(newestFirst).flatMap(foldSteps)));
}

/** A combat thread posts several prompts at once (assign hits, roll dice, AFB): one popup per combat. */
function foldCombat(list: Decision[]): Decision[] {
  const out: Decision[] = [];
  for (const d of list) {
    if (d.kind !== "combat") {
      out.push(d);
      continue;
    }
    const lead = out.findIndex((x) => x.kind === "combat" && x.prompt.channelId === d.prompt.channelId);
    if (lead < 0) {
      out.push({ ...d, steps: [] });
      continue;
    }
    out[lead] = { ...out[lead], steps: [...(out[lead].steps ?? []), d] };
  }
  return out.map((d) => (d.kind === "combat" ? combatTitle(newestHitPrompts(d)) : d));
}

/** The bot posts a new "assign N hits" prompt each round and leaves the old ones up: keep the newest of each kind. */
function newestHitPrompts(d: Decision): Decision {
  const hitKind = (x: Decision) =>
    x.choices.map((c) => baseId(c.customId).match(/^autoAssign(\w*?)Hits/)?.[1]).find((k) => k !== undefined);
  const all = [d, ...(d.steps ?? [])];
  const newest = new Map<string, string>();
  for (const x of all) {
    const k = hitKind(x);
    if (k !== undefined && (!newest.get(k) || snowflakeTime(x.id) > snowflakeTime(newest.get(k) ?? "0"))) newest.set(k, x.id);
  }
  const keep = (x: Decision) => {
    const k = hitKind(x);
    return k === undefined || newest.get(k) === x.id;
  };
  return { ...d, steps: (d.steps ?? []).filter(keep) };
}

const HIT_ID = /^(autoAssign\w*Hits|getDamageButtons_\w*deleteThis|getDamageButtons_\w+_afb)/;

function combatTitle(d: Decision): Decision {
  const all = [d, ...(d.steps ?? [])];
  const hits = all.some((x) => x.choices.some((c) => HIT_ID.test(baseId(c.customId))));
  const step = hits ? "— assign hits" : combatWaitsOnMe(d) ? "— roll dice" : "— opponent's roll";
  /* A thread holds the space combat and then the ground combat: name the one being fought now. */
  const ground = all.find((x) => x.combat?.kind === "ground" && x.choices.some((c) => /^(combatRoll_[^_]+_(?!space)[^_]+$|autoAssignGroundHits)/.test(baseId(c.customId))));
  const kind = ground ? "Ground combat" : d.title.replace(/ — .*$/, "");
  return { ...d, title: `${kind} ${step}`, combat: ground?.combat ?? d.combat };
}

/** My strategy card's own prompt absorbs the prompts the bot posted with it (choose speaker, draw agendas, …). */
function foldSteps(burst: Decision[]): Decision[] {
  const primary = burst.find((d) => d.kind === "scPrimary");
  if (!primary) return burst;
  const steps = burst.filter((d) => d !== primary && d.kind !== "turn" && !d.optional);
  if (!steps.length) return burst;
  return burst.filter((d) => !steps.includes(d)).map((d) => (d === primary ? { ...d, steps } : d));
}

function bursts(newestFirst: Decision[]): Decision[][] {
  const out: Decision[][] = [];
  for (const d of [...newestFirst].reverse()) {
    const last = out[out.length - 1];
    const prev = last?.[last.length - 1];
    const close =
      prev && prev.prompt.channelId === d.prompt.channelId && snowflakeTime(d.id) - snowflakeTime(prev.id) <= BURST_MS;
    if (close) last.push(d);
    else out.push([d]);
  }
  return out;
}

/** Several planets to explore after one action: one step, planets in the order I choose. */
function foldExplores(list: Decision[]): Decision[] {
  const isExplore = (d: Decision) => d.choices.some((c) => /^movedNExplored_/.test(baseId(c.customId)));
  const all = list.filter(isExplore);
  if (all.length < 2) return list;
  const [lead, ...steps] = all;
  const folded: Decision = { ...lead, title: "Explore your new planets — choose the order", text: "", steps };
  return list.filter((d) => !steps.includes(d)).map((d) => (d === lead ? folded : d));
}

/** Tactical steps the map can answer itself (pick ships, land ground forces). */
const MAP_STEP = /(^| )(tacticalMoveFrom_|unitTacticalMove_|landUnits_)/;

/** Position of the system a choice is about ("ringTile_301"), for the map highlight while hovering. */
function choicePosition(c: Choice | null) {
  return c ? (baseId(c.customId).match(/^(?:ringTile|addIngressToken)_(\w+)/)?.[1] ?? null) : null;
}

/**
 * The decision popup: every bot prompt waiting on me, newest first, one at a time as a calm card over
 * the board, with the information that decision needs and its choices as a few large buttons. It can be
 * looked past (hold “peek at the map”); only optional prompts can be hidden.
 */
export function DecisionHost({ gameName, placement = "fixed", className, rightInset = 0 }: DecisionHostProps) {
  const conn = usePlayConnection();
  const me = usePlay((s) => s.me);
  const channels = usePlay((s) => s.channels);
  const users = usePlay((s) => s.users);
  const messages = usePlay((s) => s.messages);
  const { data: web } = usePlayerData(gameName);
  const mePlayer = useMemo(() => web?.playerData.find((p) => p.discordId === me?.id), [web, me]);
  const phase = web?.gameState?.phase?.split(".")[0];
  const myTurn = !!mePlayer?.active && (phase === "strategy" || phase === "action");
  const setupOpen = useSetupOpen(gameName);
  const prompts = usePendingPrompts(gameName, { myTurn, faction: mePlayer?.faction, setupOpen });
  const game = useMemo(() => findGame(channels, gameName), [channels, gameName]);

  /* While the map is answering a movement / landing prompt, that prompt is the map's, not the popup's. */
  const movement = useMovementUI();
  const { decisions, offers } = useMemo<{ decisions: Decision[]; offers: Decision[] }>(() => {
    if (!game) return { decisions: [], offers: [] };
    const all = prompts
      .map((p) => classify(p, { state: { users, channels, messages }, game, web, me: mePlayer }))
      .filter((d) => !isNoise(d))
      /* My turn menus (left live by an undo) only while it is my turn. */
      .filter((d) => d.kind !== "turn" || myTurn)
      /* Scoring is over once the game has moved past it (the bot's summary may still say "waiting"). */
      .filter((d) => d.kind !== "scoring" || !web?.gameState?.phase?.startsWith("status") || web.gameState.phase === "status.scoring");
    /* "Decide now whether to follow X" is moot once X has been played. */
    const played = new Set((web?.strategyCards ?? []).filter((sc) => sc.played).map((sc) => sc.initiative));
    const live = all.filter(
      (d) => !(d.optional && d.kind === "scFollow" && d.sc && played.has(d.sc)) && !(d.kind === "scFollow" && !d.optional && d.sc && (!mePlayer || mePlayer.followedSCs?.includes(d.sc))) && !(d.kind === "combat" && combatOver(d, web)) &&
        !(movement.active && (d.id === movement.promptId || (d.kind === "tactical" && MAP_STEP.test(d.choices.map((c) => baseId(c.customId)).join(" "))))),
    );
    const oldestFirst = foldExplores(inBursts(live)).filter((d) => !(d.kind === "combat" && combatOver(d, web)));
    const queue = orderQueue(oldestFirst);
    if (!queue.length && myTurn && phase === "action") {
      /* My turn and nothing waits on me: a step got lost; offer my turn menu again so the turn never dead-ends. */
      const fallback = turnMenuFallback(conn.store.getState(), game, mePlayer?.faction);
      if (fallback) queue.push(classify(fallback, { state: { users, channels, messages }, game, web, me: mePlayer }));
    }
    return { decisions: queue, offers: offersOf(oldestFirst) };
  }, [prompts, game, users, channels, messages, web, mePlayer, myTurn, phase, conn, movement.active, movement.promptId]);
  if (import.meta.env.DEV) (window as unknown as { __decisions?: unknown }).__decisions = { decisions, offers, prompts };
  const hand = useHandAliases(gameName, decisions.some((d) => d.kind === "reaction" || d.kind === "turn"));
  const data: DecisionData = { gameName, web, me: mePlayer, players: web?.playerData ?? [], hand };
  const waiting = useSetupWaiting(gameName);
  if (!decisions.length && !offers.length && setupOpen && waiting && web?.tilePositions.length) {
    /* Setting up and nothing is mine to do: say who the table waits on, so it never looks stuck. */
    return (
      <div className={cx("ti4play", classes.layer, placement === "contained" ? classes.contained : classes.fixed, className)}>
        <div className={cx(classes.pill, classes.waitingPill)} role="status">
          <span className={classes.waitingDot} />
          <span className={classes.pillText}>{waiting.text}</span>
        </div>
      </div>
    );
  }
  return (
    <>
      <DecisionPopup decisions={decisions} offers={offers} data={data} placement={placement} className={className} rightInset={rightInset} />
      <OutcomeToast gameName={gameName} faction={mePlayer?.faction} rightInset={rightInset} />
    </>
  );
}

export type DecisionPopupProps = {
  /** In queue order: the first is the one shown. */
  decisions: Decision[];
  /** Optional abilities on offer that nothing waits on: behind the "Available now" pill. */
  offers?: Decision[];
  data: DecisionData;
  placement?: DecisionHostProps["placement"];
  className?: string;
  rightInset?: number;
};

/** Required decisions cannot be put away; optional ones (preferences, plan-ahead) and unrecognised prompts can. */
function canHide(d: Decision) {
  return !!d.optional || d.kind === "generic";
}

/**
 * The popup floats above the board, its drawers and the players view, so it renders into the page body. It sits
 * in the board's area (under the top bar, over the hand bar) and left of an open side drawer.
 */
function PopupLayer({ children, placement, rightInset, peeking }: {
  children: ReactNode;
  placement: DecisionHostProps["placement"];
  rightInset: number;
  peeking?: boolean;
}) {
  const style = { "--decision-right-inset": `${rightInset}px` } as CSSProperties;
  const layer = (
    <div className={cx("ti4play", classes.layer, classes.fixed, placement === "contained" && classes.board, peeking && classes.peeking)} style={style}>
      {children}
    </div>
  );
  return typeof document === "undefined" ? layer : createPortal(layer, document.body);
}

/** The popup itself over a list of decisions: paging, peeking at the map, presses, map focus. */
export function DecisionPopup({ decisions, offers = [], data, placement = "fixed", rightInset = 0 }: DecisionPopupProps) {
  const conn = usePlayConnection();
  const press = useDecisionPress();
  const [peeking, setPeeking] = useState(false);
  const [offerId, setOfferId] = useState<string | null>(null);
  const [offerList, setOfferList] = useState(false);
  const [collapsedId, setCollapsedId] = useState<string | null>(null);
  /* The board keeps clear of the card and the pill (state/reservedArea). */
  const cardRef = useReserveRect("decision-card");
  const offersRef = useReserveRect("decision-offers");
  /* Peek: hold the button to see the map while held, or click it to keep peeking until the next click anywhere. */
  const peekStart = useRef(0);
  const [peekMode, setPeekMode] = useState<"hold" | "toggle" | null>(null);
  useEffect(() => {
    if (!peeking) return;
    const release = () => {
      if (peekMode === "hold" && Date.now() - peekStart.current < 300) setPeekMode("toggle");
      else if (peekMode === "hold") {
        setPeeking(false);
        setPeekMode(null);
      }
    };
    const anyClick = () => {
      if (peekMode !== "toggle") return;
      setPeeking(false);
      setPeekMode(null);
    };
    const stop = () => {
      setPeeking(false);
      setPeekMode(null);
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointerdown", anyClick);
    window.addEventListener("pointercancel", stop);
    window.addEventListener("blur", stop);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointerdown", anyClick);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("blur", stop);
    };
  }, [peeking, peekMode]);

  /* One thing at a time: the head of the queue (or the one whose press is still settling). */
  const openOffer = offers.find((d) => d.id === offerId);
  const [jumpId, setJumpId] = useState<string | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const shown = press.held ?? openOffer ?? decisions.find((d) => d.id === jumpId) ?? decisions[0];
  const more = decisions.filter((d) => d.id !== shown?.id).length;
  const offerPill = offers.length > 0 && (
    <div ref={offersRef} className={classes.offers}>
      {offerList && (
        <div className={classes.offerList} role="menu" aria-label="Abilities available now">
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
              {o.title}
            </UnstyledButton>
          ))}
        </div>
      )}
      <UnstyledButton
        className={classes.offerPill}
        onClick={() => (offers.length === 1 ? setOfferId(offerId ? null : offers[0].id) : setOfferList((v) => !v))}
        aria-expanded={offerList}
      >
        <IconBolt size={14} />
        Available now{offers.length > 1 ? ` · ${offers.length}` : ""}
      </UnstyledButton>
    </div>
  );

  const setFocus = useDecisionFocus((s) => s.set);
  const promptPosition = shown?.position ?? null;
  useEffect(() => {
    setFocus(promptPosition, "prompt", shown?.kind === "combat" ? "Combat" : null);
  }, [promptPosition, shown?.kind, setFocus]);
  useEffect(() => () => setFocus(null, null), [setFocus]);
  const onHoverChoice = (c: Choice | null) => {
    const pos = choicePosition(c);
    if (pos) setFocus(pos, "hover", "Activate");
    else setFocus(promptPosition, "prompt");
  };

  if (!shown) {
    return offerPill ? (
      <PopupLayer placement={placement} rightInset={rightInset}>
        {offerPill}
      </PopupLayer>
    ) : null;
  }

  const hide = () => {
    conn.actions.dismissPrompt(shown.id);
    press.release();
  };
  /* Optional cards fold down to their header to free the map; a required choice always stays open. */
  const collapsible = canHide(shown) || shown === openOffer;
  const collapsed = collapsible && collapsedId === shown.id && !press.error;

  return (
    <PopupLayer placement={placement} rightInset={rightInset} peeking={peeking}>
      <section
        key={shown.id}
        ref={cardRef}
        data-collapsed={collapsed || undefined}
        className={cx(classes.card, isWide(shown) && classes.wide, collapsed && classes.collapsed)}
        aria-label={shown.title}
        role="dialog"
        aria-modal="false"
      >
        <header className={classes.head}>
          <div className={classes.headTop}>
            <div className={classes.titles}>
              {shown.eyebrow && <span className={classes.eyebrow}>{shown.eyebrow}</span>}
              <h2 className={classes.title}>{shown.title}</h2>
            </div>
            {more > 0 && (
              <span className={classes.moreWrap}>
                <UnstyledButton className={classes.moreText} onClick={() => setQueueOpen((v) => !v)} aria-expanded={queueOpen}>
                  {more === 1 ? "1 more after this" : `${more} more waiting`}
                </UnstyledButton>
                {queueOpen && (
                  <span className={classes.queueList} role="menu" aria-label="Decisions waiting">
                    {decisions.map((x) => (
                      <UnstyledButton
                        key={x.id}
                        role="menuitem"
                        className={cx(classes.queueItem, x.id === shown.id && classes.queueItemCurrent)}
                        onClick={() => {
                          setJumpId(x.id);
                          setQueueOpen(false);
                        }}
                      >
                        {x.title}
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
                  peekStart.current = Date.now();
                  setPeekMode("hold");
                  setPeeking(true);
                }}
                onKeyDown={(e: KeyboardEvent) => {
                  if (e.key !== " " && e.key !== "Enter") return;
                  setPeekMode("toggle");
                  setPeeking((v) => !v);
                }}
                aria-label="Peek at map (hold, or click to toggle)"
              >
                <IconMap size={14} />
                <span>Peek at map</span>
              </UnstyledButton>
            </Tooltip>
            {collapsible && (
              <Tooltip label={collapsed ? "Show this prompt" : "Fold down to the title"} position="bottom">
                <UnstyledButton
                  className={classes.iconBtn}
                  onClick={() => setCollapsedId(collapsed ? null : shown.id)}
                  aria-label={collapsed ? "Expand" : "Collapse"}
                  aria-expanded={!collapsed}
                >
                  {collapsed ? <IconChevronDown size={15} /> : <IconChevronUp size={15} />}
                </UnstyledButton>
              </Tooltip>
            )}
            {openOffer && shown === openOffer && (
              <Tooltip label="Close — the offer stays under “Available now”" position="bottom">
                <UnstyledButton className={classes.iconBtn} onClick={() => setOfferId(null)} aria-label="Close">
                  <IconX size={15} />
                </UnstyledButton>
              </Tooltip>
            )}
            {canHide(shown) && (
              <Tooltip label="Not for me — hide this prompt" position="bottom">
                <UnstyledButton className={classes.iconBtn} onClick={hide} aria-label="Hide this prompt">
                  <IconEyeOff size={15} />
                </UnstyledButton>
              </Tooltip>
            )}
          </div>
        </header>
        <div className={classes.body} hidden={collapsed}>
          {renderBody(shown, {
            d: shown,
            data,
            onPress: (c, values) => void press.press(shown, shown, c, values),
            pressOn: (target) => (c, values) => void press.press(shown, target, c, values),
            pendingKey: press.pendingKey,
            onHoverChoice,
          })}
        </div>
        {press.error && (
          <div className={classes.error} role="alert">
            <IconAlertTriangle size={14} />
            <span>{press.error}</span>
            <span className={classes.grow} />
            <UnstyledButton className={classes.errorClose} onClick={press.release}>
              Dismiss
            </UnstyledButton>
          </div>
        )}
      </section>
      {offerPill}
    </PopupLayer>
  );
}
