/** One saved state of the game (the bot's undo copy `<game>_<index>.txt`). */
export type UndoPoint = {
  index: number;
  /** When the bot saved it (epoch ms). */
  savedAt: number;
  fileTime: number;
  /** The bot's `latest_command`: the action that produced this state. */
  command: string;
  /** Discord username from the command (`tess`), if any. */
  actor: string;
  /** Readable version of `command` ("tess pressed “Play Politics”"). */
  label: string;
  round: number;
  phase: string;
  /** The save the game is in now. */
  current: boolean;
};

/** One roll-back (UNDO button, `/game undo`, web undo / rewind): at `at` the game went back to save `toIndex`. */
export type Rewind = {
  at: number;
  fromIndex: number;
  toIndex: number;
  fromSavedAt: number;
  toSavedAt: number;
  /** `rewind` / `undo` from the web; `undo` (no user) for the bot's own button and command. */
  kind: string;
  byUserId: string;
  byName: string;
  label: string;
  /** Save times of the undo copies this roll-back deleted (the bot keeps one linear history). */
  lostSavedAt?: number[];
};

export type UndoPointsResponse = {
  gameName: string;
  latestIndex: number;
  canUndo: boolean;
  /** Newest first. */
  points: UndoPoint[];
  /** Oldest first. */
  rewinds: Rewind[];
};

export type RewindResponse = {
  ok: boolean;
  restoredIndex: number;
  restoredLabel: string;
  undoneLabel: string;
  latestIndex: number;
};
