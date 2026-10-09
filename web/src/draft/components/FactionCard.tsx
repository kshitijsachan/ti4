import cx from "clsx";
import { getFactionImage } from "@/entities/lookup/factions";
import type { DraftFaction, DraftPlayer, DraftState } from "../types";
import type { PickAvailability } from "../model";
import { PickButton } from "./PickButton";
import { PlayerTag } from "./PlayerTag";
import { ResInf } from "./Glyphs";
import classes from "../Draft.module.css";

type Props = {
  draft: DraftState;
  faction: DraftFaction;
  availability: PickAvailability;
  focused: boolean;
  pending: boolean;
  owner?: DraftPlayer;
  onFocus: (pin: boolean) => void;
  onBlur: () => void;
  onPick: () => void;
};

export function factionIcon(faction: Pick<DraftFaction, "icon" | "alias">) {
  return faction.icon ?? getFactionImage(faction.alias);
}

const SOURCE_LABEL: Record<string, string> = {
  base: "Base",
  pok: "PoK",
  codex1: "Codex",
  codex2: "Codex",
  codex3: "Codex",
  codex4: "Codex",
  thunders_edge: "TE",
  ds: "DS",
};

export function showComplexity(c: string | null): c is string {
  return Boolean(c) && !/not added/i.test(c!);
}

export function FactionCard({
  draft,
  faction,
  availability,
  focused,
  pending,
  owner,
  onFocus,
  onBlur,
  onPick,
}: Props) {
  const taken = Boolean(faction.choice.pickedBy) && draft.status === "drafting";
  const homeRes = faction.homePlanets.reduce((n, p) => n + p.resources, 0);
  const homeInf = faction.homePlanets.reduce((n, p) => n + p.influence, 0);

  return (
    <article
      className={cx(
        classes.plate,
        classes.factionCard,
        taken && classes.taken,
        focused && classes.focused,
      )}
      onMouseEnter={() => onFocus(false)}
      onMouseLeave={onBlur}
      onClick={() => onFocus(true)}
      data-faction={faction.alias}
    >
      <div className={classes.factionHead}>
        <img
          className={classes.factionIcon}
          src={factionIcon(faction)}
          alt=""
          draggable={false}
        />
        <div className={classes.factionTitle}>
          <span className={classes.factionName}>{faction.name}</span>
          <span className={classes.factionMeta}>
            {faction.source && (
              <span className={classes.sourceTag}>
                {SOURCE_LABEL[faction.source] ?? faction.source}
              </span>
            )}
            {showComplexity(faction.complexity) && (
              <span>{faction.complexity}</span>
            )}
            <span>
              Comm <b className={classes.mono}>{faction.commodities}</b>
            </span>
            <span>
              Home <ResInf resources={homeRes} influence={homeInf} size="sm" />
            </span>
          </span>
        </div>
      </div>

      <div className={classes.factionBody}>
        <div className={classes.chipRow}>
          {faction.abilities.slice(0, 4).map((a) => (
            <span key={a} className={classes.abilityChip}>
              {a}
            </span>
          ))}
        </div>
        {faction.factionTech.length > 0 && (
          <div className={classes.factionTechLine}>
            <span className={classes.statLabel}>Tech</span>{" "}
            {faction.factionTech.join(" · ")}
          </div>
        )}
      </div>

      {owner ? (
        <div className={classes.takenFooter}>
          <span className={classes.statLabel}>Taken</span>
          <PlayerTag player={owner} draft={draft} compact />
        </div>
      ) : draft.status !== "drafting" ? null : (
        <PickButton
          label={`Pick ${faction.shortName}`}
          availability={availability}
          pending={pending}
          onPick={onPick}
          size="sm"
        />
      )}
    </article>
  );
}
