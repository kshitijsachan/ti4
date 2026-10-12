import { useEffect, useState } from "react";
import { getActionCard } from "@/entities/lookup/actionCards";
import { getSecretObjectiveData } from "@/entities/lookup/secretObjectives";
import { getRelicData } from "@/entities/lookup/relics";
import { promissoryNotes } from "@/entities/data/promissoryNotes";
import { indexBy } from "@/entities/lookup/indexBy";
import type { ActionCard, PromissoryNote, Relic, SecretObjective } from "@/entities/data/types";

/**
 * Card text lookups. The generated data in entities/data predates newer bot
 * content (Thunder's Edge and others) and errata; `data/extraCards.ts` carries
 * every card the bot words differently or that is missing, straight from the
 * bot's resources (`dev/gen-extra-cards.mjs`), and wins over the old data. It
 * is loaded on first use so the tray does not weigh down the page bundle.
 */
type Extra = {
  ac: Record<string, Partial<ActionCard>>;
  so: Record<string, Partial<SecretObjective>>;
  pn: Record<string, Partial<PromissoryNote>>;
  relic: Record<string, Partial<Relic>>;
};

let extra: Extra | null = null;
let loading: Promise<void> | null = null;

function loadExtra(): Promise<void> {
  loading ??= import("./data/extraCards").then((m) => {
    extra = m.default as Extra;
  });
  return loading;
}

/** True once the supplementary card data is in; re-renders the caller when it lands. */
export function useCardData(): boolean {
  const [ready, setReady] = useState(extra !== null);
  useEffect(() => {
    if (ready) return;
    let live = true;
    void loadExtra().then(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, [ready]);
  return ready;
}

const pnMap = indexBy(
  promissoryNotes.filter((note) => !note.homebrewReplacesID),
  (note) => note.alias,
);

function merged<T>(base: T | undefined, newer: Partial<T> | undefined): Partial<T> | undefined {
  if (!newer) return base;
  return base ? { ...base, ...newer } : newer;
}

export function actionCardData(alias: string): Partial<ActionCard> | undefined {
  return merged(getActionCard(alias), extra?.ac[alias]);
}

export function secretData(alias: string): Partial<SecretObjective> | undefined {
  return merged(getSecretObjectiveData(alias), extra?.so[alias]);
}

export function promissoryData(alias: string): Partial<PromissoryNote> | undefined {
  return merged(pnMap.get(alias), extra?.pn[alias]);
}

export function relicData(alias: string): Partial<Relic> | undefined {
  return merged(getRelicData(alias), extra?.relic[alias]);
}
