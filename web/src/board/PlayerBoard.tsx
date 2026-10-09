import type { CSSProperties } from "react";
import { Tooltip, UnstyledButton } from "@mantine/core";
import cx from "clsx";
import { cdnImage } from "@/entities/data/cdnImage";
import type { LeaderState, PlayerSummary } from "./playerSummary";
import classes from "./PlayerBoard.module.css";

const TECH_ORDER = ["blue", "green", "red", "yellow"] as const;
const TECH_LABEL = { blue: "propulsion", green: "biotic", red: "warfare", yellow: "cybernetic" };
const LEADER_LABEL: Record<LeaderState, string> = {
  ready: "ready",
  exhausted: "exhausted",
  locked: "locked",
  gone: "purged",
};

/** Mantine palette name for a strategy card colour. */
export function scPalette(color: string) {
  return color === "purple" ? "violet" : color;
}

function StrategyChip({ card }: { card: PlayerSummary["strategyCards"][number] }) {
  return (
    <span
      className={cx(classes.sc, card.played && classes.scPlayed)}
      style={{ "--sc": `var(--mantine-color-${scPalette(card.color)}-6)` } as CSSProperties}
      title={`${card.initiative} ${card.name}${card.played ? " (played)" : " (not played yet)"}`}
    >
      <span className={classes.scNum}>{card.initiative}</span>
      <span className={classes.scName}>{card.name}</span>
    </span>
  );
}

function Stat({ icon, value, label, dim }: { icon?: string; value: string | number; label: string; dim?: boolean }) {
  return (
    <span className={cx(classes.stat, dim && classes.dim)} title={label}>
      {icon && <img src={icon} alt="" className={classes.statIcon} />}
      <span className={classes.num}>{value}</span>
    </span>
  );
}

function statusLabel(p: PlayerSummary, isMe: boolean) {
  if (p.eliminated) return "Eliminated";
  if (p.active) return isMe ? "Your turn" : "Their turn";
  if (p.passed) return "Passed";
  return null;
}

type Props = {
  player: PlayerSummary;
  vpsToWin: number;
  isMe: boolean;
  onOpen: () => void;
};

/** One player's seat at the table, at a glance. */
export function PlayerBoard({ player: p, vpsToWin, isMe, onOpen }: Props) {
  const status = statusLabel(p, isMe);
  const leaders = (["agent", "commander", "hero"] as const).map((type) => ({
    type,
    state: p.leaders[type],
  }));

  return (
    <UnstyledButton
      className={cx(
        classes.board,
        p.active && classes.active,
        p.passed && !p.active && classes.passed,
        isMe && classes.me,
      )}
      style={{ "--player": p.color } as CSSProperties}
      onClick={onOpen}
      aria-label={`${p.name} (${p.factionName}), ${p.vp} victory points. Open player details`}
    >
      <div className={classes.head}>
        {p.factionImage && <img src={p.factionImage} alt="" className={classes.faction} />}
        <div className={classes.who}>
          <div className={classes.factionName}>{p.factionName}</div>
          <div className={classes.name}>
            <span className={classes.nameText}>{p.name}</span>
            {isMe && <span className={classes.you}>you</span>}
            {status && <span className={cx(classes.status, p.active && classes.statusActive)}>{status}</span>}
          </div>
        </div>
        <div className={classes.vp} title={`${p.vp} of ${vpsToWin} victory points`}>
          <span className={classes.vpNum}>{p.vp}</span>
          <span className={classes.vpLabel}>VP</span>
        </div>
      </div>

      <div className={classes.facts}>
        {(p.strategyCards.length > 0 || p.speaker) && (
          <span className={classes.group}>
            {p.strategyCards.map((card) => (
              <StrategyChip key={card.initiative} card={card} />
            ))}
            {p.speaker && (
              <img
                src={cdnImage("/tokens/token_speaker.png")}
                alt="Speaker"
                title="Speaker"
                className={classes.speaker}
              />
            )}
          </span>
        )}
        <span className={classes.group}>
          <Stat icon="/tg.png" value={p.tg} label={`${p.tg} trade goods`} />
          <Stat
            icon="/comms.png"
            value={`${p.commodities}/${p.commoditiesMax}`}
            label={`${p.commodities} of ${p.commoditiesMax} commodities`}
          />
        </span>
        <span
          className={cx(classes.group, classes.cc)}
          title={`Command tokens: ${p.tactic} tactic, ${p.fleet} fleet, ${p.strategy} strategy`}
        >
          <span className={classes.ccLabel}>CC</span>
          <span className={classes.num}>
            {p.tactic}/{p.fleet}/{p.strategy}
          </span>
        </span>
        <span className={classes.group}>
          <span className={classes.stat} title={`${p.planets} planets`}>
            <span className={classes.planetDot} />
            <span className={classes.num}>{p.planets}</span>
          </span>
          <span className={classes.stat} title={`Resources: ${p.resources} ready of ${p.resourcesTotal}`}>
            <span className={cx(classes.econ, classes.res)}>R</span>
            <span className={classes.num}>
              {p.resources}/{p.resourcesTotal}
            </span>
          </span>
          <span className={classes.stat} title={`Influence: ${p.influence} ready of ${p.influenceTotal}`}>
            <span className={cx(classes.econ, classes.inf)}>I</span>
            <span className={classes.num}>
              {p.influence}/{p.influenceTotal}
            </span>
          </span>
        </span>
        <span className={cx(classes.group, classes.techs)}>
          {TECH_ORDER.map((color) => (
            <span
              key={color}
              className={cx(classes.tech, classes[color], !p.techs[color] && classes.dim)}
              title={`${p.techs[color]} ${TECH_LABEL[color]} tech`}
            >
              {p.techs[color]}
            </span>
          ))}
        </span>
        {(p.relics > 0 || p.fragments > 0) && (
          <span className={classes.group}>
            {p.relics > 0 && <Stat icon="/relicicon.webp" value={p.relics} label={`${p.relics} relics`} />}
            {p.fragments > 0 && (
              <Stat
                icon={cdnImage("/player_area/pa_fragment_crf.png")}
                value={p.fragments}
                label={`${p.fragments} relic fragments`}
              />
            )}
          </span>
        )}
        <span className={cx(classes.group, classes.leaders)}>
          {leaders.map(({ type, state }) => (
            <Tooltip key={type} label={`${type}: ${LEADER_LABEL[state]}`} withArrow openDelay={300}>
              <span className={cx(classes.leader, classes[`leader_${state}`])}>{type[0].toUpperCase()}</span>
            </Tooltip>
          ))}
        </span>
      </div>
    </UnstyledButton>
  );
}
