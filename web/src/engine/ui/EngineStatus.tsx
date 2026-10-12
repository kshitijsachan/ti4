import { useEffect, useState } from "react";
import { UnstyledButton } from "@mantine/core";
import { IconInfoCircle, IconLoader2 } from "@tabler/icons-react";
import { engineStore, useEngine, useEngineMode, useLegacyRequested } from "../store";
import { PopupLayer } from "./Popup";
import classes from "./EngineStatus.module.css";

/** A quick (re)connect shows nothing; only one that takes longer than this gets the chip. */
const SHOW_AFTER_MS = 1500;

/** "Reconnecting to the game engine…" while this game's stream is not live: there is no other decision UI. */
function Connecting({ gameName }: { gameName: string }) {
  const mode = useEngineMode(gameName);
  const status = useEngine((s) => s.view.status);
  const available = useEngine((s) => s.server?.available ?? true);
  const [late, setLate] = useState(false);
  const waiting = mode === "waiting";
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setTimeout(() => setLate(true), SHOW_AFTER_MS);
    return () => {
      window.clearTimeout(timer);
      setLate(false);
    };
  }, [waiting]);
  if (!waiting || !late) return null;
  const text =
    !available || status === "unavailable"
      ? "The game engine is not answering — reconnecting to the game engine…"
      : "Connecting to the game engine…";
  return (
    <div className={classes.chip} role="status" data-engine-connecting={status}>
      <IconLoader2 size={14} className={classes.spin} />
      {text}
    </div>
  );
}

/** `?engine=0` (or the old settings toggle) asked for the legacy decision UI, which no longer exists. */
function LegacyRemoved() {
  const requested = useLegacyRequested();
  if (!requested) return null;
  return (
    <div className={classes.chip} role="status" data-engine-legacy-removed>
      <IconInfoCircle size={14} />
      <span>The legacy decision UI has been removed (engine=0 is ignored): decisions always come from the game engine now.</span>
      <UnstyledButton className={classes.ok} onClick={() => engineStore.getState().setOverride(null)}>
        OK
      </UnstyledButton>
    </div>
  );
}

/** Status chips over the table, beside the decision popup. */
export function EngineStatus({ gameName, placement = "contained", rightInset = 0 }: { gameName: string; placement?: "fixed" | "contained"; rightInset?: number }) {
  return (
    <PopupLayer contained={placement === "contained"} rightInset={rightInset}>
      <div className={classes.stack}>
        <LegacyRemoved />
        <Connecting gameName={gameName} />
      </div>
    </PopupLayer>
  );
}
