import cx from "clsx";
import type { DraftPlayer, DraftSlice, DraftState } from "../types";
import type { PickAvailability } from "../model";
import { SliceHexCluster } from "./SliceHexCluster";
import { Glyph, ResInf, SkipGlyph, WormholeGlyph } from "./Glyphs";
import { PickButton } from "./PickButton";
import { PlayerTag } from "./PlayerTag";
import classes from "../Draft.module.css";

type Props = {
  draft: DraftState;
  slice: DraftSlice;
  availability: PickAvailability;
  focused: boolean;
  pending: boolean;
  botBase: string;
  owner?: DraftPlayer;
  ownerHomeImage?: string | null;
  onFocus: (pin: boolean) => void;
  onBlur: () => void;
  onPick: () => void;
};

export function SliceCard({
  draft,
  slice,
  availability,
  focused,
  pending,
  botBase,
  owner,
  ownerHomeImage,
  onFocus,
  onBlur,
  onPick,
}: Props) {
  const t = slice.totals;
  const template = draft.mapTemplate;
  const icons = draft.icons.glyphs;
  const taken = Boolean(slice.choice.pickedBy) && draft.status === "drafting";

  return (
    <article
      className={cx(
        classes.plate,
        classes.sliceCard,
        taken && classes.taken,
        focused && classes.focused,
      )}
      onMouseEnter={() => onFocus(false)}
      onMouseLeave={onBlur}
      onClick={() => onFocus(true)}
      data-slice={slice.name}
    >
      <header className={classes.rail}>
        <span className={classes.sliceLetter}>{slice.name}</span>
        <span className={classes.railLabel}>Slice</span>
        <span className={classes.railSpacer} />
        {owner ? (
          <PlayerTag player={owner} draft={draft} compact />
        ) : (
          <span className={classes.railMeta}>{t.planets} planets</span>
        )}
      </header>

      <div className={classes.sliceBody}>
        <SliceHexCluster
          tiles={slice.tiles}
          layout={template?.sliceLayout ?? []}
          tileWidth={template?.tileWidth ?? 345}
          tileHeight={template?.tileHeight ?? 300}
          botBase={botBase}
          homeImage={ownerHomeImage}
          homeLabel={slice.name}
          dimmed={taken}
        />
      </div>

      <div className={classes.trough}>
        <div className={classes.statBlock}>
          <span className={classes.statLabel}>Total</span>
          <ResInf resources={t.resources} influence={t.influence} size="lg" />
        </div>
        <div className={classes.statBlock}>
          <span className={classes.statLabel}>Optimal</span>
          <span className={classes.optimal}>
            <ResInf
              resources={t.optimalResources}
              influence={t.optimalInfluence}
            />
            {t.optimalFlex > 0 && (
              <span className={classes.flex}>+{t.optimalFlex}</span>
            )}
          </span>
        </div>
        <div className={cx(classes.statBlock, classes.statBlockEnd)}>
          <span className={classes.statLabel}>Value</span>
          <span className={classes.valueNum}>{t.optimalTotal}</span>
        </div>
      </div>

      <div className={classes.featureRow}>
        {t.techSkips.map((s, i) => (
          <SkipGlyph key={`s${i}`} skip={s} size={16} />
        ))}
        {t.wormholes.map((w, i) => (
          <WormholeGlyph key={`w${i}`} type={w} icons={icons} size={16} />
        ))}
        {Array.from({ length: t.legendaries }, (_, i) => (
          <Glyph
            key={`l${i}`}
            src={icons.legendary}
            alt="legendary planet"
            size={16}
          />
        ))}
        {t.techSkips.length + t.wormholes.length + t.legendaries === 0 && (
          <span className={classes.featureNone}>no skips · no wormholes</span>
        )}
        <span className={classes.railSpacer} />
        {t.anomalies > 0 && (
          <span className={classes.anomalyCount}>{t.anomalies}× anomaly</span>
        )}
      </div>

      {draft.status === "drafting" && (
        <PickButton
          label={`Pick slice ${slice.name}`}
          availability={availability}
          pending={pending}
          onPick={onPick}
        />
      )}
    </article>
  );
}
