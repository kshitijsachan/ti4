import { useState } from "react";
import { Modal } from "@mantine/core";
import { IconPlayerTrackPrev } from "@tabler/icons-react";
import { formatSaveTime } from "./format";
import type { UndoPoint } from "./types";
import classes from "./Rollback.module.css";

export type RewindRequest = {
  /** What the player clicked, as one line ("Bob researched Gravity Drive"). */
  eventLabel: string;
  point: UndoPoint;
  /** How many saved actions after `point` will be undone. */
  undoCount: number;
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

  const confirm = async () => {
    if (!request) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(request.point);
      onCancel();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const p = request?.point;
  return (
    <Modal opened={!!request} onClose={close} centered size={440} title="Rewind the game?" classNames={{ content: `ti4play ${classes.dialog}`, title: classes.dialogTitle }}>
      {request && p && (
        <div className={classes.dialogBody}>
          <p className={classes.question}>
            Rewind the game to just after: <b>{request.eventLabel}</b>?
          </p>
          <p className={classes.warning}>
            Everything after this will be undone for everyone
            {request.undoCount > 0 ? ` (${request.undoCount} saved ${request.undoCount === 1 ? "action" : "actions"})` : ""}.
          </p>
          <div className={classes.saveLine}>
            <span className={classes.saveIdx}>save {p.index}</span>
            <span className={classes.saveLabel}>{p.label}</span>
            <span className={classes.saveMeta}>{formatSaveTime(p)}</span>
          </div>
          <p className={classes.hint}>The old messages stay in the log, greyed out. You can undo the rewind straight afterwards.</p>
          {error && (
            <p className={classes.error} role="alert">
              {error}
            </p>
          )}
          <div className={classes.actions}>
            <button type="button" className={classes.secondary} onClick={close} disabled={busy}>
              Cancel
            </button>
            <button type="button" className={classes.danger} onClick={() => void confirm()} disabled={busy} data-autofocus>
              <IconPlayerTrackPrev size={14} stroke={2} aria-hidden />
              {busy ? "Rewinding…" : "Rewind"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
