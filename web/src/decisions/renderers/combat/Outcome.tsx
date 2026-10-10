import { useMemo, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { UnstyledButton } from "@mantine/core";
import { IconX } from "@tabler/icons-react";
import { usePlay } from "@/discord";
import { usePlayerData } from "@/api/usePlayerData";
import type { PlayerData, PlayerDataResponse } from "@/entities/data/types";
import { getPlanetData } from "@/entities/lookup/planets";
import { FactionIcon } from "../../ui/parts";
import { readCombatLog, type CombatLog } from "./rolls";
import { EMOJI_UNIT, countName } from "./units";
import classes from "./combat.module.css";

/** A fight that ended in the last few minutes is reported; older ones are history (the game log has them). */
const RECENT_MS = 10 * 60_000;
const SHIPS = new Set(["ws", "fs", "dn", "ca", "cv", "dd", "ff"]);
const GROUND = new Set(["gf", "mf"]);
const WORD_UNIT: Record<string, string> = { ...EMOJI_UNIT, "war sun": "ws" };

type Result = {
  key: string;
  where: string;
  ground: boolean;
  winner?: PlayerData;
  iWon: boolean;
  losses: { player?: PlayerData; units: [string, number][] }[];
};

function sameFaction(a?: string, b?: string) {
  if (!a || !b) return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

/** Units destroyed per faction, from "X destroyed 2 fighters" and "assigned hits in the following way: Destroyed 2 <:fighter:>". */
function lossesOf(log: CombatLog) {
  const out = new Map<string, Map<string, number>>();
  for (const l of log.losses) {
    if (!l.faction) continue;
    const add = (unit: string | undefined, n: number) => {
      if (!unit) return;
      const m = out.get(l.faction!) ?? new Map<string, number>();
      m.set(unit, (m.get(unit) ?? 0) + n);
      out.set(l.faction!, m);
    };
    for (const m of l.text.matchAll(/destroyed (\d+) (?:damaged )?<a?:(\w+):\d+>/gi)) add(EMOJI_UNIT[m[2].toLowerCase()], Number(m[1]));
    for (const m of l.text.matchAll(/destroyed (\d+) (?:damaged )?([a-z ]+?)s?\b(?: in| on|\.)/gi)) add(WORD_UNIT[m[2].toLowerCase().replace(/s$/, "")], Number(m[1]));
  }
  return out;
}

function sidesAt(web: PlayerDataResponse, position: string, planet: string | undefined) {
  const tile = web.tileUnitData?.[position];
  if (!tile) return null;
  const alive = (list: { entityType: string; entityId: string; count: number }[], kinds: Set<string>) =>
    list.some((u) => u.entityType === "unit" && u.count > 0 && kinds.has(u.entityId));
  if (planet) {
    const ents = tile.planets?.[planet]?.entities ?? {};
    return Object.entries(ents).filter(([, us]) => alive(us, GROUND)).map(([f]) => f);
  }
  return Object.entries(tile.space ?? {}).filter(([, us]) => alive(us, SHIPS)).map(([f]) => f);
}

/** My combats that just ended, read from their threads and the live map. */
function useEndedCombats(gameName: string): Result[] {
  const channels = usePlay((s) => s.channels);
  const messages = usePlay((s) => s.messages);
  const meId = usePlay((s) => s.me?.id);
  const { data: web } = usePlayerData(gameName);
  return useMemo(() => {
    const me = web?.playerData.find((p) => p.discordId === meId);
    if (!web || !me?.faction) return [];
    const results: Result[] = [];
    for (const ch of Object.values(channels)) {
      const name = ch.name ?? "";
      if (!name.startsWith(`${gameName}-`) || !/-vs-/.test(name)) continue;
      const sides = (name.split("-turn-")[1] ?? "").replace(/^\d+-/, "").split("-vs-");
      if (!sides.includes(me.faction)) continue;
      const position = name.match(/system-(\w+)-turn/)?.[1];
      const data = messages[ch.id];
      if (!position || !data) continue;
      const thread = data.ids.map((id) => data.byId[id]).filter(Boolean);
      const log = readCombatLog(thread, me.faction, meId);
      const last = [...log.rolls].reverse().find((r) => r.kind === "combat");
      if (!last || Date.now() - last.at > RECENT_MS) continue;
      const planetName = thread.find((m) => m.id === last.id)?.content.match(/rolls for (.+?) combat/)?.[1];
      const planet = last.ground
        ? Object.keys(web.tileUnitData?.[position]?.planets ?? {}).find((p) => (getPlanetData(p)?.name ?? p).toLowerCase() === planetName?.toLowerCase())
        : undefined;
      if (last.ground && !planet) continue;
      const alive = sidesAt(web, position, planet);
      if (!alive || alive.length >= 2) continue;
      const winner = alive[0] ? web.playerData.find((p) => p.faction === alive[0]) : undefined;
      const lost = lossesOf(log);
      const players = sides.map((f) => web.playerData.find((p) => p.faction === f));
      results.push({
        key: `${ch.id}:${last.id}`,
        where: last.ground ? (getPlanetData(planet!)?.name ?? planet!) : (planetName ?? position),
        ground: last.ground,
        winner,
        iWon: winner?.faction === me.faction,
        losses: players.map((p) => ({
          player: p,
          units: [...([...lost.entries()].find(([f]) => sameFaction(f, p?.faction))?.[1]?.entries() ?? [])],
        })),
      });
    }
    return results;
  }, [channels, messages, web, meId, gameName]);
}

function readDismissed(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem("ti4.combatOutcomes") ?? "[]") as string[];
  } catch {
    return [];
  }
}

