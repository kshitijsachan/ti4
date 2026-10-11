import { Loader, UnstyledButton } from "@mantine/core";
import cx from "clsx";
import { Markdown } from "@/discord";
import type { Decision, Option } from "./contract";
import type { EngineRendererProps } from "./registry";
import classes from "./GenericDecision.module.css";

const STYLE_CLASS: Record<string, string | undefined> = {
  success: classes.go,
  danger: classes.stop,
  primary: classes.primary,
};

/**
 * Any decision without its own renderer (all `legacy` ones): the engine's prompt and one button per option, as the
 * engine labels them.
 */
export function GenericDecision({ decision, answer, pendingOptionId }: EngineRendererProps<Decision>) {
  const busy = !!pendingOptionId;
  const options = decision.options as Option<unknown>[];
  return (
    <div className={classes.root}>
      {decision.prompt && <Markdown content={decision.prompt} className={classes.prompt} />}
      <div className={classes.options}>
        {options.map((o) => (
          <UnstyledButton
            key={o.id}
            className={cx(classes.option, STYLE_CLASS[o.style])}
            disabled={o.disabled || busy}
            data-pending={pendingOptionId === o.id || undefined}
            aria-busy={pendingOptionId === o.id}
            title={o.needsInput ? "Opens a form" : undefined}
            onClick={() => answer(o.id)}
          >
            {pendingOptionId === o.id && <Loader size={12} color="currentColor" />}
            <span>{o.label || o.emoji || "Choose"}</span>
          </UnstyledButton>
        ))}
      </div>
    </div>
  );
}
