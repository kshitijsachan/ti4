import { useState, type CSSProperties, type ReactNode } from "react";
import { Loader } from "@mantine/core";
import { useElementSize } from "@mantine/hooks";
import { IconChevronDown, IconExternalLink } from "@tabler/icons-react";
import { cdnImage } from "@/entities/data/cdnImage";
import { getPrimaryColorCSS } from "@/entities/lookup/colors";
import { bundleFor, isFactionPending, useFactionBundles } from "./data";
import {
  buildFactionSheet,
  type BreakthroughEntry,
  type FactionSheetModel,
  type LeaderEntry,
  type LeaderState,
  type TechEntry,
  type UnitEntry,
} from "./model";
import { formatStartingFleet } from "./startingFleet";
import { techRgb, techTypeLabel, TECH_RGB } from "./techColors";
import { Prereqs, UnitCard } from "./UnitCard";
import type { FactionAbility, FactionPlayer, FactionPromissory, FactionTech } from "./types";
import styles from "./FactionSheet.module.css";

type Props = {
  faction: string;
  /** Live player state: marks owned techs/upgrades, leader states and uses the player's actual leaders/techs. */
  player?: FactionPlayer;
  playerColor?: string;
  /** Single column, secondary sections collapsed: for narrow popups. */
  compact?: boolean;
};

const TWO_COLUMN_MIN_WIDTH = 760;

/** A calm reference sheet for one faction: abilities, flagship & mech, units, techs, leaders, PN, breakthrough. */
export function FactionSheet({ faction, player, playerColor, compact }: Props) {
  const loaded = useFactionBundles(faction);
  const { ref, width } = useElementSize();
  const bundle = bundleFor(faction, loaded);
  const model = bundle ? buildFactionSheet(faction, bundle, player) : undefined;
  const color = playerColor ?? player?.color;
  const style = color ? ({ "--player-color": getPrimaryColorCSS(color) } as CSSProperties) : undefined;

  if (!model) {
    const pending = isFactionPending(faction, loaded);
    return (
      <div ref={ref} className={styles.sheet}>
        {pending ? <Loader size="sm" /> : <span className={styles.empty}>No reference data for “{faction}”.</span>}
      </div>
    );
  }

  const wide = !compact && width >= TWO_COLUMN_MIN_WIDTH;
  const sections = buildSections(model, { color, compact: !!compact, hasPlayer: !!player });
  return (
    <div ref={ref} className={`${styles.sheet} ${compact ? styles.compact : ""}`} style={style}>
      <Header model={model} />
      {wide ? (
        <div className={styles.columns}>
          <div className={styles.column}>{sections.filter((s) => s.column === 0).map((s) => s.node)}</div>
          <div className={styles.column}>{sections.filter((s) => s.column === 1).map((s) => s.node)}</div>
        </div>
      ) : (
        sections.map((s) => s.node)
      )}
    </div>
  );
}

type SectionSpec = { column: 0 | 1; node: ReactNode };
type BuildOpts = { color?: string; compact: boolean; hasPlayer: boolean };

