import { Navigate } from "react-router-dom";
import { getToken } from "@/play/session";
import { SiteFrame } from "@/play/SiteFrame";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import classes from "./LandingPage.module.css";

/** Signed-in players go straight to their games; everyone else learns how to get in. */
export default function LandingPage() {
  useDocumentTitle("TI4 Online");
  if (getToken()) return <Navigate to="/play" replace />;

  return (
    <SiteFrame>
      <section className={classes.hero}>
        <p className={classes.kicker}>Twilight Imperium · 4th edition</p>
        <h1 className={classes.title}>A table for you and your friends.</h1>
        <p className={classes.lede}>
          Full rules, every expansion, the real galaxy map — played in the
          browser at whatever pace your group keeps. There are no accounts: each
          player has a private link.
        </p>
        <div className={classes.callout}>
          <span className={classes.calloutLabel}>Have a seat?</span>
          <span>
            Ask your host for your player link and open it on this device. It
            looks like <code className={classes.code}>/play?t=…</code>
          </span>
        </div>
      </section>
    </SiteFrame>
  );
}
