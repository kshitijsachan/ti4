import { useMemo, useState } from "react";
import { IconChevronRight, IconSearch } from "@tabler/icons-react";
import type { Actor, GameEvent, Phase } from "../types";
import { CATEGORIES, categoryOf, groupDigest, type CategoryId } from "../categories";
import { PHASE_LABEL } from "../parse/timeline";
import { actorLabel } from "../parse/markup";
import { actorKey, useGameEvents } from "../useGameEvents";
import { EventRow } from "./EventRow";
import { ActorName, EmojiImg } from "./Segments";
import classes from "./GameLogFull.module.css";

export type LogView = "phases" | "players" | "timeline";

type Props = { gameName: string; className?: string; defaultView?: LogView };

type Block = { key: string; round: number; phase: Phase; events: GameEvent[] };
type Group = { cat: CategoryId; events: GameEvent[] };

function toBlocks(events: GameEvent[]): Block[] {
  const byKey = new Map<string, Block>();
  for (const e of events) {
    if (e.kind === "phase") continue;
    const key = `${e.round}:${e.phase}`;
    const block = byKey.get(key);
    if (block) block.events.push(e);
    else byKey.set(key, { key, round: e.round, phase: e.phase, events: [e] });
  }
  return [...byKey.values()];
}

function toGroups(events: GameEvent[]): Group[] {
  const byCat = new Map<CategoryId, GameEvent[]>();
  for (const e of events) {
    const id = categoryOf(e.kind).id;
    byCat.set(id, [...(byCat.get(id) ?? []), e]);
  }
  return CATEGORIES.filter((c) => byCat.has(c.id)).map((c) => ({ cat: c.id, events: byCat.get(c.id)! }));
}

const blockTitle = (b: Block) => (b.round === 0 ? "Setup" : `Round ${b.round}`);

/** The full game history: hierarchical by round → phase → type, by player, or as a flat timeline. */
export function GameLogFull({ gameName, className, defaultView = "phases" }: Props) {
  const { events, players, loading } = useGameEvents(gameName);
  const [view, setView] = useState<LogView>(defaultView);
  const [query, setQuery] = useState("");
  const [onlyPlayers, setOnlyPlayers] = useState<string[]>([]);
  const [onlyCat, setOnlyCat] = useState<CategoryId | "">("");
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return events.filter((e) => {
      if (e.kind === "phase") return true;
      if (!showAll && e.importance < 2 && !q) return false;
      if (onlyCat && categoryOf(e.kind).id !== onlyCat) return false;
      if (onlyPlayers.length && !onlyPlayers.includes(actorKey(e.actor)) && !onlyPlayers.includes(actorKey(e.target))) return false;
      if (q && !e.text.toLowerCase().includes(q) && !(e.systemPosition ?? "").includes(q)) return false;
      return true;
    });
  }, [events, query, showAll, onlyCat, onlyPlayers]);

  const blocks = useMemo(() => toBlocks(filtered), [filtered]);
  const narrowed = !!query.trim() || !!onlyCat || onlyPlayers.length > 0;
  const latestKey = blocks[blocks.length - 1]?.key;
  const isOpen = (key: string, fallback: boolean) => open[key] ?? (narrowed || fallback);
  const toggle = (key: string, fallback: boolean) => setOpen((o) => ({ ...o, [key]: !isOpen(key, fallback) }));

  const togglePlayer = (k: string) => setOnlyPlayers((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));
  const usedCats = useMemo(() => new Set(events.map((e) => categoryOf(e.kind).id)), [events]);

  return (
    <section className={`ti4play ${classes.root} ${className ?? ""}`} aria-label="Game log">
      <header className={classes.head}>
        <div className={classes.titleRow}>
          <h2 className={classes.title}>Game log</h2>
          <div className={classes.views} role="tablist" aria-label="Group by">
            {(["phases", "players", "timeline"] as const).map((v) => (
              <button key={v} type="button" role="tab" aria-selected={view === v} className={classes.view} onClick={() => setView(v)}>
                {v === "phases" ? "By phase" : v === "players" ? "By player" : "Timeline"}
              </button>
            ))}
          </div>
        </div>
        <div className={classes.filters}>
          <label className={classes.search}>
            <IconSearch size={13} stroke={2} aria-hidden />
            <input type="search" placeholder="Search events, planets, cards…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <select className={classes.select} value={onlyCat} onChange={(e) => setOnlyCat(e.target.value as CategoryId | "")} aria-label="Event type">
            <option value="">All types</option>
            {CATEGORIES.filter((c) => usedCats.has(c.id)).map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className={classes.filters}>
          <div className={classes.players} role="group" aria-label="Players">
            {players.map((p) => (
              <button key={actorKey(p)} type="button" className={classes.player} aria-pressed={onlyPlayers.includes(actorKey(p))} onClick={() => togglePlayer(actorKey(p))} title={`Only ${actorLabel(p)}`}>
                <ActorName actor={p} />
              </button>
            ))}
          </div>
          <label className={classes.showAll} title="Include minor steps: turn starts, declined follows, card draws, offers">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            Show all
          </label>
        </div>
      </header>

      <div className={classes.body}>
        {!events.length && <div className={classes.empty}>{loading ? "Reading the game's history…" : "Nothing has happened yet."}</div>}
        {!!events.length && !blocks.length && <div className={classes.empty}>No events match.</div>}
        {view === "phases" && <ByPhase blocks={blocks} latestKey={latestKey} isOpen={isOpen} toggle={toggle} />}
        {view === "timeline" && <Timeline blocks={blocks} />}
        {view === "players" && <ByPlayer events={filtered} players={players} isOpen={isOpen} toggle={toggle} />}
        {loading && !!events.length && <div className={classes.loadingMore}>Loading older history…</div>}
      </div>
    </section>
  );
}

