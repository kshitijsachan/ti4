import { useEffect, useMemo, useRef, useState } from "react";
import { UnstyledButton, Tooltip } from "@mantine/core";
import { IconChevronLeft, IconChevronRight, IconEyeOff, IconMinus, IconAlertTriangle } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import cx from "clsx";
import { usePlay, usePlayConnection } from "@/discord";
import { snowflakeTime } from "@/discord/shared/snowflake";
import { usePlayerData } from "@/api/usePlayerData";
import { getToken } from "@/play/session";
import { findGame } from "../detect/games";
import { usePendingPrompts } from "../detect/pending";
import { classify, type Decision } from "../model/classify";
import { baseId, type Choice } from "../model/controls";
import { useDecisionFocus } from "../model/focus";
import { useDecisionPress } from "../model/usePress";
import { renderBody, isWide } from "../renderers";
import type { DecisionData } from "../renderers/types";
import classes from "./DecisionHost.module.css";

export type DecisionHostProps = {
  gameName: string;
  /**
   * `fixed` (default) floats the popup over the viewport, centred; `contained` positions it absolutely in
   * the nearest positioned ancestor (the board area).
   */
  placement?: "fixed" | "contained";
  className?: string;
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

/** The bot often answers one press with a few prompts at once (pay, then gain tokens): keep those in posting order. */
const BURST_MS = 3000;

function inBursts(newestFirst: Decision[]): Decision[] {
  const bursts: Decision[][] = [];
  for (const d of [...newestFirst].reverse()) {
    const last = bursts[bursts.length - 1];
    const prev = last?.[last.length - 1];
    const close =
      prev && prev.prompt.channelId === d.prompt.channelId && snowflakeTime(d.id) - snowflakeTime(prev.id) <= BURST_MS;
    if (close) last.push(d);
    else bursts.push([d]);
  }
  return bursts.reverse().flat();
}

/** Position of the system a choice is about ("ringTile_301"), for the map highlight while hovering. */
function choicePosition(c: Choice | null) {
  return c ? (baseId(c.customId).match(/^ringTile_(\w+)/)?.[1] ?? null) : null;
}

/**
 * The decision popup: every bot prompt waiting on me, newest first, one at a time as a calm card over
 * the board, with the information that decision needs and its choices as a few large buttons. It can be
 * minimised to a pill and reopens by itself when a new decision arrives.
 */
export function DecisionHost({ gameName, placement = "fixed", className }: DecisionHostProps) {
  const me = usePlay((s) => s.me);
  const channels = usePlay((s) => s.channels);
  const users = usePlay((s) => s.users);
  const messages = usePlay((s) => s.messages);
  const { data: web } = usePlayerData(gameName);
  const mePlayer = useMemo(() => web?.playerData.find((p) => p.discordId === me?.id), [web, me]);
  const phase = web?.gameState?.phase?.split(".")[0];
  const myTurn = !!mePlayer?.active && (phase === "strategy" || phase === "action");
  const prompts = usePendingPrompts(gameName, { myTurn, faction: mePlayer?.faction });
  const game = useMemo(() => findGame(channels, gameName), [channels, gameName]);

  const decisions = useMemo<Decision[]>(() => {
    if (!game) return [];
    const all = prompts.map((p) => classify(p, { state: { users, channels, messages }, game, web, me: mePlayer }));
    const ordered = inBursts(all);
    return [...ordered.filter((d) => !d.optional), ...ordered.filter((d) => d.optional)];
  }, [prompts, game, users, channels, messages, web, mePlayer]);
  const hand = useHandAliases(gameName, decisions.some((d) => d.kind === "reaction"));
  const data: DecisionData = { gameName, web, me: mePlayer, players: web?.playerData ?? [], hand };
  return <DecisionPopup decisions={decisions} data={data} placement={placement} className={className} />;
}

export type DecisionPopupProps = {
  /** Newest first. */
  decisions: Decision[];
  data: DecisionData;
  placement?: DecisionHostProps["placement"];
  className?: string;
};

/** The popup itself over a list of decisions: paging, minimise pill, presses, map focus. */
export function DecisionPopup({ decisions, data, placement = "fixed", className }: DecisionPopupProps) {
  const conn = usePlayConnection();
  const press = useDecisionPress();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(false);
  const newest = decisions[0]?.id;
  const lastNewest = useRef<string | undefined>(newest);
  useEffect(() => {
    if (newest && newest !== lastNewest.current) {
      setSelectedId(newest);
      setMinimized(false);
    }
    lastNewest.current = newest;
  }, [newest]);

  const index = Math.max(0, decisions.findIndex((d) => d.id === selectedId));
  const live = decisions[index];
  const shown = press.held ?? live;
  const count = decisions.length + (press.held && !decisions.some((d) => d.id === press.held?.id) ? 1 : 0);

  const setFocus = useDecisionFocus((s) => s.set);
  const promptPosition = shown?.position ?? null;
  useEffect(() => {
    setFocus(minimized ? null : promptPosition, "prompt", shown?.kind === "combat" ? "Combat" : null);
  }, [promptPosition, minimized, shown?.kind, setFocus]);
  useEffect(() => () => setFocus(null, null), [setFocus]);
  const onHoverChoice = (c: Choice | null) => {
    const pos = choicePosition(c);
    if (pos) setFocus(pos, "hover", "Activate");
    else setFocus(promptPosition, "prompt");
  };

  if (!shown || count === 0) return null;

  const place = placement === "contained" ? classes.contained : classes.fixed;

  if (minimized) {
    return (
      <div className={cx("ti4play", classes.layer, place, className)}>
        <UnstyledButton className={classes.pill} onClick={() => setMinimized(false)} aria-label="Show decisions">
          <span className={classes.pillDot} />
          <span className={classes.pillText}>
            {count === 1 ? shown.title : `${count} decisions waiting`}
          </span>
          <span className={classes.pillOpen}>Open</span>
        </UnstyledButton>
      </div>
    );
  }

  const go = (delta: number) => {
    if (press.held) press.release();
    const next = decisions[(index + delta + decisions.length) % decisions.length];
    if (next) setSelectedId(next.id);
  };
  const hide = () => {
    conn.actions.dismissPrompt(shown.id);
    press.release();
  };

  return (
    <div className={cx("ti4play", classes.layer, place, className)}>
      <section
        key={shown.id}
        className={cx(classes.card, isWide(shown) && classes.wide)}
        aria-label={shown.title}
        role="dialog"
        aria-modal="false"
      >
        <header className={classes.head}>
          <div className={classes.headTop}>
            <span className={classes.eyebrow}>{shown.eyebrow}</span>
            <span className={classes.grow} />
            {count > 1 && (
              <span className={classes.pager}>
                <UnstyledButton className={classes.iconBtn} onClick={() => go(-1)} aria-label="Previous decision">
                  <IconChevronLeft size={15} />
                </UnstyledButton>
                <span className={classes.pagerText}>
                  {index + 1} of {count}
                </span>
                <UnstyledButton className={classes.iconBtn} onClick={() => go(1)} aria-label="Next decision">
                  <IconChevronRight size={15} />
                </UnstyledButton>
              </span>
            )}
            <Tooltip label="Not for me — hide this prompt" position="bottom">
              <UnstyledButton className={classes.iconBtn} onClick={hide} aria-label="Hide this prompt">
                <IconEyeOff size={15} />
              </UnstyledButton>
            </Tooltip>
            <Tooltip label="Minimise — look at the map" position="bottom">
              <UnstyledButton className={classes.iconBtn} onClick={() => setMinimized(true)} aria-label="Minimise">
                <IconMinus size={15} />
              </UnstyledButton>
            </Tooltip>
          </div>
          <h2 className={classes.title}>{shown.title}</h2>
        </header>
        <div className={classes.body}>
          {renderBody(shown, {
            d: shown,
            data,
            onPress: (c, values) => void press.press(shown, c, values),
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
    </div>
  );
}
