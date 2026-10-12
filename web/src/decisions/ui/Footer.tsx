import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
import classes from "./DecisionHost.module.css";

/** The popup's footer, under its scrolling body: the element a renderer's primary action is rendered into. */
export const FooterSlot = createContext<HTMLElement | null>(null);

/**
 * A renderer's primary action (Confirm, Pay, Build), kept in the popup's footer so a long body scrolls under it and
 * the action never falls below the fold. Rendered in place when there is no popup around it (the dev harness).
 */
export function DecisionFooter({ children }: { children: ReactNode }) {
  const slot = useContext(FooterSlot);
  if (!slot) return <>{children}</>;
  return createPortal(<div className={classes.footerPart}>{children}</div>, slot);
}
