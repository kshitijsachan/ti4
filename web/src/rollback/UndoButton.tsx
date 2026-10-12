import { useEffect, useMemo, useState } from "react";
import { Popover, Tooltip } from "@mantine/core";
import { IconArrowBackUp, IconHistory } from "@tabler/icons-react";
import { usePlay } from "@/discord";
import { UndoApiError } from "./api";
import { readFlows } from "./flows";
import { asMine, asTheirs, planUndo, whoActed, type UndoPlan } from "./plan";
import { useUndoPoints, useUndoStore } from "./useUndoPoints";
import classes from "./Rollback.module.css";

export type UndoButtonProps = {
  gameName: string;
  /** Shows a "History…" link that should open the game log drawer (where any event can be rewound to). */
  onOpenHistory?: () => void;
  className?: string;
  /** The game is over: undo reopens it, so it is never a one-click offer (the popover asks to confirm the reopen). */
  gameOver?: boolean;
};

/** Fired (e.g. by the decision popup's Undo link) to open the top bar's Undo with its plan. */
export const UNDO_REQUEST_EVENT = "ti4:rollback:undo-request";

type Status = { kind: "idle" } | { kind: "busy" } | { kind: "error"; message: string; needsForce: boolean } | { kind: "done"; message: string };

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** The question the popover asks, and what its button says, for a plan. */
function describe(plan: UndoPlan): { title: string; note?: string; action?: string; tip: string } {
  switch (plan.kind) {
    case "none":
      return { title: "Nothing to undo yet.", tip: "Nothing to undo" };
    case "latest": {
      if (plan.point.command.startsWith("⏪"))
        return { title: "Undo the last rewind? That brings back everything it undid.", action: "Undo rewind", tip: "Undo the last rewind" };
      const what = asMine(plan.point.label, plan.point);
      return { title: `Undo: ${what}?`, action: "Undo", tip: `Undo: ${what}` };
    }
    case "flow": {
      const what = asMine(plan.first.label, plan.first, plan.summary);
      return { title: `Undo: ${what}?`, action: "Undo", tip: `Undo: ${what}` };
    }
    case "mine": {
      const what = asMine(plan.point.label, plan.point, plan.summary);
      const n = plan.after.length;
      return {
        title: `Undo: ${what}?`,
        note: `${whoActed(plan.after)} acted since (${plural(n, "action")}). Undoing yours also undoes ${n === 1 ? "that" : "those"}, for everyone.`,
        action: `Undo mine + ${n} after`,
        tip: `Undo: ${what} (also undoes ${plural(n, "later action")})`,
      };
    }
    case "others":
      return {
        title: `The last action was ${plan.point.actor || "another player"}'s: ${asTheirs(plan.point.label, plan.point)}.`,
        note: "You have nothing of your own to undo since. Undo theirs anyway? Use History… to rewind further back.",
        action: "Undo theirs",
        tip: `Undo: ${asTheirs(plan.point.label, plan.point)}`,
      };
  }
}

/**
 * One-step undo for the top bar. It undoes *my* latest action: when bots or other players acted after it (they answer
 * within seconds), it rewinds to just before mine and says what else that undoes. The tooltip names what will be
 * undone; clicking asks once. Every refusal is shown with its next step. Must sit inside `<PlayProvider>`.
 */
