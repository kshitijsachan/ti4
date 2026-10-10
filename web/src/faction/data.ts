import { useEffect, useState } from "react";
import type { FactionBundle } from "./types";

type Loaded = { official: FactionBundle; extended?: FactionBundle };

let official: FactionBundle | undefined;
let officialPromise: Promise<FactionBundle> | undefined;
let extended: FactionBundle | undefined;
let extendedPromise: Promise<FactionBundle> | undefined;
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((l) => l());

/** Base, PoK, Codex and Thunder's Edge factions plus every generic unit and tech (one lazy chunk, ~200KB). */
export function loadOfficial(): Promise<FactionBundle> {
  if (official) return Promise.resolve(official);
  officialPromise ??= import("./data/officialData").then((m) => {
    official = m.default;
    notify();
    return official;
  });
  return officialPromise;
}

/** Homebrew factions (Discordant Stars etc.): loaded only when a sheet asks for a faction outside the official set. */
export function loadExtended(): Promise<FactionBundle> {
  if (extended) return Promise.resolve(extended);
  extendedPromise ??= import("./data/extendedData").then((m) => {
    extended = m.default;
    notify();
    return extended;
  });
  return extendedPromise;
}

/** Synchronous view of whatever has loaded so far. */
export function peekBundles(): Loaded | undefined {
  return official ? { official, extended } : undefined;
}

/** Which bundle holds a faction, or undefined if none loaded so far does. */
export function bundleFor(alias: string, loaded: Loaded | undefined): FactionBundle | undefined {
  if (!loaded) return undefined;
  if (loaded.official.factions[alias]) return loaded.official;
  if (loaded.extended?.factions[alias]) return mergeGenerics(loaded.extended, loaded.official);
  return undefined;
}

const merged = new WeakMap<FactionBundle, FactionBundle>();

/** Homebrew bundles carry no generic units/techs; borrow them from the official bundle. */
function mergeGenerics(ext: FactionBundle, base: FactionBundle): FactionBundle {
  const hit = merged.get(ext);
  if (hit) return hit;
  const out: FactionBundle = {
    ...ext,
    units: { ...base.units, ...ext.units },
    techs: { ...base.techs, ...ext.techs },
  };
  merged.set(ext, out);
  return out;
}

/**
 * Loads the faction data on demand and re-renders when it arrives. Pass a faction to also pull in the homebrew
 * bundle when the faction is not an official one.
 */
export function useFactionBundles(faction?: string): Loaded | undefined {
  const [, force] = useState(0);
  useEffect(() => {
    const listener = () => force((n) => n + 1);
    listeners.add(listener);
    void loadOfficial().then((o) => {
      if (faction && !o.factions[faction]) void loadExtended();
    });
    return () => {
      listeners.delete(listener);
    };
  }, [faction]);
  return peekBundles();
}

/** True while the faction might still turn up in a bundle that has not loaded yet. */
export function isFactionPending(alias: string, loaded: Loaded | undefined): boolean {
  if (!loaded) return true;
  if (loaded.official.factions[alias]) return false;
  return !loaded.extended;
}