function buildSections(model: FactionSheetModel, opts: BuildOpts): SectionSpec[] {
  const { color, compact } = opts;
  const out: SectionSpec[] = [];
  const push = (column: 0 | 1, node: ReactNode | null) => {
    if (node) out.push({ column, node });
  };
  push(
    0,
    model.headlineUnits.length > 0 && (
      <Section key="headline" title="Flagship & Mech">
        <div className={styles.headlineGrid}>
          {model.headlineUnits.map((e) => (
            <UnitEntryCard key={e.key} entry={e} color={color} />
          ))}
        </div>
      </Section>
    ),
  );
  push(
    1,
    <Section key="abilities" title="Faction abilities" count={model.abilities.length}>
      {model.abilities.map((a) => (
        <AbilityItem key={a.id} ability={a} />
      ))}
    </Section>,
  );
  push(
    1,
    model.leaders.length > 0 && (
      <Section key="leaders" title="Leaders" count={model.leaders.length}>
        {model.leaders.map((e) => (
          <LeaderItem key={e.leader.id} entry={e} />
        ))}
      </Section>
    ),
  );
  push(
    1,
    model.techs.length > 0 && (
      <Section key="techs" title="Faction technologies" count={model.techs.length}>
        {model.techs.map((e) => (
          <TechItem key={e.tech.alias} entry={e} model={model} />
        ))}
      </Section>
    ),
  );
  push(
    0,
    model.otherUnits.length > 0 && (
      <Section key="units" title="Other faction units" count={model.otherUnits.length} defaultOpen={!compact}>
        <div className={styles.unitGrid}>
          {model.otherUnits.map((e) => (
            <UnitEntryCard key={e.key} entry={e} color={color} />
          ))}
        </div>
      </Section>
    ),
  );
  push(
    1,
    model.promissoryNotes.length > 0 && (
      <Section key="pn" title="Promissory note" count={model.promissoryNotes.length} defaultOpen={!compact}>
        {model.promissoryNotes.map((pn) => (
          <PromissoryItem key={pn.alias} pn={pn} />
        ))}
      </Section>
    ),
  );
  push(
    1,
    model.breakthrough && (
      <Section key="bt" title="Breakthrough" defaultOpen={!compact}>
        <BreakthroughItem entry={model.breakthrough} />
      </Section>
    ),
  );
  push(
    0,
    <Section key="home" title="Home & setup" defaultOpen={!compact}>
      <HomeSetup model={model} />
    </Section>,
  );
  push(0, <Variants key="variants" model={model} color={color} />);
  return out;
}

type SectionProps = { title: string; count?: number; defaultOpen?: boolean; children: ReactNode };

function Section({ title, count, defaultOpen = true, children }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={styles.section}>
      <button type="button" className={styles.sectionHead} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={styles.sectionTitle}>{title}</span>
        {count !== undefined && count > 1 && <span className={styles.sectionCount}>{count}</span>}
        <IconChevronDown size={14} className={styles.sectionChevron} />
      </button>
      {open && <div className={styles.sectionBody}>{children}</div>}
    </section>
  );
}

function Header({ model }: { model: FactionSheetModel }) {
  const { info } = model;
  return (
    <header className={styles.header}>
      <img className={styles.headerIcon} src={cdnImage(`/factions/${info.alias}.png`)} alt="" />
      <div className={styles.headerText}>
        <h2 className={styles.factionName}>{model.name}</h2>
        <div className={styles.headerMeta}>
          <span>{model.sourceLabel}</span>
          {model.commodities !== undefined && (
            <span>
              Commodities <span className={styles.metaValue}>{model.commodities}</span>
            </span>
          )}
          {info.homeSystem && (
            <span>
              Home system <span className={styles.metaValue}>{info.homeSystem}</span>
            </span>
          )}
          {info.complexity && <span>{info.complexity} complexity</span>}
        </div>
      </div>
      {info.wikiURL && (
        <div className={styles.headerLinks}>
          <a className={styles.badge} href={info.wikiURL} target="_blank" rel="noreferrer">
            Wiki <IconExternalLink size={11} />
          </a>
        </div>
      )}
    </header>
  );
}

function UnitEntryCard({ entry, color, caption }: { entry: UnitEntry; color?: string; caption?: string }) {
  return (
    <UnitCard
      unit={entry.base}
      upgrade={entry.upgrade}
      upgradeTech={entry.upgradeTech}
      owned={entry.owned}
      color={color}
      caption={caption}
    />
  );
}

