import { createRoot, type Root } from "react-dom/client";
import classes from "./payment.module.css";

const SHOW_MS = 8000;
let current: { root: Root; host: HTMLElement; timer: number } | null = null;

function close() {
  if (!current) return;
  window.clearTimeout(current.timer);
  current.root.unmount();
  current.host.remove();
  current = null;
}

/**
 * What a payment bought, in one line, for a few seconds after the popup has moved on ("Built 2 fighters, 1 carrier at
 * 307 — paid 4 (Arretze, Kamdorn)"). Rendered outside the popup: the prompt it answered is gone by then.
 */
export function showReceipt(headline: string, detail?: string) {
  if (typeof document === "undefined") return;
  close();
  const host = document.createElement("div");
  host.className = "ti4play";
  document.body.appendChild(host);
  const root = createRoot(host);
  root.render(
    <div className={classes.receipt} role="status" aria-live="polite">
      <span className={classes.receiptHead}>{headline}</span>
      {detail && <span className={classes.receiptDetail}>{detail}</span>}
    </div>,
  );
  current = { root, host, timer: window.setTimeout(close, SHOW_MS) };
}
