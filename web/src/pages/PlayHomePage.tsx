import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Link } from "react-router-dom";
import { useQueries, useQuery } from "@tanstack/react-query";
import { UnstyledButton } from "@mantine/core";
import { IconArrowRight, IconPlus, IconX } from "@tabler/icons-react";
import cx from "clsx";
import { SiteFrame } from "@/play/SiteFrame";
import { ConnectionBadge } from "@/play/ConnectionBadge";
import { clearToken, getToken } from "@/play/session";
import {
  displayName,
  usePlay,
  usePlayConnection,
  type Channel,
  type User,
} from "@/discord";
import { deriveGames, type GameChannels } from "@/play/games";
import {
  fetchPlayerData,
  GameDataFetchError,
  usePlayerData,
} from "@/api/usePlayerData";
import { CircularFactionIcon } from "@/shared/ui/CircularFactionIcon";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import type { PlayerDataResponse } from "@/entities/data/types";
import { QuickSoloGame } from "./QuickSoloGame";
import { preloadGamePage, useOpenGame } from "./openGame";
import classes from "./PlayHomePage.module.css";

/** Players besides you a game can seat. */
const MAX_OTHERS = 7;

const PHASE_LABELS: Record<string, string> = {
  strategy: "Strategy phase",
  action: "Action phase",
  status: "Status phase",
  agenda: "Agenda phase",
};

/** "status.homework" → "Status phase"; setup and unknown phases have no label. */
function phaseLabel(phase?: string) {
  return phase ? PHASE_LABELS[phase.split(".")[0]] : undefined;
}

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

/**
 * A plain left click opens the game through useOpenGame (code first, then the
 * route, with a visible "Opening"); modified clicks keep the link's own
 * behaviour (new tab, new window).
 */