function AbilityItem({ ability }: { ability: FactionAbility | { id: string; name: string; missing: true } }) {
  if ("missing" in ability) {
    return (
      <div className={styles.entry}>
        <span className={styles.entryName}>{ability.name}</span>
      </div>
    );
  }
  return (
    <div className={styles.entry}>
      <div className={styles.entryHead}>
        <span className={styles.entryName}>{ability.name}</span>
      </div>
      {ability.permanentEffect && <p className={styles.text}>{ability.permanentEffect}</p>}
      {(ability.window || ability.windowEffect) && (
        <p className={styles.text}>
          {ability.window && <span className={styles.window}>{ability.window}: </span>}
          {ability.windowEffect}
        </p>
      )}
    </div>
  );
}

const LEADER_TYPE_LABEL: Record<string, string> = { agent: "Agent", commander: "Commander", hero: "Hero" };

function stateBadge(state: LeaderState, type: string) {
  if (state === "locked") return <span className={styles.badge}>Locked</span>;
  if (state === "purged") return <span className={`${styles.badge} ${styles.badgeGone}`}>Purged</span>;
  if (state === "exhausted") return <span className={`${styles.badge} ${styles.badgeWarn}`}>Exhausted</span>;
  if (state === "active") return <span className={`${styles.badge} ${styles.badgeGood}`}>Active</span>;
  return <span className={`${styles.badge} ${styles.badgeGood}`}>{type === "agent" ? "Ready" : "Unlocked"}</span>;
}

function LeaderItem({ entry }: { entry: LeaderEntry }) {
  const { leader, state } = entry;
  const showCondition = leader.unlockCondition && leader.type !== "agent" && state !== "purged";
  return (
    <div className={`${styles.entry} ${state === "purged" ? styles.dimmed : ""}`}>
      <div className={styles.entryHead}>
        <span className={styles.entryName}>{leader.name}</span>
        {leader.title && <span className={styles.entrySub}>{leader.title}</span>}
        <span className={styles.entryTag}>{LEADER_TYPE_LABEL[leader.type] ?? leader.type}</span>
        {state && stateBadge(state, leader.type)}
      </div>
      {leader.abilityName && <p className={styles.condition}>{leader.abilityName}</p>}
      <p className={styles.text}>
        {leader.abilityWindow && <span className={styles.window}>{leader.abilityWindow} </span>}
        {leader.abilityText}
      </p>
      {showCondition && (
        <p className={styles.condition}>
          <span className={styles.conditionLabel}>Unlock: </span>
          {leader.unlockCondition}
        </p>
      )}
    </div>
  );
}

function upgradedUnitName(tech: FactionTech, model: FactionSheetModel) {
  const all = [...model.headlineUnits, ...model.otherUnits];
  return all.find((e) => e.upgrade?.requiredTechId === tech.alias)?.base.name;
}

function TechItem({ entry, model }: { entry: TechEntry; model: FactionSheetModel }) {
  const { tech, owned, exhausted } = entry;
  const style = { "--tech-rgb": techRgb(tech.types) } as CSSProperties;
  const isUpgrade = tech.types.includes("UNITUPGRADE");
  const upgrades = isUpgrade ? upgradedUnitName(tech, model) : undefined;
  return (
    <div className={`${styles.entry} ${styles.techEntry}`} style={style}>
      <div className={styles.entryHead}>
        <span className={styles.techDot} />
        <span className={styles.entryName}>{tech.name}</span>
        <Prereqs requirements={tech.requirements} />
        <span className={styles.entryTag}>{techTypeLabel(tech.types)}</span>
        {owned && (
          <span className={`${styles.badge} ${exhausted ? styles.badgeWarn : styles.badgeGood}`}>
            {exhausted ? "Exhausted" : "Researched"}
          </span>
        )}
      </div>
      {upgrades ? (
        <p className={styles.condition}>Upgrades {upgrades}; stats under the unit card.</p>
      ) : (
        <p className={styles.text}>{tech.text}</p>
      )}
    </div>
  );
}

function PromissoryItem({ pn }: { pn: FactionPromissory }) {
  return (
    <div className={styles.entry}>
      <div className={styles.entryHead}>
        <span className={styles.entryName}>{pn.name}</span>
        {pn.playArea && <span className={styles.entryTag}>Play area</span>}
      </div>
      <p className={styles.text}>{pn.text}</p>
    </div>
  );
}

