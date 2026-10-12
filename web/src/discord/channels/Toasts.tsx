import { useEffect } from "react";
import { IconAlertTriangle, IconInfoCircle, IconX } from "@tabler/icons-react";
import { usePlay, usePlayConnection } from "../client/PlayProvider";
import type { Toast } from "../client/store";
import classes from "./Toasts.module.css";

function ToastItem({ t }: { t: Toast }) {
  const conn = usePlayConnection();
  useEffect(() => {
    const id = window.setTimeout(() => conn.actions.dismissToast(t.id), t.kind === "error" ? 8000 : 4000);
    return () => window.clearTimeout(id);
  }, [conn, t]);
  return (
    <div className={classes.toast} data-kind={t.kind} role={t.kind === "error" ? "alert" : "status"}>
      {t.kind === "error" ? <IconAlertTriangle size={15} className={classes.icon} /> : <IconInfoCircle size={15} className={classes.icon} />}
      <span className={classes.text}>{t.text}</span>
      <button type="button" className={classes.close} onClick={() => conn.actions.dismissToast(t.id)} aria-label="Dismiss">
        <IconX size={13} />
      </button>
    </div>
  );
}

/** Action failures and connection notices, stacked bottom-right. */
export function Toasts() {
  const toasts = usePlay((s) => s.toasts);
  if (!toasts.length) return null;
  return (
    <div className={`ti4play ${classes.stack}`} aria-live="polite">
      {toasts.map((t) => (
        <ToastItem key={t.id} t={t} />
      ))}
    </div>
  );
}
