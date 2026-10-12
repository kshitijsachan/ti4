import { useState } from "react";
import { Loader, UnstyledButton } from "@mantine/core";
import cx from "clsx";
import { Markdown, usePlay } from "@/discord";
import { Emoji } from "@/discord/render/Emoji";
import type { Decision, Option } from "./contract";
import type { EngineRendererProps } from "./registry";
import { optionRole } from "./optionKinds";
import classes from "./GenericDecision.module.css";

const STYLE_CLASS: Record<string, string | undefined> = {
  success: classes.go,
  danger: classes.stop,
  primary: classes.primary,
};

/** Not mine to press: a menu mixing several players' options (`owner` set) only shows mine. */
function mine(o: Option<unknown>, me: string | undefined) {
  return !o.owner?.userId || !me || o.owner.userId === me;
}

function OptionEmoji({ emoji }: { emoji: string | null }) {
  if (!emoji) return null;
  if (/^\d{5,}$/.test(emoji)) return <Emoji id={emoji} name="emoji" size="button" />;
  if (/^\w+$/.test(emoji)) return null;
  return <span aria-hidden>{emoji}</span>;
}

/** Prompt text longer than this folds behind "Show more". */
const LONG_PROMPT = 420;

/**
 * Any decision without its own renderer (all `legacy` ones): the engine's prompt and its options as buttons, the
 * real choices first, then step-backs, with utilities under "More". Options locked to another player are hidden.
 */
export function GenericDecision({ decision, answer, pendingOptionId }: EngineRendererProps<Decision>) {
  const me = usePlay((s) => s.me?.id);
  const [showAll, setShowAll] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const busy = !!pendingOptionId;
  const options = (decision.options as Option<unknown>[]).filter((o) => mine(o, me));
  const back = options.filter((o) => optionRole(o) === "back");
  const utilities = options.filter((o) => optionRole(o) === "utility");
  const main = options.filter((o) => optionRole(o) === "main");
  const long = (decision.prompt?.length ?? 0) > LONG_PROMPT;

  const button = (o: Option<unknown>, quiet = false) => (
    <UnstyledButton
      key={o.id}
      className={cx(classes.option, !quiet && STYLE_CLASS[o.style], quiet && classes.quiet)}
      disabled={o.disabled || busy}
      data-pending={pendingOptionId === o.id || undefined}
      aria-busy={pendingOptionId === o.id}
      title={o.needsInput ? "Opens a form" : undefined}
      onClick={() => answer(o.id)}
    >
      {pendingOptionId === o.id ? <Loader size={12} color="currentColor" /> : <OptionEmoji emoji={o.emoji} />}
      {o.label && <span>{o.label}</span>}
      {!o.label && !o.emoji && <span>Choose</span>}
    </UnstyledButton>
  );

  return (
    <div className={classes.root}>
      {decision.prompt && (
        <div className={cx(classes.promptWrap, long && !showAll && classes.clipped)}>
          <Markdown content={decision.prompt} className={classes.prompt} />
        </div>
      )}
      {long && (
        <UnstyledButton className={classes.link} onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show less" : "Show more"}
        </UnstyledButton>
      )}
      {main.length > 0 && <div className={classes.options}>{main.map((o) => button(o))}</div>}
      {!main.length && !back.length && !utilities.length && <p className={classes.empty}>Nothing to choose here — it is someone else's.</p>}
      {back.length > 0 && <div className={classes.options}>{back.map((o) => button(o, true))}</div>}
      {utilities.length > 0 && (
        <>
          <UnstyledButton className={classes.link} onClick={() => setMoreOpen((v) => !v)} aria-expanded={moreOpen}>
            {moreOpen ? "Fewer options" : `More options (${utilities.length})`}
          </UnstyledButton>
          {moreOpen && <div className={classes.options}>{utilities.map((o) => button(o, true))}</div>}
        </>
      )}
    </div>
  );
}