function GameCard({
  game,
  onEnded,
}: {
  game: GameChannels;
  onEnded: (name: string) => void;
}) {
  const { data, isError } = usePlayerData(game.name, { select: summarize });
  const conn = usePlayConnection();
  const openGame = useOpenGame();
  const [opening, setOpening] = useState(false);
  const funName = game.tableTalk?.name.slice(game.name.length + 1);
  const phase = phaseLabel(data?.phase);
  const settingUp =
    !data || !data.mapReady || !!data.phase?.startsWith("setup");
  const status = settingUp ? "Setting up" : (phase ?? `Round ${data.round}`);

  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    if (opening) return;
    setOpening(true);
    void openGame(game.name).finally(() => setOpening(false));
  };

  /** Ends the game for everyone with the bot's own `/game end` (no results posted; its channels are archived). */
  const endGame = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!window.confirm(`End ${game.name} for everyone? This can't be undone.`))
      return;
    conn.runCommand(game.actions.id, "game", [
      {
        type: 1,
        name: "end",
        options: [
          { type: 3, name: "confirm", value: "YES" },
          { type: 5, name: "publish", value: false },
          { type: 5, name: "archive_channels", value: true },
        ],
      },
    ]);
    onEnded(game.name);
  };

  return (
    <Link
      to={`/game/${game.name}`}
      className={cx(classes.card, opening && classes.opening)}
      onClick={onClick}
      onPointerEnter={preloadGamePage}
      aria-busy={opening}
    >
      <div className={classes.cardTop}>
        <span className={classes.gameName}>{game.name}</span>
        <span className={cx(classes.status, data?.mapReady && classes.live)}>
          {opening ? "Opening…" : isError ? "Setting up" : status}
        </span>
        <button
          type="button"
          className={classes.endGame}
          onClick={endGame}
          title="End this game"
          aria-label={`End ${game.name}`}
        >
          <IconX size={14} />
        </button>
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

/** The bot's end-game flow moves a game's channels to "The in-limbo PBD Archive". */
const ARCHIVE_CATEGORY = /archive|limbo/i;

function isArchived(game: GameChannels, channels: Record<string, Channel>) {
  if (game.actions.thread_metadata?.archived) return true;
  const category = game.actions.parent_id
    ? channels[game.actions.parent_id]
    : undefined;
  return !!category && ARCHIVE_CATEGORY.test(category.name);
}

type GameFate = "active" | "gone" | "loading";

/**
 * Whether a game belongs on the home page: not ended (the bot reports phase
 * "finished" once a game has ended or has a winner), not deleted (its data is
 * gone), and I hold a seat in it. Bot hiccups other than "not found" keep it.
 */
function gameFate(
  query: { data?: PlayerDataResponse; error: Error | null; isPending: boolean },
  meId: string,
): GameFate {
  if (query.error) {
    const missing =
      query.error instanceof GameDataFetchError && query.error.status === 404;
    return missing ? "gone" : "active";
  }
  if (query.isPending || !query.data) return "loading";
  const { gameState, playerData } = query.data;
  if (gameState?.phase === "finished" || gameState?.winner) return "gone";
  const seated =
    playerData.length === 0 || playerData.some((p) => p.discordId === meId);
  return seated ? "active" : "gone";
}

/** My games that are still being played, newest first. */
function useActiveGames(meId: string | undefined) {
  const channels = usePlay((s) => s.channels);
  const visible = deriveGames(channels).filter((g) => !isArchived(g, channels));
  const queries = useQueries({
    queries: visible.map((g) => ({
      queryKey: ["playerData", g.name],
      queryFn: () => fetchPlayerData(g.name),
      // The home page has no live stream: re-check ended games on each visit.
      staleTime: 30_000,
      retry: false,
    })),
  });
  const [ended, setEnded] = useState<string[]>([]);
  const fates = queries.map((q) => (meId ? gameFate(q, meId) : "loading"));
  return {
    games: visible.filter(
      (g, i) => fates[i] === "active" && !ended.includes(g.name),
    ),
    onEnded: (name: string) => setEnded((e) => [...e, name]),
    loading: fates.includes("loading"),
  };
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

/**
 * Seats the shim says a person plays (no autopilot seats). Older shims don't
 * send `players`; then only the name rules below apply.
 */
async function fetchPeople(token: string): Promise<string[] | null> {
  const res = await fetch(`/app/me?token=${encodeURIComponent(token)}`);
  if (!res.ok) return null;
  const body = (await res.json()) as { players?: string[] };
  return body.players ?? null;
}

/** Solo games name their autopilot seats "Bot Alpha", "Bot Beta 2", ... */
const AUTOPILOT_NAME = /^Bot [A-Z][a-z]+(?: \d+)?$/;
/** Seats the test drivers and agents made (soak runs, e2e flows, role-named probes). */
const TEST_NAME =
  /^(?:soak|e2e|test|qa|probe|smoke|integrator|mapclicker|strategist|actor|handy|trader|follower)(?:\b|\d|$)/i;

function isPerson(user: User, players: string[] | null | undefined) {
  if (user.bot) return false;
  if (players && !players.includes(user.id)) return false;
  const name = displayName(user);
  return !AUTOPILOT_NAME.test(name) && !TEST_NAME.test(name);
}

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
  const openGame = useOpenGame();
  const token = getToken();
  const { data: players } = useQuery({
    queryKey: ["me-players", token],
    queryFn: () => fetchPeople(token!),
    enabled: !!token,
    staleTime: 60_000,
  });
  const [picked, setPicked] = useState<string[]>([]);
  const [expansion, setExpansion] =
    useState<(typeof EXPANSIONS)[number]["id"]>("te");
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
    .filter((u) => u.id !== me?.id && isPerson(u, players))
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
      const body = (await res.json()) as {
        game: string;
        status: NewGameStatus;
      };
      setStatus(body.status);
      while (alive.current) {
        await new Promise((r) => setTimeout(r, 1000));
        const poll = await fetch(
          `/app/new-game/status?game=${encodeURIComponent(body.game)}`,
        );
        if (!poll.ok) throw new Error(await errorText(poll));
        const next = (await poll.json()) as NewGameStatus;
        if (!alive.current) return;
        setStatus(next);
        if (next.state === "error")
          throw new Error(next.error ?? "Setup failed.");
        if (next.state === "drafting" || next.state === "playing") {
          await openGame(body.game);
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
        Pick who plays with you. The game is set up for you and everyone lands
        in the draft.
      </p>
      {people.length === 0 ? (
        <p className={classes.note}>
          No other players yet — ask your host to add them.
        </p>
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
          {!botReady
            ? "Game server starting…"
            : busy
              ? "Setting up…"
              : "Create game"}
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
  const openGame = useOpenGame();
  const known = useRef<Set<string> | null>(null);
  const names = games.map((g) => g.name).join(",");
  useEffect(() => {
    if (!ready) return;
    const now = new Set(names ? names.split(",") : []);
    if (known.current) {
      const fresh = [...now].find((n) => !known.current!.has(n));
      if (fresh) void openGame(fresh);
    }
    known.current = now;
  }, [names, ready, openGame]);
}

function Home() {
  const me = usePlay((s) => s.me);
  const channels = usePlay((s) => s.channels);
  const ready = usePlay((s) => s.status === "open");
  useLandInNewGames(deriveGames(channels), ready && !!me);
  const { games, loading, onEnded } = useActiveGames(me?.id);
  useEffect(preloadGamePage, []);

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
        {games.length === 0 && loading ? (
          <p className={classes.note}>Loading your games…</p>
        ) : games.length === 0 ? (
          <p className={classes.note}>
            No games yet. Start one below, or wait for a friend to add you to
            theirs — you will be taken there as soon as they do.
          </p>
        ) : (
          <div className={classes.grid}>
            {games.map((game) => (
              <GameCard key={game.name} game={game} onEnded={onEnded} />
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