/**
 * "Space combat at Andeara — you won": a card that stays until closed once a fight of mine ends, with who is left
 * and what each side lost. The decision popup has nothing to show then (the bot leaves its combat buttons up).
 */
export function CombatOutcome({ gameName, rightInset = 0 }: { gameName: string; rightInset?: number }) {
  const ended = useEndedCombats(gameName);
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);
  const shown = ended.filter((r) => !dismissed.includes(r.key));
  if (!shown.length || typeof document === "undefined") return null;
  const close = (key: string) => {
    const next = [...dismissed, key].slice(-30);
    setDismissed(next);
    try {
      sessionStorage.setItem("ti4.combatOutcomes", JSON.stringify(next));
    } catch {
      /* private window: dismissed for this page only */
    }
  };
  const style = { "--decision-right-inset": `${rightInset}px` } as CSSProperties;
  return createPortal(
    <div className={`ti4play ${classes.outcomeStack}`} style={style} role="status" aria-live="polite">
      {shown.map((r) => (
        <div key={r.key} className={classes.outcomeCard}>
          <div className={classes.outcome}>
            <span className={classes.outcomeWord} data-tone={r.iWon ? "good" : r.winner ? "bad" : "even"}>
              {r.iWon ? "Victory" : r.winner ? "Defeat" : "Both sides destroyed"}
            </span>
            <span className={classes.status}>
              {r.ground ? "Ground combat on" : "Space combat at"} <strong>{r.where}</strong>
              {r.winner && !r.iWon ? ` — ${r.winner.userName} holds it` : r.iWon ? " — you hold it" : ""}
            </span>
            <span className={classes.grow} />
            <UnstyledButton className={classes.close} onClick={() => close(r.key)} aria-label="Close">
              <IconX size={14} />
            </UnstyledButton>
          </div>
          {r.losses.map((l) => (
            <div key={l.player?.faction ?? "?"} className={classes.rollRow}>
              <span className={classes.rollWho}>
                <FactionIcon faction={l.player?.faction} size={14} />
                {l.player?.userName ?? "Opponent"}
              </span>
              <span className={classes.note}>{l.units.length ? `lost ${l.units.map(([u, n]) => countName(u, n)).join(", ")}` : "no losses"}</span>
              <span />
            </div>
          ))}
        </div>
      ))}
    </div>,
    document.body,
  );
}
