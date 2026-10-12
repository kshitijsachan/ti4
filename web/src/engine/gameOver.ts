import type { Decision, GameEnd, GameState } from "./contract";

/** One seat's place on the winner screen (engine Standing, or built from the players when the engine has none). */
export type StandingRow = {
  userId: string;
  name: string;
  faction: string | null;
  color: string | null;
  victoryPoints: number;
  rank: number;
  winner: boolean;
  self: boolean;
};

/** What the winner screen shows. */
export type GameOverView = {
  /** "won": somebody won, the game is not ended yet (End Game / Rematch still open); "ended": the game was ended. */
  finish: "won" | "ended";
  winners: StandingRow[];
  standings: StandingRow[];
  victoryPointsToWin: number | null;
  /** The open end-of-game prompt (End Game / Rematch), if the table still has one. */
  endPrompt: GameEnd | null;
};

/** The game is over: won or ended (GameState.ended; phase "finished" from engines that say so). */
export function isGameOver(state: GameState | null | undefined): boolean {
  return !!state && (state.ended || (state.phase as string) === "finished");
}

/** The open game.end prompt of this game (any scope: anyone at the table may press it), newest first. */
export function endPromptOf(decisions: Iterable<Decision>): GameEnd | null {
  let best: GameEnd | null = null;
  for (const d of decisions) {
    if (d.kind !== "game.end") continue;
    if (!best || d.createdAt > best.createdAt) best = d;
  }
  return best;
}

/**
 * The winner screen's model from the engine state: winners, final standings (the engine's, else the players by
 * victory points), and the open End Game prompt. Null while the game is on.
 */
export function gameOverView(state: GameState | null | undefined, decisions: Iterable<Decision>): GameOverView | null {
  if (!state || !isGameOver(state)) return null;
  const winnerIds = new Set(state.winners ?? []);
  const selfId = state.players.find((p) => p.self)?.userId;
  const nameOf = (id: string) => state.players.find((p) => p.userId === id)?.userName ?? "A player";
  let standings: StandingRow[];
  if (state.standings?.length) {
    standings = state.standings.map((s) => ({
      userId: s.userId,
      name: s.userName || nameOf(s.userId),
      faction: s.faction,
      color: s.color,
      victoryPoints: s.victoryPoints,
      rank: s.rank,
      winner: s.winner,
      self: s.userId === selfId,
    }));
  } else {
    const seated = state.players
      .filter((p) => p.faction)
      .slice()
      .sort((a, b) => Number(winnerIds.has(b.userId)) - Number(winnerIds.has(a.userId)) || b.victoryPoints - a.victoryPoints);
    standings = [];
    seated.forEach((p, i) => {
      const prev = standings[i - 1];
      const winner = winnerIds.has(p.userId);
      const rank = prev && prev.victoryPoints === p.victoryPoints && prev.winner === winner ? prev.rank : i + 1;
      standings.push({
        userId: p.userId,
        name: p.userName,
        faction: p.faction,
        color: p.color,
        victoryPoints: p.victoryPoints,
        rank,
        winner,
        self: p.userId === selfId,
      });
    });
  }
  const finish = state.finish ?? (state.ended && !winnerIds.size ? "ended" : "won");
  return {
    finish: finish === "ended" ? "ended" : "won",
    winners: standings.filter((s) => s.winner),
    standings,
    victoryPointsToWin: state.victoryPointsToWin ?? null,
    endPrompt: finish === "ended" ? null : endPromptOf(decisions),
  };
}

/** "Navy wins" / "Navy and Red win" / "Game over" for headers and the tab title. */
export function gameOverHeadline(view: Pick<GameOverView, "winners">): string {
  const names = view.winners.map((w) => (w.self ? "You" : w.name));
  if (!names.length) return "Game over";
  if (names.length === 1) return names[0] === "You" ? "You win!" : `${names[0]} wins`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} win`;
}
