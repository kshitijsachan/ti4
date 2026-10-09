import { useState } from "react";
import { Link } from "react-router-dom";
import { UnstyledButton } from "@mantine/core";
import { IconArrowRight, IconPlus } from "@tabler/icons-react";
import cx from "clsx";
import { SiteFrame } from "@/play/SiteFrame";
import { ConnectionBadge } from "@/play/ConnectionBadge";
import { clearToken } from "@/play/session";
import {
  ChannelView,
  displayName,
  usePlay,
  usePlayConnection,
  type Command,
  type User,
} from "@/discord";
import { deriveGames, lobbyChannel, type GameChannels } from "@/play/games";
import { usePlayerData } from "@/api/usePlayerData";
import { CircularFactionIcon } from "@/shared/ui/CircularFactionIcon";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import type { PlayerDataResponse } from "@/entities/data/types";
import classes from "./PlayHomePage.module.css";

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

/** How many player slots `/game create_game_button` takes. */
function maxSeats(commands: Command[]) {
  const game = commands.find((c) => c.name === "game");
  const sub = game?.options?.find((o) => o.name === "create_game_button");
  return sub?.options?.filter((o) => o.type === 6).length || 8;
}

function NewGame({ lobbyId }: { lobbyId: string }) {
  const me = usePlay((s) => s.me);
  const users = usePlay((s) => s.users);
  const commands = usePlay((s) => s.commands);
  const connection = usePlayConnection();
  const [picked, setPicked] = useState<string[]>(() => (me ? [me.id] : []));
  const [nonce, setNonce] = useState<string | null>(null);
  const busy = usePlay((s) => !!nonce && !!s.pending[nonce]);
  const botReady = usePlay((s) => s.status === "open" && s.botOnline);
  const error = usePlay((s) => (nonce ? s.results[nonce] : null));

  const people = Object.values(users)
    .filter((u) => !u.bot)
    .sort((a, b) => displayName(a).localeCompare(displayName(b)));
  const limit = maxSeats(commands);

  const toggle = (user: User) => {
    setPicked((current) => {
      if (current.includes(user.id))
        return current.filter((id) => id !== user.id);
      if (current.length >= limit) return current;
      return [...current, user.id];
    });
  };

  const create = () => {
    const options = [
      { type: 3, name: "game_fun_name", value: "_" },
      ...picked.map((id, i) => ({
        type: 6,
        name: `player${i + 1}`,
        value: id,
      })),
    ];
    setNonce(
      connection.runCommand(lobbyId, "game", [
        { type: 1, name: "create_game_button", options },
      ]),
    );
  };

  return (
    <section className={classes.panel}>
      <div className={classes.label}>New game</div>
      <p className={classes.note}>
        Pick who is playing. The bot posts a summary in the lobby below — press
        its
        <strong> Launch Game</strong> button to open the table.
      </p>
      <div className={classes.people}>
        {people.map((user) => {
          const on = picked.includes(user.id);
          return (
            <UnstyledButton
              key={user.id}
              className={cx(classes.person, on && classes.personOn)}
              onClick={() => toggle(user)}
              aria-pressed={on}
            >
              <span className={classes.check}>
                {on ? picked.indexOf(user.id) + 1 : ""}
              </span>
              {displayName(user)}
              {user.id === me?.id && <span className={classes.you}>you</span>}
            </UnstyledButton>
          );
        })}
      </div>
      <div className={classes.actions}>
        <span className={classes.meta}>
          {picked.length} of up to {limit} players
        </span>
        <button
          type="button"
          className={classes.primary}
          disabled={!picked.length || busy || !botReady}
          onClick={create}
          title={botReady ? undefined : "The game server is starting up"}
        >
          <IconPlus size={14} />
          {!botReady
            ? "Game server starting…"
            : busy
              ? "Creating…"
              : "Create game"}
        </button>
      </div>
      {error && <p className={classes.error}>{error}</p>}
      <div className={classes.lobby}>
        <div className={classes.lobbyLabel}># lobby</div>
        <div className={classes.lobbyView}>
          <ChannelView channelId={lobbyId} header={false} />
        </div>
      </div>
    </section>
  );
}

function Home() {
  const me = usePlay((s) => s.me);
  const channels = usePlay((s) => s.channels);
  const games = deriveGames(channels);
  const lobby = lobbyChannel(channels);

  if (!me) {
    return <p className={classes.note}>Connecting…</p>;
  }

  return (
    <>
      <h1 className={classes.heading}>
        {games.length ? "Welcome back" : "Welcome"}, {displayName(me)}
      </h1>
      <section className={classes.section}>
        <div className={classes.label}>
          Your games <span className={classes.count}>{games.length}</span>
        </div>
        {games.length === 0 ? (
          <p className={classes.note}>
            No games yet. Start one below, or wait for a friend to add you to
            theirs.
          </p>
        ) : (
          <div className={classes.grid}>
            {games.map((game) => (
              <GameCard key={game.name} game={game} />
            ))}
          </div>
        )}
      </section>
      {lobby && <NewGame lobbyId={lobby.id} />}
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
