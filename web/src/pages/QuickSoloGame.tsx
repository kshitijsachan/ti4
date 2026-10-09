import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { IconMinus, IconPlayerPlay, IconPlus } from "@tabler/icons-react";
import cx from "clsx";
import classes from "./QuickSoloGame.module.css";

type SoloStatus = {
  game?: string;
  state: "creating" | "setting_up" | "drafting" | "error";
  step: string;
  error?: string;
};

const MIN_BOTS = 2;
const MAX_BOTS = 7;

async function errorText(res: Response) {
  try {
    const body = (await res.json()) as { message?: string };
    return body.message ?? `The server answered ${res.status}.`;
  } catch {
    return `The server answered ${res.status}.`;
  }
}

/**
 * One press: the server adds autopilot opponents, creates a game with them and
 * this seat, picks Thunder's Edge + PoK, and starts the Milty draft.
 */
export function QuickSoloGame({
  token,
  beforeOpen,
  className,
}: {
  /** The human seat that plays. */
  token: string | null;
  /** Runs just before navigating to the game (e.g. to make this tab play as `token`). */
  beforeOpen?: () => void;
  className?: string;
}) {
  const navigate = useNavigate();
  const [bots, setBots] = useState(3);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<SoloStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const open = (game: string) => {
    beforeOpen?.();
    navigate(`/game/${game}`);
  };

  const follow = async (game: string) => {
    while (alive.current) {
      await new Promise((r) => setTimeout(r, 1000));
      const res = await fetch(
        `/app/solo-game/status?game=${encodeURIComponent(game)}`,
      );
      if (!res.ok) throw new Error(await errorText(res));
      const next = (await res.json()) as SoloStatus;
      if (!alive.current) return;
      setStatus(next);
      if (next.state === "error")
        throw new Error(next.error ?? "Setup failed.");
      if (next.state === "drafting") return open(game);
    }
  };

  const start = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    setStatus({ state: "creating", step: "Creating the game" });
    try {
      const res = await fetch("/app/solo-game", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, bots }),
      });
      if (!res.ok) throw new Error(await errorText(res));
      const body = (await res.json()) as { game: string; status: SoloStatus };
      setStatus(body.status);
      await follow(body.game);
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const step = (d: number) =>
    setBots((n) => Math.min(MAX_BOTS, Math.max(MIN_BOTS, n + d)));

  return (
    <section className={cx(classes.panel, className)}>
      <div className={classes.row}>
        <div className={classes.text}>
          <div className={classes.title}>Quick solo game</div>
          <div className={classes.hint}>
            You against autopilot opponents · Thunder&apos;s Edge + PoK · Milty
            draft
          </div>
        </div>
        <div className={classes.stepper} aria-label="Autopilot opponents">
          <button
            type="button"
            className={classes.stepBtn}
            onClick={() => step(-1)}
            disabled={busy || bots <= MIN_BOTS}
            aria-label="Fewer opponents"
          >
            <IconMinus size={14} />
          </button>
          <span className={classes.stepValue}>
            <span className={classes.num}>{bots}</span> bots
          </span>
          <button
            type="button"
            className={classes.stepBtn}
            onClick={() => step(1)}
            disabled={busy || bots >= MAX_BOTS}
            aria-label="More opponents"
          >
            <IconPlus size={14} />
          </button>
        </div>
        <button
          type="button"
          className={classes.go}
          onClick={() => void start()}
          disabled={busy || !token}
        >
          <IconPlayerPlay size={15} />
          {busy ? "Setting up…" : "Play solo"}
        </button>
      </div>
      {busy && status && (
        <div className={classes.progress} role="status">
          <span className={classes.pulse} />
          {status.state === "drafting" ? "Drafting" : status.step}
          {status.game && (
            <button
              type="button"
              className={classes.link}
              onClick={() => open(status.game!)}
            >
              Open {status.game}
            </button>
          )}
        </div>
      )}
      {error && <p className={classes.error}>{error}</p>}
    </section>
  );
}
