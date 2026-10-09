import type { CSSProperties, ReactNode } from "react";
import cx from "clsx";
import { cdnImage } from "@/entities/data/cdnImage";
import type { LeaderState, PlayerSummary } from "./playerSummary";
import classes from "./PlayerBoard.module.css";

const TECH_ORDER = ["blue", "green", "red", "yellow"] as const;
const TECH_LABEL = { blue: "Propulsion", green: "Biotic", red: "Warfare", yellow: "Cybernetic" };
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

type Card = PlayerSummary["strategyCards"][number];

function scStyle(card: Card) {
  return { "--sc": `var(--mantine-color-${scPalette(card.color)}-6)` } as CSSProperties;
}

/** A strategy card as a small numbered tile; face down (outlined, grey) once played. */
function ScTile({ card }: { card: Card }) {
  return (
    <span
      className={cx(classes.scTile, card.played && classes.scPlayed)}
      style={scStyle(card)}
      aria-label={`${card.initiative} ${card.name}${card.played ? ", played" : ""}`}
    >
      {card.initiative}
    </span>
  );
}

function statusLabel(p: PlayerSummary, isMe: boolean) {
  if (p.eliminated) return "Eliminated";
  if (p.active) return isMe ? "Your turn" : "Taking a turn";
  if (p.passed) return "Passed";
  return null;
}

type SeatProps = {
  player: PlayerSummary;
  vpsToWin: number;
  isMe: boolean;
};

/**
 * One seat at rest: faction, who plays it, strategy cards and victory points on one line. Whose turn it is
 * shows as a lit seat; a passed seat fades back. Everything else lives in the seat's hover card.
 */
export function PlayerSeat({ player: p, vpsToWin, isMe }: SeatProps) {
  let sub = isMe ? "You" : p.name;
  if (p.passed && !p.active) sub = isMe ? "You · passed" : "Passed";
  if (p.eliminated) sub = "Eliminated";
  return (
    <span
      className={cx(
        classes.seat,
        p.active && classes.active,
        (p.passed || p.eliminated) && !p.active && classes.passed,
        isMe && classes.me,
      )}
      style={{ "--player": p.color } as CSSProperties}
    >
      {p.factionImage ? (
        <img src={p.factionImage} alt="" className={classes.icon} />
      ) : (
        <span className={classes.iconBlank} />
      )}
      <span className={classes.who}>
        <span className={classes.faction}>{p.factionName}</span>
        <span className={classes.sub}>
          <span className={classes.colorDot} />
          <span className={classes.subText}>{sub}</span>
        </span>
      </span>
      {p.strategyCards.length > 0 && (
        <span className={classes.scs}>
          {p.strategyCards.map((card) => (
            <ScTile key={card.initiative} card={card} />
          ))}
        </span>
      )}
      <span className={classes.vp} aria-label={`${p.vp} of ${vpsToWin} victory points`}>
        <span className={classes.vpNum}>{p.vp}</span>
        <span className={classes.vpLabel}>VP</span>
      </span>
    </span>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={classes.row}>
      <span className={classes.rowLabel}>{label}</span>
      <span className={classes.rowValue}>{children}</span>
    </div>
  );
}

function N({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span className={classes.num} title={title}>
      {children}
    </span>
  );
}

type StatsProps = SeatProps & {
  /** Shown as the card's footer hint, e.g. "Click for the full player area". */
  hint?: ReactNode;
};

/** Everything about a seat at a glance: the hover card behind a seat in the rail. */
export function PlayerStats({ player: p, vpsToWin, isMe, hint }: StatsProps) {
  const status = statusLabel(p, isMe);
  return (
    <div className={classes.stats} style={{ "--player": p.color } as CSSProperties}>
      <div className={classes.statsHead}>
        {p.factionImage && <img src={p.factionImage} alt="" className={classes.statsIcon} />}
        <div className={classes.statsWho}>
          <div className={classes.statsFaction}>{p.factionName}</div>
          <div className={classes.statsName}>
            <span className={classes.colorDot} />
            {p.name}
            {isMe && " (you)"}
            {status && <span className={classes.statsStatus}> · {status}</span>}
          </div>
        </div>
        <div className={classes.statsVp}>
          <span className={classes.vpNum}>{p.vp}</span>
          <span className={classes.statsVpOf}>/ {vpsToWin} VP</span>
        </div>
      </div>

      <div className={classes.rows}>
        {(p.strategyCards.length > 0 || p.speaker) && (
          <Row label="Strategy">
            {p.strategyCards.map((card) => (
              <span key={card.initiative} className={classes.scFull}>
                <ScTile card={card} />
                <span className={cx(classes.scName, card.played && classes.scNamePlayed)}>
                  {card.name}
                  {card.played && " (played)"}
                </span>
              </span>
            ))}
            {p.speaker && (
              <span className={classes.speaker}>
                <img src={cdnImage("/tokens/token_speaker.png")} alt="" className={classes.speakerImg} />
                Speaker
              </span>
            )}
          </Row>
        )}
        <Row label="Trade">
          <img src="/tg.png" alt="" className={classes.rowIcon} />
          <N>{p.tg}</N>
          <span className={classes.unit}>TG</span>
          <img src="/comms.png" alt="" className={classes.rowIcon} />
          <N>
            {p.commodities}/{p.commoditiesMax}
          </N>
          <span className={classes.unit}>comms</span>
        </Row>
        <Row label="Tokens">
          <N title="Tactic / fleet / strategy">
            {p.tactic} / {p.fleet} / {p.strategy}
          </N>
          <span className={classes.unit}>tactic · fleet · strategy</span>
        </Row>
        <Row label="Planets">
          <N>{p.planets}</N>
          <span className={cx(classes.econ, classes.res)}>R</span>
          <N title="Ready of total resources">
            {p.resources}/{p.resourcesTotal}
          </N>
          <span className={cx(classes.econ, classes.inf)}>I</span>
          <N title="Ready of total influence">
            {p.influence}/{p.influenceTotal}
          </N>
        </Row>
        <Row label="Tech">
          {TECH_ORDER.map((color) => (
            <span
              key={color}
              className={cx(classes.tech, classes[color], !p.techs[color] && classes.dim)}
              title={`${p.techs[color]} ${TECH_LABEL[color]}`}
            >
              {p.techs[color]}
            </span>
          ))}
          {p.techs.unit > 0 && <span className={classes.unit}>+{p.techs.unit} unit upgrades</span>}
        </Row>
        <Row label="Leaders">
          {(["agent", "commander", "hero"] as const).map((type) => (
            <span key={type} className={cx(classes.leader, classes[`leader_${p.leaders[type]}`])}>
              {type[0].toUpperCase()}
              <span className={classes.leaderState}>{LEADER_LABEL[p.leaders[type]]}</span>
            </span>
          ))}
        </Row>
        <Row label="Cards">
          <N>{p.actionCards}</N>
          <span className={classes.unit}>action</span>
          <N>{p.secrets}</N>
          <span className={classes.unit}>secret</span>
          <N>{p.promissory}</N>
          <span className={classes.unit}>promissory</span>
        </Row>
        {(p.relics > 0 || p.fragments > 0) && (
          <Row label="Relics">
            {p.relics > 0 && (
              <>
                <N>{p.relics}</N>
                <span className={classes.unit}>relics</span>
              </>
            )}
            {p.fragments > 0 && (
              <>
                <N>{p.fragments}</N>
                <span className={classes.unit}>fragments</span>
              </>
            )}
          </Row>
        )}
      </div>
      {hint && <div className={classes.hint}>{hint}</div>}
    </div>
  );
}
