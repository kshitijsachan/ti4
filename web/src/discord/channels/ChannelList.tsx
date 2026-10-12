import { useMemo, useState } from "react";
import { IconCards, IconChevronDown, IconHash, IconLock, IconMap, IconMessages } from "@tabler/icons-react";
import type { Channel, Snowflake } from "../types";
import { ChannelType } from "../types";
import { usePlay, usePlayConnection } from "../client/PlayProvider";
import { compareSnowflakes } from "../shared/snowflake";
import classes from "./ChannelList.module.css";

export type ChannelListProps = {
  /** Highlighted channel; defaults to the store's active channel. */
  selectedId?: Snowflake | null;
  /** Called on click; defaults to setting the store's active channel. */
  onSelect?: (channelId: Snowflake) => void;
  /** Only show channels for this game (name prefix `<game>-`, plus their category and threads). */
  gameName?: string;
  className?: string;
};

/** Onboarding and other low-signal threads, tucked into a collapsed group. */
const NOISE = [/^Info for Players new to/i, /^Welcome/i, /-?rules-?/i];

const isThread = (c: Channel) =>
  c.type === ChannelType.PublicThread || c.type === ChannelType.PrivateThread || c.type === ChannelType.AnnouncementThread;

type Node = { channel: Channel; threads: Channel[] };
type Section = { id: string; name: string; nodes: Node[] };

function byPosition(a: Channel, b: Channel) {
  return (a.position ?? 0) - (b.position ?? 0) || compareSnowflakes(a.id, b.id);
}

function buildTree(channels: Channel[], gameName?: string): { sections: Section[]; noise: Channel[] } {
  const prefix = gameName ? `${gameName}-` : null;
  const all = channels.filter((c) => c.type !== ChannelType.DM);
  const byId = new Map(all.map((c) => [c.id, c]));
  const inGame = (c: Channel): boolean => {
    if (!prefix) return true;
    if (c.name.startsWith(prefix)) return true;
    const parent = c.parent_id ? byId.get(c.parent_id) : undefined;
    return !!parent && isThread(c) && parent.name.startsWith(prefix);
  };
  const noise: Channel[] = [];
  const threadsOf = new Map<string, Channel[]>();
  for (const c of all) {
    if (!isThread(c) || !inGame(c)) continue;
    if (NOISE.some((r) => r.test(c.name))) {
      noise.push(c);
      continue;
    }
    const list = threadsOf.get(c.parent_id ?? "") ?? [];
    list.push(c);
    threadsOf.set(c.parent_id ?? "", list);
  }
  const textLike = all.filter((c) => !isThread(c) && c.type !== ChannelType.Category && inGame(c)).sort(byPosition);
  const categories = all.filter((c) => c.type === ChannelType.Category).sort(byPosition);
  const sections: Section[] = [];
  const toNode = (c: Channel): Node => ({ channel: c, threads: (threadsOf.get(c.id) ?? []).sort((a, b) => compareSnowflakes(a.id, b.id)) });
  const loose = textLike.filter((c) => !c.parent_id || !byId.has(c.parent_id));
  if (loose.length) sections.push({ id: "_", name: "", nodes: loose.map(toNode) });
  for (const cat of categories) {
    const nodes = textLike.filter((c) => c.parent_id === cat.id).map(toNode);
    if (nodes.length) sections.push({ id: cat.id, name: cat.name, nodes });
  }
  return { sections, noise };
}

function ChannelIcon({ c }: { c: Channel }) {
  if (/cards-info/.test(c.name)) return <IconCards size={14} />;
  if (/map-updates/.test(c.name)) return <IconMap size={14} />;
  if (c.type === ChannelType.PrivateThread) return <IconLock size={13} />;
  if (isThread(c)) return <IconMessages size={13} />;
  return <IconHash size={14} />;
}

function Row({ c, depth, selected, onSelect, gameName }: { c: Channel; depth: number; selected: boolean; onSelect: (id: string) => void; gameName?: string }) {
  const unread = usePlay((s) => s.unread[c.id] ?? 0);
  const mentions = usePlay((s) => s.mentions[c.id] ?? 0);
  const stale = usePlay((s) => {
    const last = s.channels[c.id]?.last_message_id;
    const read = s.lastRead[c.id];
    return !!last && (!read || compareSnowflakes(last, read) > 0);
  });
  const hasUnread = !selected && (unread > 0 || stale);
  const prefix = gameName && c.name.startsWith(`${gameName}-`) ? `${gameName}-` : null;
  const name = prefix ? c.name.slice(prefix.length) : c.name;
  return (
    <button
      type="button"
      className={classes.row}
      data-depth={depth}
      data-selected={selected || undefined}
      data-unread={hasUnread || undefined}
      onClick={() => onSelect(c.id)}
      title={c.name}
    >
      <span className={classes.icon}>
        <ChannelIcon c={c} />
      </span>
      <span className={classes.name}>{name}</span>
      {mentions > 0 && !selected ? (
        <span className={classes.mentionBadge}>{mentions}</span>
      ) : unread > 0 && !selected ? (
        <span className={classes.badge}>{unread > 99 ? "99+" : unread}</span>
      ) : null}
    </button>
  );
}

/** Game channels grouped by category with threads nested under their parent, plus unread state. */
export function ChannelList({ selectedId, onSelect, gameName, className }: ChannelListProps) {
  const conn = usePlayConnection();
  const channels = usePlay((s) => s.channels);
  const active = usePlay((s) => s.activeChannelId);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ _noise: true });
  const tree = useMemo(() => buildTree(Object.values(channels), gameName), [channels, gameName]);
  const sel = selectedId === undefined ? active : selectedId;
  const select = onSelect ?? ((id: string) => conn.actions.setActiveChannel(id));
  const toggle = (id: string) => setCollapsed((c) => ({ ...c, [id]: !c[id] }));

  return (
    <nav className={`ti4play ${classes.list} ${className ?? ""}`} aria-label="Channels">
      {tree.sections.map((section) => (
        <div key={section.id} className={classes.section}>
          {section.name && (
            <button type="button" className={classes.category} onClick={() => toggle(section.id)} aria-expanded={!collapsed[section.id]}>
              <IconChevronDown size={11} className={classes.chev} data-collapsed={collapsed[section.id] || undefined} />
              {section.name}
            </button>
          )}
          {!collapsed[section.id] &&
            section.nodes.map((n) => (
              <div key={n.channel.id}>
                <Row c={n.channel} depth={0} selected={sel === n.channel.id} onSelect={select} gameName={gameName} />
                {n.threads.map((t) => (
                  <Row key={t.id} c={t} depth={1} selected={sel === t.id} onSelect={select} gameName={gameName} />
                ))}
              </div>
            ))}
        </div>
      ))}
      {tree.noise.length > 0 && (
        <div className={classes.section}>
          <button type="button" className={classes.category} onClick={() => toggle("_noise")} aria-expanded={!collapsed._noise}>
            <IconChevronDown size={11} className={classes.chev} data-collapsed={collapsed._noise || undefined} />
            Guides & info
            <span className={classes.count}>{tree.noise.length}</span>
          </button>
          {!collapsed._noise &&
            tree.noise.map((c) => <Row key={c.id} c={c} depth={0} selected={sel === c.id} onSelect={select} gameName={gameName} />)}
        </div>
      )}
    </nav>
  );
}
