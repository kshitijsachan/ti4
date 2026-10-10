import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconMinus, IconPlayerPlay, IconPlus } from "@tabler/icons-react";
import cx from "clsx";
import { preloadGamePage, useOpenGame } from "./openGame";
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
  children,
}: {
  /** The human seat that plays. */
  token: string | null;
  /** Runs just before navigating to the game (e.g. to make this tab play as `token`). */
  beforeOpen?: () => void;
  className?: string;
  /** Extra controls under the main row (e.g. which seat plays). */
  children?: ReactNode;
}) {
  const openGame = useOpenGame();
  const [bots, setBots] = useState(3);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<SoloStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    preloadGamePage();
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);

  const open = async (url: string) => {
    beforeOpen?.();
    await openGame(url);
  };

  /**
   * The server answers once the game exists (seats added, game created and
   * launched); picking the expansion and starting the draft carry on in the
   * background, and the game screen shows them as they happen.
   */
  const start = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    setStartedAt(Date.now());
    setNow(Date.now());
    setStatus({
      state: "creating",
      step: `Seating ${bots} autopilot opponents and creating the game`,
    });
    try {
      const res = await fetch("/app/solo-game", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, bots }),
      });
      if (!res.ok) throw new Error(await errorText(res));
      const body = (await res.json()) as {
        game: string;
        url?: string;
        status: SoloStatus;
      };
      if (!alive.current) return;
      setStatus({
        ...body.status,
        game: body.game,
        step: `Opening ${body.game}`,
      });
      await open(body.url ?? `/game/${body.game}`);
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
      {children && <div className={classes.extra}>{children}</div>}
      {busy && status && (
        <div className={classes.progress} role="status">
          <span className={classes.pulse} />
          {status.step}
          {startedAt !== null && (
            <span className={classes.elapsed}>
              {Math.max(0, Math.round((now - startedAt) / 1000))}s
            </span>
          )}
        </div>
      )}
      {error && <p className={classes.error}>{error}</p>}
    </section>
  );
}
