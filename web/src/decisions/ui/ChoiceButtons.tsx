import { useState, type ReactNode } from "react";
import { Loader, UnstyledButton } from "@mantine/core";
import { IconChevronDown, IconChevronUp, IconArrowBackUp, IconExternalLink } from "@tabler/icons-react";
import cx from "clsx";
import { SelectControl } from "@/discord/render/SelectControl";
import type { Choice, ChoiceRank } from "../model/controls";
import classes from "./ChoiceButtons.module.css";

export type PressFn = (choice: Choice, values?: string[]) => void;

type Props = {
  choices: Choice[];
  onPress: PressFn;
  pendingKey: string | null;
  channelId: string;
  /** Re-rank choices for this decision type (e.g. make "Pass" primary). */
  rankOf?: (c: Choice) => ChoiceRank;
  /** Optional hover hook (map highlight of system choices). */
  onHover?: (c: Choice | null) => void;
  /** More than this many main choices are laid out as a compact grid. */
  gridAbove?: number;
  /** Rendered after the main choices, above "More options" / Undo (a Done button). */
  trailing?: ReactNode;
};

/**
 * The bot colours buttons freely; here only "go" (green) keeps its colour so the popup stays quiet.
 * Renderers pass style 104 for a deliberately red choice (taking a unit back).
 */
const STYLE_CLASS: Record<number, string> = {
  1: classes.neutral,
  2: classes.neutral,
  3: classes.green,
  4: classes.neutral,
  104: classes.red,
};

export function ChoiceButton({
  choice,
  onPress,
  pending,
  busy,
  compact,
  emphasis,
  onHover,
  ariaLabel,
}: {
  choice: Choice;
  /** Spoken name when the visible label is terse ("+1"). */
  ariaLabel?: string;
  onPress: PressFn;
  pending: boolean;
  busy: boolean;
  compact?: boolean;
  emphasis?: boolean;
  onHover?: (c: Choice | null) => void;
}) {
  return (
    <UnstyledButton
      className={cx(
        classes.choice,
        STYLE_CLASS[choice.style] ?? classes.neutral,
        compact && classes.compact,
        emphasis && classes.emphasis,
      )}
      disabled={choice.disabled || busy}
      data-pending={pending || undefined}
      aria-busy={pending}
      aria-label={ariaLabel}
      onClick={() => onPress(choice)}
      onMouseEnter={() => onHover?.(choice)}
      onMouseLeave={() => onHover?.(null)}
      onFocus={() => onHover?.(choice)}
      onBlur={() => onHover?.(null)}
    >
      {pending && <Loader size={14} color="currentColor" className={classes.spinner} />}
      <span className={classes.label}>{choice.label || choice.emojiName || "Choose"}</span>
    </UnstyledButton>
  );
}

/** A select whose few options read better as buttons; long or multi selects keep the combobox. */
function SelectChoice({
  choice,
  onPress,
  pending,
  busy,
  channelId,
}: {
  choice: Choice;
  onPress: PressFn;
  pending: boolean;
  busy: boolean;
  channelId: string;
}) {
  const c = choice.component;
  const [value, setValue] = useState<string[]>([]);
  const options = c.options ?? [];
  const single = (c.max_values ?? 1) <= 1;
  if (c.type === 3 && single && options.length > 0 && options.length <= 8) {
    return (
      <div className={classes.selectGroup}>
        <div className={classes.selectLabel}>{choice.label}</div>
        <div className={classes.grid}>
          {options.map((o) => (
            <UnstyledButton
              key={o.value}
              className={cx(classes.choice, classes.neutral, classes.compact)}
              disabled={busy}
              onClick={() => onPress(choice, [o.value])}
              title={o.description}
            >
              <span className={classes.label}>{o.label}</span>
            </UnstyledButton>
          ))}
        </div>
        {pending && <Loader size={14} className={classes.selectSpinner} />}
      </div>
    );
  }
  return (
    <div className={classes.selectGroup}>
      <SelectControl
        component={c}
        channelId={channelId}
        value={value}
        onChange={setValue}
        pending={pending}
        disabled={busy}
        onCommit={(values) => onPress(choice, values)}
      />
    </div>
  );
}

function renderChoice(
  choice: Choice,
  props: Props,
  opts: { compact?: boolean; emphasis?: boolean },
) {
  const pending = props.pendingKey === choice.key;
  const busy = !!props.pendingKey;
  if (choice.kind === "select") {
    return (
      <SelectChoice
        key={choice.key}
        choice={choice}
        onPress={props.onPress}
        pending={pending}
        busy={busy}
        channelId={props.channelId}
      />
    );
  }
  if (choice.kind === "link") {
    return (
      <a key={choice.key} className={classes.moreLink} href={choice.url} target="_blank" rel="noreferrer noopener">
        {choice.label} <IconExternalLink size={11} />
      </a>
    );
  }
  return (
    <ChoiceButton
      key={choice.key}
      choice={choice}
      onPress={props.onPress}
      pending={pending}
      busy={busy}
      compact={opts.compact}
      emphasis={opts.emphasis}
      onHover={props.onHover}
    />
  );
}

/**
 * A decision's choices, ranked: the answers as large buttons (a compact grid when there are many),
 * utilities under "More options", take-backs as a small Undo link.
 */
export function ChoiceButtons(props: Props) {
  const { choices, rankOf, gridAbove = 6 } = props;
  const [showMore, setShowMore] = useState(false);
  const ranked = choices.map((c) => ({ c, rank: rankOf?.(c) ?? c.rank }));
  const primary = ranked.filter((r) => r.rank === "primary").map((r) => r.c);
  const secondary = ranked.filter((r) => r.rank === "secondary").map((r) => r.c);
  const more = ranked.filter((r) => r.rank === "more").map((r) => r.c);
  const undo = ranked.filter((r) => r.rank === "undo").map((r) => r.c);
  const main = [...primary, ...secondary];
  const many = main.filter((c) => c.kind === "button").length > gridAbove;
  const lead = !many && primary.length === 1 && main.length > 2 ? primary[0] : null;

  return (
    <div className={classes.root}>
      {main.length > 0 && (
        <div className={cx(classes.main, many && classes.grid)}>
          {main.map((c) => renderChoice(c, props, { compact: many, emphasis: c === lead }))}
        </div>
      )}
      {props.trailing}
      {(more.length > 0 || undo.length > 0) && (
        <div className={classes.footer}>
          {more.length > 0 && (
            <UnstyledButton className={classes.moreToggle} onClick={() => setShowMore((v) => !v)} aria-expanded={showMore}>
              {showMore ? <IconChevronUp size={13} /> : <IconChevronDown size={13} />}
              More options <span className={classes.count}>{more.length}</span>
            </UnstyledButton>
          )}
          <span className={classes.grow} />
          {undo.map((c) => (
            <UnstyledButton
              key={c.key}
              className={classes.undo}
              disabled={!!props.pendingKey || c.disabled}
              onClick={() => props.onPress(c)}
              title={c.label}
            >
              {props.pendingKey === c.key ? <Loader size={10} color="currentColor" /> : <IconArrowBackUp size={12} />}
              {/^undo$/i.test(c.label) ? "Undo" : c.label}
            </UnstyledButton>
          ))}
        </div>
      )}
      {showMore && more.length > 0 && (
        <div className={cx(classes.grid, classes.moreGrid)}>
          {more.map((c) => renderChoice(c, props, { compact: true }))}
        </div>
      )}
    </div>
  );
}
