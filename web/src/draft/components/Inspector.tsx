import { useState } from "react";
import cx from "clsx";
import type {
  DraftFaction,
  DraftPlanet,
  DraftSlice,
  DraftState,
  DraftTile,
} from "../types";
import { playerById } from "../model";
import { SliceHexCluster } from "./SliceHexCluster";
import { Glyph, ResInf, SkipGlyph, TraitGlyph, WormholeGlyph } from "./Glyphs";
import { factionIcon, showComplexity } from "./FactionCard";
import { PlayerTag } from "./PlayerTag";
import classes from "../Draft.module.css";

const ANOMALY_LABEL: Record<string, string> = {
  asteroid: "Asteroid field",
  supernova: "Supernova",
  nebula: "Nebula",
  rift: "Gravity rift",
  scar: "Entropic scar",
};

export function SliceInspector({
  draft,
  slice,
  botBase,
}: {
  draft: DraftState;
  slice: DraftSlice;
  botBase: string;
}) {
  const [hoverTile, setHoverTile] = useState<number | null>(null);
  const template = draft.mapTemplate;
  const owner = playerById(draft, slice.choice.pickedBy);
  const t = slice.totals;
  return (
    <div className={classes.inspectorBody}>
      <div className={classes.inspectorHead}>
        <span className={classes.sliceLetterLg}>{slice.name}</span>
        <div className={classes.inspectorTitle}>
          <span className={classes.railLabel}>Slice {slice.name}</span>
          <span className={classes.inspectorStats}>
            <ResInf resources={t.resources} influence={t.influence} size="lg" />
            <span className={classes.optimal}>
              opt{" "}
              <ResInf
                resources={t.optimalResources}
                influence={t.optimalInfluence}
              />
              {t.optimalFlex > 0 && (
                <span className={classes.flex}>+{t.optimalFlex}</span>
              )}
            </span>
          </span>
        </div>
        {owner && <PlayerTag player={owner} draft={draft} />}
      </div>
      <div className={classes.inspectorCluster}>
        <SliceHexCluster
          tiles={slice.tiles}
          layout={template?.sliceLayout ?? []}
          tileWidth={template?.tileWidth ?? 345}
          tileHeight={template?.tileHeight ?? 300}
          width={230}
          botBase={botBase}
          homeLabel={slice.name}
          highlightIndex={hoverTile}
          onTileHover={setHoverTile}
        />
      </div>
      <ol className={classes.tileList}>
        {slice.tiles.map((tile, i) => (
          <TileRow
            key={`${tile.id}-${i}`}
            tile={tile}
            icons={draft.icons.glyphs}
            botBase={botBase}
            lit={hoverTile === i}
            onHover={(on) => setHoverTile(on ? i : null)}
          />
        ))}
      </ol>
    </div>
  );
}

function TileRow({
  tile,
  icons,
  botBase,
  lit,
  onHover,
}: {
  tile: DraftTile;
  icons: Record<string, string>;
  botBase: string;
  lit: boolean;
  onHover: (on: boolean) => void;
}) {
  const empty = tile.planets.length === 0;
  return (
    <li
      className={cx(classes.tileRow, lit && classes.tileRowLit)}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <img
        className={classes.tileThumb}
        src={`${botBase}${tile.image}?w=160`}
        alt=""
        draggable={false}
      />
      <div className={classes.tileInfo}>
        <div className={classes.tileHeadLine}>
          <span className={classes.tileName}>{tile.name}</span>
          <span className={classes.tileId}>#{tile.id}</span>
          {tile.tier && (
            <span className={cx(classes.tierTag, classes[`tier_${tile.tier}`])}>
              {tile.tier}
            </span>
          )}
          {tile.wormholes.map((w) => (
            <WormholeGlyph key={w} type={w} icons={icons} size={13} />
          ))}
          {tile.anomalies.map((a) => (
            <span key={a} className={classes.anomalyChip}>
              {ANOMALY_LABEL[a] ?? a}
            </span>
          ))}
        </div>
        {empty &&
          tile.anomalies.length === 0 &&
          tile.wormholes.length === 0 && (
            <span className={classes.featureNone}>Empty space</span>
          )}
        {tile.planets.map((p) => (
          <PlanetLine key={p.id} planet={p} icons={icons} />
        ))}
      </div>
    </li>
  );
}

function PlanetLine({
  planet,
  icons,
}: {
  planet: DraftPlanet;
  icons: Record<string, string>;
}) {
  return (
    <div
      className={classes.planetLine}
      title={planet.legendaryText ?? undefined}
    >
      <ResInf
        resources={planet.resources}
        influence={planet.influence}
        size="sm"
      />
      <span className={classes.planetName}>{planet.name}</span>
      {planet.station && <span className={classes.stationTag}>station</span>}
      <TraitGlyph traits={planet.traits} size={13} />
      {planet.techSpecialties.map((s) => (
        <SkipGlyph key={s} skip={s} size={13} />
      ))}
      {planet.legendary && (
        <span className={classes.legendaryTag}>
          <Glyph src={icons.legendary} alt="legendary" size={12} />
          {planet.legendaryAbility}
        </span>
      )}
    </div>
  );
}

export function FactionInspector({
  draft,
  faction,
  botBase,
}: {
  draft: DraftState;
  faction: DraftFaction;
  botBase: string;
}) {
  const owner = playerById(draft, faction.choice.pickedBy);
  return (
    <div className={classes.inspectorBody}>
      <div className={classes.inspectorHead}>
        <img
          className={classes.factionIconLg}
          src={factionIcon(faction)}
          alt=""
        />
        <div className={classes.inspectorTitle}>
          <span className={classes.factionNameLg}>{faction.name}</span>
          <span className={classes.factionMeta}>
            {showComplexity(faction.complexity) && (
              <span>{faction.complexity} complexity</span>
            )}
            <span>
              Commodities <b className={classes.mono}>{faction.commodities}</b>
            </span>
          </span>
        </div>
        {owner && <PlayerTag player={owner} draft={draft} />}
      </div>
      <div className={classes.factionHome}>
        {faction.homeSystemImage && (
          <img
            className={classes.factionHomeTile}
            src={`${botBase}${faction.homeSystemImage}?w=240`}
            alt=""
          />
        )}
        <div className={classes.factionHomePlanets}>
          <span className={classes.statLabel}>Home system</span>
          {faction.homePlanets.map((p) => (
            <PlanetLine key={p.id} planet={p} icons={draft.icons.glyphs} />
          ))}
        </div>
      </div>
      <Section label="Abilities" items={faction.abilities} />
      <Section label="Faction tech" items={faction.factionTech} />
      <Section label="Starting tech" items={faction.startingTech} />
    </div>
  );
}

function Section({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className={classes.inspectorSection}>
      <span className={classes.statLabel}>{label}</span>
      <div className={classes.chipRow}>
        {items.map((i) => (
          <span key={i} className={classes.abilityChip}>
            {i}
          </span>
        ))}
      </div>
    </div>
  );
}
