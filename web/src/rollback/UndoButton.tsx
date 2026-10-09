import { useState } from "react";
import { Popover, Tooltip } from "@mantine/core";
import { IconArrowBackUp, IconHistory } from "@tabler/icons-react";
import { UndoApiError } from "./api";
import { useUndoPoints, useUndoStore } from "./useUndoPoints";
import classes from "./Rollback.module.css";

export type UndoButtonProps = {
  gameName: string;
  /** Shows a "History…" link that should open the game log drawer (where any event can be rewound to). */
  onOpenHistory?: () => void;
  className?: string;
};

type Status = { kind: "idle" } | { kind: "busy" } | { kind: "error"; message: string; needsForce: boolean } | { kind: "done"; message: string };

/**
 * Compact one-step undo for the top bar. The tooltip names what will be undone; clicking asks once, then calls the
 * bot's own undo (`POST /api/game/{g}/undo`). Must sit inside `<PlayProvider>`.
 */
export function UndoButton({ gameName, onOpenHistory, className }: UndoButtonProps) {
  const { data, error } = useUndoPoints(gameName);
  const undo = useUndoStore((s) => s.undo);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const latest = data?.points.find((p) => p.current) ?? data?.points[0];
  const canUndo = !!data?.canUndo && !!latest;
  const tip = error ? `Undo unavailable: ${error}` : canUndo && latest ? `Undo: ${latest.label}` : "Nothing to undo";

  const run = async (force: boolean) => {
    setStatus({ kind: "busy" });
    try {
      const res = await undo(gameName, force);
      setStatus({ kind: "done", message: `Undid: ${res.undoneLabel}` });
      window.setTimeout(() => {
        setOpen(false);
        setStatus({ kind: "idle" });
      }, 1400);
    } catch (e) {
      const needsForce = e instanceof UndoApiError && e.needsForce;
      setStatus({ kind: "error", message: e instanceof Error ? e.message : String(e), needsForce });
    }
  };

  const toggle = () => {
    setStatus({ kind: "idle" });
    setOpen((o) => !o);
  };

  return (
    <Popover opened={open} onChange={setOpen} position="bottom-end" shadow="md" width={300} withinPortal>
      <Popover.Target>
        <Tooltip label={tip} disabled={open} withinPortal openDelay={250} multiline maw={280}>
          <button
            type="button"
            className={`${classes.undoButton} ${className ?? ""}`}
            onClick={toggle}
            aria-label={tip}
            aria-expanded={open}
            data-disabled={!canUndo || undefined}
          >
            <IconArrowBackUp size={16} stroke={1.75} aria-hidden />
          </button>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown className={`ti4play ${classes.pop}`}>
        <div className={classes.popTitle}>{canUndo && latest ? `Undo: ${latest.label}?` : error ? `Undo unavailable: ${error}` : "Nothing to undo yet."}</div>
        {status.kind === "error" && (
          <p className={classes.error} role="alert">
            {status.message}
          </p>
        )}
        {status.kind === "done" && <p className={classes.done}>{status.message}</p>}
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
          {canUndo && status.kind !== "done" && (
            <button
              type="button"
              className={classes.danger}
              disabled={status.kind === "busy"}
              onClick={() => void run(status.kind === "error" && status.needsForce)}
              data-autofocus
            >
              <IconArrowBackUp size={14} stroke={2} aria-hidden />
              {status.kind === "busy" ? "Undoing…" : status.kind === "error" && status.needsForce ? "Undo anyway" : "Undo"}
            </button>
          )}
        </div>
      </Popover.Dropdown>
    </Popover>
  );
}
