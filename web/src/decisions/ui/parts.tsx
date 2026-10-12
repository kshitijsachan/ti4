import { useState, type ReactNode } from "react";
import { UnstyledButton } from "@mantine/core";
import cx from "clsx";
import { Markdown } from "@/discord";
import { cdnImage } from "@/entities/data/cdnImage";
import type { EntityData, PlayerData, PlayerDataResponse } from "@/entities/data/types";
import { getStrategyCardByInitiative } from "@/entities/lookup/strategyCards";
import { getColorAlias } from "@/entities/lookup/colors";
import classes from "./parts.module.css";

/** Cleaned bot prose; long prose is clamped behind "Show all". */
export function Prose({ text, clamp = 2, muted }: { text: string; clamp?: number; muted?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  const lines = text.split("\n").length;
  const long = lines > clamp || text.length > clamp * 110;
  return (
    <div className={cx(classes.prose, muted && classes.muted)}>
      <div className={cx(classes.proseBody, long && !open && classes.clamped)} style={{ ["--clamp" as string]: clamp }}>
        <Markdown content={text} />
      </div>
      {long && (
        <UnstyledButton className={classes.textLink} onClick={() => setOpen((v) => !v)}>
          {open ? "Show less" : "Show all"}
        </UnstyledButton>
      )}
    </div>
  );
}

/** Secondary information, folded away by default so the popup stays calm. */
export function Details({ children, label = "Details" }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={classes.details}>
      <UnstyledButton className={classes.textLink} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? "Hide details" : label}
      </UnstyledButton>
      {open && <div className={classes.detailsBody}>{children}</div>}
    </div>
  );
}

export function Section({ label, children, aside }: { label: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className={classes.section}>
      <header className={classes.sectionHead}>
        <span className={classes.sectionLabel}>{label}</span>
        {aside}
      </header>
      {children}
    </section>
  );
}

export function scDefinition(initiative: number, web?: PlayerDataResponse) {
  return getStrategyCardByInitiative(initiative, web?.strategyCardIdMap);
}

export function scArtUrl(initiative: number, web?: PlayerDataResponse) {
  const sc = scDefinition(initiative, web);
  return sc?.imageFileName ? cdnImage(`/strat_cards/${sc.imageFileName}.png`) : undefined;
}

/** The printed strategy card. */
export function ScArt({ initiative, web, width = 180, className }: {
  initiative: number;
  web?: PlayerDataResponse;
  width?: number;
  className?: string;
}) {
  const src = scArtUrl(initiative, web);
  const sc = scDefinition(initiative, web);
  if (!src) {
    return (
      <div className={cx(classes.scFallback, className)} style={{ width, height: Math.round(width * 1.25) }}>
        <span className={classes.scFallbackNum}>{initiative}</span>
        <span>{sc?.name ?? "Strategy card"}</span>
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={sc?.name ?? `Strategy card ${initiative}`}
      width={width}
      height={Math.round(width * 1.2475)}
      className={cx(classes.scArt, className)}
      draggable={false}
    />
  );
}

/** One labelled number: "Tactic 3". */
export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "warn" | "good" }) {
  return (
    <span className={cx(classes.stat, tone && classes[tone])}>
      <span className={classes.statValue}>{value}</span>
      <span className={classes.statLabel}>{label}</span>
    </span>
  );
}

/** My command tokens and wealth, the numbers most decisions spend. */
export function ResourceStrip({ me, show = ["tactic", "fleet", "strategy", "tg", "comm"] }: {
  me?: PlayerData;
  show?: ("tactic" | "fleet" | "strategy" | "tg" | "comm" | "influence" | "resources")[];
}) {
  if (!me) return null;
  const all = {
    tactic: <Stat key="tactic" label="Tactic" value={me.tacticalCC} />,
    fleet: <Stat key="fleet" label="Fleet" value={me.fleetCC} />,
    strategy: <Stat key="strategy" label="Strategy" value={me.strategicCC} tone={me.strategicCC === 0 ? "warn" : undefined} />,
    tg: <Stat key="tg" label="Trade goods" value={me.tg} />,
    comm: <Stat key="comm" label="Commodities" value={`${me.commodities}/${me.commoditiesTotal}`} />,
    influence: <Stat key="influence" label="Influence ready" value={me.influence} />,
    resources: <Stat key="resources" label="Resources ready" value={me.resources} />,
  };
  return <div className={classes.strip}>{show.map((k) => all[k])}</div>;
}

export function FactionIcon({ faction, size = 18 }: { faction?: string; size?: number }) {
  if (!faction) return null;
  return (
    <img
      src={cdnImage(`/factions/${faction}.png`)}
      alt=""
      width={size}
      height={size}
      className={classes.factionIcon}
      onError={(e) => (e.currentTarget.style.visibility = "hidden")}
    />
  );
}

/** A player's faction icon and name. */
export function PlayerTag({ player, fallback }: { player?: PlayerData; fallback?: string }) {
  return (
    <span className={classes.playerTag}>
      <FactionIcon faction={player?.faction} />
      <span>{player?.userName ?? fallback ?? "Unknown"}</span>
    </span>
  );
}

const UNIT_ORDER = ["ws", "fs", "dn", "ca", "cv", "dd", "ff", "mf", "gf", "pd", "sd"];
const UNIT_NAMES: Record<string, string> = {
  ws: "War Sun",
  fs: "Flagship",
  dn: "Dreadnought",
  ca: "Cruiser",
  cv: "Carrier",
  dd: "Destroyer",
  ff: "Fighter",
  mf: "Mech",
  gf: "Infantry",
  pd: "PDS",
  sd: "Space Dock",
};

/** Unit art with counts, e.g. the ships on one side of a combat. */
export function UnitRow({ units, color, empty = "No units", small }: {
  units: EntityData[];
  color?: string;
  empty?: string;
  small?: boolean;
}) {
  const list = units
    .filter((u) => u.entityType === "unit" && u.count > 0)
    .sort((a, b) => UNIT_ORDER.indexOf(a.entityId) - UNIT_ORDER.indexOf(b.entityId));
  if (!list.length) return <span className={classes.none}>{empty}</span>;
  const alias = getColorAlias(color);
  return (
    <div className={cx(classes.units, small && classes.unitsSmall)}>
      {list.map((u) => (
        <span key={u.entityId} className={classes.unit} title={`${u.count} × ${UNIT_NAMES[u.entityId] ?? u.entityId}`}>
          <img src={cdnImage(`/units/${alias}_${u.entityId}.png`)} alt={UNIT_NAMES[u.entityId] ?? u.entityId} className={classes.unitImg} />
          <span className={classes.unitCount}>{u.count}</span>
          {u.sustained ? <span className={classes.damaged}>damaged {u.sustained}</span> : null}
        </span>
      ))}
    </div>
  );
}
