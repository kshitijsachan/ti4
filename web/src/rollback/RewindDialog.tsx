import { useState } from "react";
import { Modal } from "@mantine/core";
import { IconPlayerTrackPrev } from "@tabler/icons-react";
import type { UndoPoint } from "./types";
import classes from "./Rollback.module.css";

export type RewindRequest = {
  /** What the player clicked, as one line ("Bob researched Gravity Drive"). */
  eventLabel: string;
  point: UndoPoint;
  /** How many saved actions after `point` will be undone. */
  undoCount: number;
  /** The save just before this event, to undo the event itself too ("Rewind to before it"). */
  before?: UndoPoint;
};

type Props = {
  request: RewindRequest | null;
  onCancel: () => void;
  /** Resolves when the rewind is done; a rejection is shown in the dialog. */
  onConfirm: (point: UndoPoint) => Promise<unknown>;
};

/** "Rewind the game to just after: …? Everything after this will be undone for everyone." */
export function RewindDialog({ request, onCancel, onConfirm }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setError(null);
    onCancel();
  };

  const confirm = async (point: UndoPoint) => {
    if (!request) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(point);
      onCancel();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

    return (
    <Modal opened={!!request} onClose={close} centered size={400} zIndex={3500} title="Rewind the game?" classNames={{ content: `ti4play ${classes.dialog}`, title: classes.dialogTitle }}>
      {request && (
        <div className={classes.dialogBody}>
          <p className={classes.question}>
            Rewind the game to <b>{request.eventLabel}</b>?
          </p>
          <p className={classes.warning}>
            “Before it” also undoes this event; “just after it” keeps it. Everything later is undone for everyone.
          </p>
          {error && (
            <p className={classes.error} role="alert">
              {error}
            </p>
          )}
          <div className={classes.actions}>
            <button type="button" className={classes.secondary} onClick={close} disabled={busy}>
              Cancel
            </button>
            {request.before && (
              <button type="button" className={classes.danger} onClick={() => void confirm(request.before!)} disabled={busy} data-autofocus>
                <IconPlayerTrackPrev size={14} stroke={2} aria-hidden />
                {busy ? "Rewinding…" : "Before it"}
              </button>
            )}
            <button
              type="button"
              className={request.before ? classes.secondary : classes.danger}
              onClick={() => void confirm(request.point)}
              disabled={busy}
              data-autofocus={!request.before || undefined}
            >
              {!request.before && <IconPlayerTrackPrev size={14} stroke={2} aria-hidden />}
              {busy && !request.before ? "Rewinding…" : "Just after it"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
