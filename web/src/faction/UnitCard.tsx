import { cdnImage } from "@/entities/data/cdnImage";
import { getColorAlias } from "@/entities/lookup/colors";
import { baseTypeLabel, unitKeywords, unitStats } from "./unitStats";
import { TECH_RGB } from "./techColors";
import type { FactionTech, FactionUnit } from "./types";
import styles from "./FactionSheet.module.css";

type StatsProps = { unit: FactionUnit; compareTo?: FactionUnit };

function Stats({ unit, compareTo }: StatsProps) {
  const stats = unitStats(unit);
  if (!stats.length) return null;
  const before = compareTo ? Object.fromEntries(unitStats(compareTo).map((s) => [s.label, s.value])) : undefined;
  return (
    <div className={styles.stats}>
      {stats.map((s) => (
        <div key={s.label} className={styles.stat}>
          <span className={styles.statLabel}>{s.label}</span>
          <span className={`${styles.statValue} ${before && before[s.label] !== s.value ? styles.statChanged : ""}`}>
            {s.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function Keywords({ unit }: { unit: FactionUnit }) {
  const keywords = unitKeywords(unit);
  if (!keywords.length) return null;
  return (
    <div className={styles.keywords}>
      {keywords.map((k) => (
        <span key={k.label} className={styles.keyword}>
          {k.label}
          {k.detail && <span className={styles.keywordDetail}>{k.detail}</span>}
        </span>
      ))}
    </div>
  );
}

function Prereqs({ requirements }: { requirements?: string }) {
  if (!requirements) return null;
  const letters = requirements.split("").filter((c) => TECH_RGB[c]);
  if (!letters.length) return null;
  return (
    <span className={styles.prereqs} title={`Requires ${requirements}`}>
      {letters.map((c, i) => (
        <span key={i} className={styles.prereq} style={{ ["--tech-rgb" as string]: TECH_RGB[c] }} />
      ))}
    </span>
  );
}

type UpgradeProps = { base: FactionUnit; upgrade: FactionUnit; tech?: FactionTech; owned?: boolean };

function Upgrade({ base, upgrade, tech, owned }: UpgradeProps) {
  const abilityChanged = upgrade.ability && upgrade.ability !== base.ability;
  return (
    <div className={styles.upgradeBox}>
      <div className={styles.upgradeHead}>
        <span className={styles.upgradeName}>{upgrade.name}</span>
        <span>{tech ? "upgrade tech" : "upgrade"}</span>
        <Prereqs requirements={tech?.requirements} />
        {owned && <span className={`${styles.badge} ${styles.badgeGood}`}>Researched</span>}
      </div>
      <Stats unit={upgrade} compareTo={base} />
      <Keywords unit={upgrade} />
      {abilityChanged && <p className={styles.unitAbility}>{upgrade.ability}</p>}
    </div>
  );
}

type Props = {
  unit: FactionUnit;
  upgrade?: FactionUnit;
  upgradeTech?: FactionTech;
  owned?: "base" | "upgraded";
  color?: string;
  /** Overrides the unit-type caption (e.g. "Alternate mech"). */
  caption?: string;
};

/** One unit card: art, printed stats, keyword abilities, ability text and (if any) its upgrade side. */
export function UnitCard({ unit, upgrade, upgradeTech, owned, color, caption }: Props) {
  const src = cdnImage(`/units/${getColorAlias(color)}_${unit.asyncId}.png`);
  return (
    <div className={styles.unitCard}>
      <div className={styles.unitTop}>
        <img className={styles.unitImage} src={src} alt="" loading="lazy" />
        <div className={styles.unitTitle}>
          <span className={styles.unitType}>{caption ?? baseTypeLabel(unit.baseType)}</span>
          <span className={styles.unitName}>{unit.name}</span>
        </div>
      </div>
      <Stats unit={unit} />
      <Keywords unit={unit} />
      {unit.ability && <p className={styles.unitAbility}>{unit.ability}</p>}
      {upgrade && <Upgrade base={unit} upgrade={upgrade} tech={upgradeTech} owned={owned === "upgraded"} />}
    </div>
  );
}

export { Prereqs };