function BreakthroughItem({ entry }: { entry: BreakthroughEntry }) {
  const { breakthrough: bt, state } = entry;
  const badge =
    state === "locked" ? (
      <span className={styles.badge}>Locked</span>
    ) : state === "exhausted" ? (
      <span className={`${styles.badge} ${styles.badgeWarn}`}>Exhausted</span>
    ) : state === "unlocked" ? (
      <span className={`${styles.badge} ${styles.badgeGood}`}>Unlocked</span>
    ) : null;
  return (
    <div className={styles.entry}>
      <div className={styles.entryHead}>
        <span className={styles.entryName}>{bt.name}</span>
        {bt.synergy && bt.synergy.length > 0 && (
          <span className={styles.prereqs} title={`Synergy: ${techTypeLabel(bt.synergy)}`}>
            {bt.synergy.map((t) => (
              <span key={t} className={styles.prereq} style={{ ["--tech-rgb" as string]: TECH_RGB[t] }} />
            ))}
          </span>
        )}
        {bt.synergy && <span className={styles.entryTag}>{techTypeLabel(bt.synergy)} synergy</span>}
        {badge}
      </div>
      <p className={styles.text}>{bt.text}</p>
    </div>
  );
}

function HomeSetup({ model }: { model: FactionSheetModel }) {
  const { info } = model;
  const fleet = formatStartingFleet(info.startingFleet);
  const choices = model.startingTechChoices;
  return (
    <div className={styles.home}>
      {info.homeTileImage && (
        <img className={styles.homeTile} src={cdnImage(`/tiles/${info.homeTileImage}`)} alt="" loading="lazy" />
      )}
      <div className={styles.planetList}>
        {model.homePlanets.map((p) => (
          <div key={p.id} className={styles.planetRow}>
            <span className={styles.planetName}>{p.name}</span>
            <span className={styles.resInf} title="resources / influence">
              {p.resources}/{p.influence}
            </span>
          </div>
        ))}
        {model.startingTech.length > 0 && (
          <span className={styles.kv}>
            Starting tech <b>{model.startingTech.map((t) => t.name).join(", ")}</b>
          </span>
        )}
        {choices.length > 0 && (
          <span className={styles.kv}>
            Choose {info.startingTechAmount ?? 1} starting tech from <b>{choices.map((t) => t.name).join(", ")}</b>
          </span>
        )}
        {fleet && (
          <span className={styles.kv}>
            Starting units <b>{fleet}</b>
          </span>
        )}
      </div>
    </div>
  );
}

function Variants({ model, color }: { model: FactionSheetModel; color?: string }) {
  const count = model.variantUnits.length + model.altLeaders.length + model.altTechs.length;
  if (!count) return null;
  return (
    <Section title="Alternate versions" count={count} defaultOpen={false}>
      <span className={styles.empty}>
        Other printings the bot knows for this faction (Codex / Thunder&apos;s Edge replacements, breakthrough units).
      </span>
      {model.variantUnits.length > 0 && (
        <div className={styles.unitGrid}>
          {model.variantUnits.map((e) => (
            <UnitEntryCard key={e.key} entry={e} color={color} caption={variantCaption(e)} />
          ))}
        </div>
      )}
      {model.altLeaders.map((leader) => (
        <LeaderItem key={leader.id} entry={{ leader }} />
      ))}
      {model.altTechs.map((tech) => (
        <TechItem key={tech.alias} entry={{ tech }} model={model} />
      ))}
    </Section>
  );
}

function variantCaption(entry: UnitEntry) {
  const type = entry.base.baseType === "warsun" ? "war sun" : entry.base.baseType;
  return `${type} · ${sourceShort(entry.base.source)}`;
}

const sourceShort = (source: string) =>
  source === "thunders_edge" ? "Thunder's Edge" : source.startsWith("codex") ? "Codex" : source === "pok" ? "PoK" : source;
