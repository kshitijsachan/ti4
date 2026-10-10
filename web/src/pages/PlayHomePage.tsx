import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { UnstyledButton } from "@mantine/core";
import { IconArrowRight, IconPlus } from "@tabler/icons-react";
import cx from "clsx";
import { SiteFrame } from "@/play/SiteFrame";
import { ConnectionBadge } from "@/play/ConnectionBadge";
import { clearToken, getToken } from "@/play/session";
import { displayName, usePlay, type User } from "@/discord";
import { deriveGames, type GameChannels } from "@/play/games";
import { usePlayerData } from "@/api/usePlayerData";
import { CircularFactionIcon } from "@/shared/ui/CircularFactionIcon";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import type { PlayerDataResponse } from "@/entities/data/types";
import { QuickSoloGame } from "./QuickSoloGame";
import classes from "./PlayHomePage.module.css";

/** Players besides you a game can seat. */
const MAX_OTHERS = 7;

const PHASE_LABELS: Record<string, string> = {
  strategy: "Strategy phase",
  action: "Action phase",
  status: "Status phase",
  agenda: "Agenda phase",
};

function summarize(data: PlayerDataResponse) {
  const active = data.playerData.find((p) => p.active);
  return {
    round: data.gameRound,
    vpsToWin: data.vpsToWin,
    phase: data.gameState?.phase,
    mapReady: data.tilePositions.length > 0,
    activeName: active?.userName,
    players: data.playerData
      .filter((p) => p.faction && p.faction !== "null")
      .map((p) => ({ faction: p.faction, name: p.userName, vps: p.totalVps })),
  };
}

function GameCard({ game }: { game: GameChannels }) {
  const { data, isError } = usePlayerData(game.name, { select: summarize });
  const funName = game.tableTalk?.name.slice(game.name.length + 1);
  const phase = data?.phase ? PHASE_LABELS[data.phase] : undefined;
  const status =
    !data || !data.mapReady ? "Setting up" : (phase ?? `Round ${data.round}`);

  return (
    <Link to={`/game/${game.name}`} className={classes.card}>
      <div className={classes.cardTop}>
        <span className={classes.gameName}>{game.name}</span>
        <span className={cx(classes.status, data?.mapReady && classes.live)}>
          {isError ? "Setting up" : status}
        </span>
      </div>
      {funName && (
        <div className={classes.funName}>{funName.replace(/-/g, " ")}</div>
      )}
      <div className={classes.cardBottom}>
        <div className={classes.factions}>
          {data?.players.map((p) => (
            <span
              key={p.faction}
              className={classes.faction}
              title={`${p.name} · ${p.vps} VP`}
            >
              <CircularFactionIcon faction={p.faction} size={22} />
            </span>
          ))}
        </div>
        {data?.mapReady && (
          <span className={classes.meta}>
            R{data.round} · {data.vpsToWin} VP
            {data.activeName && <> · {data.activeName} to play</>}
          </span>
        )}
        <IconArrowRight size={16} className={classes.go} />
      </div>
    </Link>
  );
}

const EXPANSIONS = [
  { id: "te", label: "Thunder's Edge + PoK" },
  { id: "newPoK", label: "Prophecy of Kings" },
  { id: "oldPoK", label: "PoK (old rules)" },
] as const;

type NewGameStatus = {
  game?: string;
  state: "creating" | "setting_up" | "drafting" | "playing" | "error";
  step: string;
  error?: string;
};

async function errorText(res: Response) {
  try {
    const body = (await res.json()) as { message?: string };
    return body.message ?? `The server answered ${res.status}.`;
  } catch {
    return `The server answered ${res.status}.`;
  }
}

/**
 * A new game for the people you pick: the server creates it, launches it, picks the expansion and starts the
 * Milty draft for you, then you (and everyone you picked) land in the draft.
 */