export function UndoButton({ gameName, onOpenHistory, className, gameOver = false }: UndoButtonProps) {
  const { data, error } = useUndoPoints(gameName);
  const me = usePlay((s) => s.me);
  const undo = useUndoStore((s) => s.undo);
  const rewind = useUndoStore((s) => s.rewind);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const plan = useMemo<UndoPlan>(
    () => (data ? planUndo(data.points, { id: me?.id, names: [me?.global_name ?? "", me?.username ?? ""] }, readFlows()) : { kind: "none" }),
    [data, me],
  );
  const text = describe(plan);
  const [reopen, setReopen] = useState(false);
  const overGuard = gameOver && plan.kind !== "none";
  const tip = error ? `Undo unavailable: ${error}` : overGuard ? "The game is over — undoing reopens it" : text.tip;

  useEffect(() => {
    const onRequest = () => {
      setStatus({ kind: "idle" });
      setOpen(true);
    };
    window.addEventListener(UNDO_REQUEST_EVENT, onRequest);
    return () => window.removeEventListener(UNDO_REQUEST_EVENT, onRequest);
  }, []);

  const run = async (force: boolean) => {
    setStatus({ kind: "busy" });
    try {
      if (plan.kind === "mine") {
        await rewind(gameName, plan.target.index);
        setStatus({ kind: "done", message: `Undid ${asMine(plan.point.label, plan.point, plan.summary)} and ${plural(plan.after.length, "action")} after it.` });
      } else if (plan.kind === "flow") {
        /* One action of several presses: back to the save before its first (undoing only the last Done changes nothing). */
        await rewind(gameName, plan.target.index);
        setStatus({ kind: "done", message: `Undid: ${asMine(plan.first.label, plan.first, plan.summary)}.` });
      } else {
        const res = await undo(gameName, force || plan.kind === "others");
        setStatus({ kind: "done", message: `Undid: ${res.undoneLabel}` });
      }
      window.setTimeout(() => {
        setOpen(false);
        setStatus({ kind: "idle" });
      }, 1600);
    } catch (e) {
      const needsForce = e instanceof UndoApiError && e.needsForce;
      const message = e instanceof Error ? e.message : String(e);
      setStatus({
        kind: "error",
        message: needsForce ? `${message} Someone acted since. Undo theirs too?` : `Undo failed: ${message}`,
        needsForce,
      });
    }
  };

  const toggle = () => {
    setStatus({ kind: "idle" });
    setReopen(false);
    setOpen((o) => !o);
  };

  const canAct = !!text.action && !error && status.kind !== "done";
  const blockedByEnd = overGuard && !reopen;
  const forceRetry = status.kind === "error" && status.needsForce;

  return (
    <Popover opened={open} onChange={setOpen} position="bottom-end" shadow="md" width={320} withinPortal zIndex={3500}>
      <Popover.Target>
        <Tooltip label={tip} disabled={open} withinPortal openDelay={250} multiline maw={280} zIndex={3500}>
          <button
            type="button"
            className={`${classes.undoButton} ${className ?? ""}`}
            onClick={toggle}
            aria-label={tip}
            aria-expanded={open}
            data-disabled={plan.kind === "none" || overGuard || undefined}
          >
            <IconArrowBackUp size={16} stroke={1.75} aria-hidden />
          </button>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown className={`ti4play ${classes.pop}`}>
        {status.kind === "done" ? (
          <div className={classes.popTitle}>{status.message}</div>
        ) : (
          <div className={classes.popTitle}>{error ? `Undo unavailable: ${error}` : text.title}</div>
        )}
        {text.note && status.kind !== "done" && <p className={classes.note}>{text.note}</p>}
        {overGuard && canAct && (
          <label className={classes.note} data-undo-reopen>
            <input type="checkbox" checked={reopen} onChange={(e) => setReopen(e.currentTarget.checked)} /> The game is over. Undoing
            reopens it for everyone — I want to reopen the game.
          </label>
        )}
        {status.kind === "error" && (
          <p className={classes.error} role="alert">
            {status.message}
          </p>
        )}
        <div className={classes.actions}>
          {onOpenHistory && (
            <button
              type="button"
              className={classes.link}
              onClick={() => {
                setOpen(false);
                onOpenHistory();
              }}
            >
              <IconHistory size={13} stroke={1.75} aria-hidden />
              History…
            </button>
          )}
          {canAct && (
            <button
              type="button"
              className={classes.danger}
              disabled={status.kind === "busy" || blockedByEnd}
              title={blockedByEnd ? "Tick “reopen the game” first" : undefined}
              onClick={() => void run(forceRetry)}
              data-autofocus
            >
              <IconArrowBackUp size={14} stroke={2} aria-hidden />
              {status.kind === "busy" ? "Undoing…" : forceRetry ? "Undo theirs too" : text.action}
            </button>
          )}
        </div>
      </Popover.Dropdown>
    </Popover>
  );
}