type OpenProps = { isOpen: (key: string, fallback: boolean) => boolean; toggle: (key: string, fallback: boolean) => void };

function ByPhase({ blocks, latestKey, isOpen, toggle }: { blocks: Block[]; latestKey?: string } & OpenProps) {
  return (
    <>
      {[...blocks].reverse().map((b) => (
        <div key={b.key} className={classes.block}>
          <BlockHeader block={b} />
          {toGroups(b.events).map((g) => {
            const key = `${b.key}/${g.cat}`;
            const fallback = b.key === latestKey;
            return <GroupSection key={key} group={g} open={isOpen(key, fallback)} onToggle={() => toggle(key, fallback)} />;
          })}
        </div>
      ))}
    </>
  );
}

function Timeline({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {[...blocks].reverse().map((b) => (
        <div key={b.key} className={classes.block}>
          <BlockHeader block={b} />
          <div className={classes.rows}>
            {b.events.map((e) => (
              <EventRow key={e.id} event={e} />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function ByPlayer({ events, players, isOpen, toggle }: { events: GameEvent[]; players: Actor[] } & OpenProps) {
  const sections = useMemo(() => {
    const byKey = new Map<string, GameEvent[]>();
    for (const e of events) {
      if (e.kind === "phase") continue;
      const k = actorKey(e.actor) || "~table";
      byKey.set(k, [...(byKey.get(k) ?? []), e]);
    }
    const ordered = players.map((p) => ({ key: actorKey(p), actor: p as Actor | undefined, events: byKey.get(actorKey(p)) ?? [] }));
    const table = byKey.get("~table");
    if (table) ordered.push({ key: "~table", actor: undefined, events: table });
    return ordered.filter((s) => s.events.length);
  }, [events, players]);

  return (
    <>
      {sections.map((s) => (
        <div key={s.key} className={classes.block}>
          <div className={classes.blockHead}>
            {s.actor ? <ActorName actor={s.actor} /> : <span className={classes.blockTitle}>The table</span>}
            <span className={classes.blockCount}>{s.events.length} events</span>
          </div>
          {toGroups(s.events).map((g) => {
            const key = `p:${s.key}/${g.cat}`;
            return <GroupSection key={key} group={g} open={isOpen(key, false)} onToggle={() => toggle(key, false)} showRound newestFirst perPlayer />;
          })}
        </div>
      ))}
    </>
  );
}

function BlockHeader({ block }: { block: Block }) {
  const vp = block.events.reduce((n, e) => n + (e.vp ?? 0), 0);
  return (
    <div className={classes.blockHead}>
      <span className={classes.blockTitle}>{blockTitle(block)}</span>
      {block.round > 0 && <span className={classes.blockPhase}>{PHASE_LABEL[block.phase]}</span>}
      <span className={classes.blockMeta}>{vp ? `${vp} VP scored` : ""}</span>
    </div>
  );
}

type GroupProps = { group: Group; open: boolean; onToggle: () => void; showRound?: boolean; newestFirst?: boolean; perPlayer?: boolean };

function GroupSection({ group, open, onToggle, showRound, newestFirst, perPlayer }: GroupProps) {
  const cat = CATEGORIES.find((c) => c.id === group.cat)!;
  const Icon = cat.icon;
  const rows = newestFirst ? [...group.events].reverse() : group.events;
  const factions = useMemo(() => {
    const seen = new Map<string, Actor>();
    for (const e of group.events) if (e.actor?.factionEmoji && e.actor.faction) seen.set(e.actor.faction, e.actor);
    return [...seen.values()].slice(0, 6);
  }, [group.events]);
  return (
    <div className={classes.group} data-cat={group.cat} data-open={open}>
      <button type="button" className={classes.groupHead} aria-expanded={open} onClick={onToggle}>
        <IconChevronRight className={classes.chevron} size={13} stroke={2} aria-hidden />
        <Icon className={classes.groupIcon} size={14} stroke={1.75} aria-hidden />
        <span className={classes.groupLabel}>{cat.label}</span>
        <span className={classes.count}>{group.events.length}</span>
        {!open && <span className={classes.digest}>{groupDigest(group.cat, group.events, perPlayer)}</span>}
        {!open && !perPlayer && !!factions.length && (
          <span className={classes.faces} aria-hidden>
            {factions.map((a) => (
              <EmojiImg key={a.faction} id={a.factionEmoji!.id} name={a.faction!} size="icon" />
            ))}
          </span>
        )}
      </button>
      {open && (
        <div className={classes.rows}>
          {rows.map((e) => (
            <EventRow key={e.id} event={e} showRound={showRound} />
          ))}
        </div>
      )}
    </div>
  );
}
