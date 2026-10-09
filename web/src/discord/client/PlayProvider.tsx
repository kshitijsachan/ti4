import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import type { Snowflake } from "../types";
import { PlayConnection } from "./connection";
import type { PlayState } from "./store";

type PlayContextValue = {
  connection: PlayConnection;
  /** Called when the user clicks a `<#channel>` mention or a channel row without its own handler. */
  navigate: (channelId: Snowflake) => void;
};

const PlayContext = createContext<PlayContextValue | null>(null);

export type PlayProviderProps = {
  /** Seat token (`/play?t=`). Changing it opens a new connection. */
  token: string;
  /** Use this pre-built connection instead of opening one (tests, fixture harness). */
  connection?: PlayConnection;
  /** WebSocket endpoint override; defaults to same-origin `/app/ws`. */
  url?: string;
  /** Channel navigation hook for mentions; defaults to setting the store's active channel. */
  onNavigateChannel?: (channelId: Snowflake) => void;
  children: ReactNode;
};

/** Opens the player's realtime connection and exposes its store to every play component below it. */
export function PlayProvider({ token, url, connection: injected, onNavigateChannel, children }: PlayProviderProps) {
  const [own, setConnection] = useState<PlayConnection | null>(null);
  const connection = injected ?? own;

  useEffect(() => {
    if (injected) return;
    const conn = new PlayConnection({ token, url });
    conn.connect();
    setConnection(conn);
    return () => conn.close();
  }, [token, url, injected]);

  if (!connection) return null;
  const navigate = (channelId: Snowflake) => {
    if (onNavigateChannel) return onNavigateChannel(channelId);
    connection.actions.setActiveChannel(channelId);
  };
  return <PlayContext.Provider value={{ connection, navigate }}>{children}</PlayContext.Provider>;
}

function usePlayContext(): PlayContextValue {
  const ctx = useContext(PlayContext);
  if (!ctx) throw new Error("Play components must be rendered inside <PlayProvider>");
  return ctx;
}

/** The live connection (send ops, load history). */
export function usePlayConnection(): PlayConnection {
  return usePlayContext().connection;
}

export function usePlayNavigate() {
  return usePlayContext().navigate;
}

/** Subscribe to a slice of the play store. */
export function usePlay<T>(selector: (s: PlayState) => T): T {
  return useStore(usePlayContext().connection.store, selector);
}