function NewGame() {
  const me = usePlay((s) => s.me);
  const users = usePlay((s) => s.users);
  const botReady = usePlay((s) => s.status === "open" && s.botOnline);
  const navigate = useNavigate();
  const [picked, setPicked] = useState<string[]>([]);
  const [expansion, setExpansion] = useState<(typeof EXPANSIONS)[number]["id"]>("te");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<NewGameStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const people = Object.values(users)
    .filter((u) => !u.bot && u.id !== me?.id)
    .sort((a, b) => displayName(a).localeCompare(displayName(b)));

  const toggle = (user: User) =>
    setPicked((current) =>
      current.includes(user.id)
        ? current.filter((id) => id !== user.id)
        : current.length >= MAX_OTHERS
          ? current
          : [...current, user.id],
    );

  const create = async () => {
    setBusy(true);
    setError(null);
    setStatus({ state: "creating", step: "Creating the game" });
    try {
      const res = await fetch("/app/new-game", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: getToken(), players: picked, expansion }),
      });
      if (!res.ok) throw new Error(await errorText(res));
      const body = (await res.json()) as { game: string; status: NewGameStatus };
      setStatus(body.status);
      while (alive.current) {
        await new Promise((r) => setTimeout(r, 1000));
        const poll = await fetch(`/app/new-game/status?game=${encodeURIComponent(body.game)}`);
        if (!poll.ok) throw new Error(await errorText(poll));
        const next = (await poll.json()) as NewGameStatus;
        if (!alive.current) return;
        setStatus(next);
        if (next.state === "error") throw new Error(next.error ?? "Setup failed.");
        if (next.state === "drafting" || next.state === "playing") {
          navigate(`/game/${body.game}`);
          return;
        }
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  return (
    <section className={classes.panel}>
      <div className={classes.label}>New game</div>
      <p className={classes.note}>
        Pick who plays with you. The game is set up for you and everyone lands in the draft.
      </p>
      {people.length === 0 ? (
        <p className={classes.note}>No other players yet — ask your host to add them.</p>
      ) : (
        <div className={classes.people}>
          {people.map((user) => {
            const on = picked.includes(user.id);
            return (
              <UnstyledButton
                key={user.id}
                className={cx(classes.person, on && classes.personOn)}
                onClick={() => toggle(user)}
                aria-pressed={on}
                disabled={busy}
              >
                <span className={classes.check}>{on ? "✓" : ""}</span>
                {displayName(user)}
              </UnstyledButton>
            );
          })}
        </div>
      )}
      <div className={classes.actions}>
        <select
          className={classes.select}
          value={expansion}
          onChange={(e) => setExpansion(e.target.value as typeof expansion)}
          disabled={busy}
          aria-label="Expansion"
        >
          {EXPANSIONS.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
        </select>
        <span className={classes.meta}>
          You + {picked.length} {picked.length === 1 ? "player" : "players"}
        </span>
        <button
          type="button"
          className={classes.primary}
          disabled={!picked.length || busy || !botReady}
          onClick={() => void create()}
          title={botReady ? undefined : "The game server is starting up"}
        >
          <IconPlus size={14} />
          {!botReady ? "Game server starting…" : busy ? "Setting up…" : "Create game"}
        </button>
      </div>
      {busy && status && (
        <p className={classes.note} role="status">
          {status.step}
        </p>
      )}
      {error && <p className={classes.error}>{error}</p>}
    </section>
  );
}

/** Takes me to a game that appears while I'm on this page (someone just started one with me in it). */
function useLandInNewGames(games: GameChannels[], ready: boolean) {
  const navigate = useNavigate();
  const known = useRef<Set<string> | null>(null);
  const names = games.map((g) => g.name).join(",");
  useEffect(() => {
    if (!ready) return;
    const now = new Set(names ? names.split(",") : []);
    if (known.current) {
      const fresh = [...now].find((n) => !known.current!.has(n));
      if (fresh) navigate(`/game/${fresh}`);
    }
    known.current = now;
  }, [names, ready, navigate]);
}

function Home() {
  const me = usePlay((s) => s.me);
  const channels = usePlay((s) => s.channels);
  const games = deriveGames(channels);
  const ready = usePlay((s) => s.status === "open");
  useLandInNewGames(games, ready && !!me);

  if (!me) {
    return <p className={classes.note}>Connecting…</p>;
  }

  return (
    <>
      <h1 className={classes.heading}>
        {games.length ? "Welcome back" : "Welcome"}, {displayName(me)}
      </h1>
      <QuickSoloGame token={getToken()} />
      <section className={classes.section}>
        <div className={classes.label}>
          Your games <span className={classes.count}>{games.length}</span>
        </div>
        {games.length === 0 ? (
          <p className={classes.note}>
            No games yet. Start one below, or wait for a friend to add you to
            theirs — you will be taken there as soon as they do.
          </p>
        ) : (
          <div className={classes.grid}>
            {games.map((game) => (
              <GameCard key={game.name} game={game} />
            ))}
          </div>
        )}
      </section>
      <NewGame />
    </>
  );
}

/** A player's home: their games and the way to start a new one. */
export default function PlayHomePage() {
  useDocumentTitle("Your games · TI4 Online");

  const signOut = () => {
    clearToken();
    window.location.assign("/");
  };

  return (
    <SiteFrame
      actions={
        <>
          <UnstyledButton className={classes.signOut} onClick={signOut}>
            Forget this device
          </UnstyledButton>
          <ConnectionBadge />
        </>
      }
    >
      <Home />
    </SiteFrame>
  );
}
