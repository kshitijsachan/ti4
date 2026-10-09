import { Link } from "react-router-dom";
import cx from "clsx";
import { AppHeader } from "@/shared/ui/AppHeader";
import mapClasses from "@/shared/ui/map/MapUI.module.css";
import { usePlay } from "@/discord";
import { deriveGames } from "@/play/games";
import { ConnectionBadge } from "@/play/ConnectionBadge";
import classes from "./GameHeader.module.css";

type Props = {
  gameId: string;
};

/** Header deck of the game screen: wordmark, the player's other games, link state. */
export function GameHeader({ gameId }: Props) {
  const channels = usePlay((s) => s.channels);
  const games = deriveGames(channels);
  const listed = games.some((g) => g.name === gameId)
    ? games
    : [{ name: gameId }, ...games];

  return (
    <AppHeader groupProps={{ className: mapClasses.newHeaderGroup }}>
      <nav className={classes.games} aria-label="Your games">
        {listed.map((game) => (
          <Link
            key={game.name}
            to={`/game/${game.name}`}
            className={cx(
              classes.game,
              game.name === gameId && classes.current,
            )}
            aria-current={game.name === gameId ? "page" : undefined}
          >
            {game.name}
          </Link>
        ))}
      </nav>
      <div className={classes.spacer} />
      <Link to="/play" className={classes.home}>
        All games
      </Link>
      <ConnectionBadge />
    </AppHeader>
  );
}
