import { baseId } from "../model/controls";
import { ChoiceButtons } from "../ui/ChoiceButtons";
import { Prose, ResourceStrip } from "../ui/parts";
import type { RendererProps } from "./types";
import classes from "./renderers.module.css";

/** Anything without a dedicated renderer: the bot's words, cleaned, and its choices ranked. */
export function GenericBody({ d, onPress, pendingKey, onHoverChoice }: RendererProps) {
  return (
    <div className={classes.stack}>
      <Prose text={d.text} clamp={7} />
      <ChoiceButtons
        choices={d.choices}
        onPress={onPress}
        pendingKey={pendingKey}
        channelId={d.prompt.channelId}
        onHover={onHoverChoice}
      />
    </div>
  );
}

/** A step of a tactical action: the system / unit choices the bot offers, with my fleet numbers. */
export function TacticalBody({ d, data, onPress, pendingKey, onHoverChoice }: RendererProps) {
  const choosingSystem = d.choices.some((c) => /^ringTile_/.test(baseId(c.customId)));
  return (
    <div className={classes.stack}>
      <ResourceStrip me={data.me} show={["tactic", "fleet", "strategy"]} />
      <Prose text={d.text} clamp={4} muted={choosingSystem} />
      {choosingSystem && <div className={classes.hint}>Hover a system to find it on the map.</div>}
      <ChoiceButtons
        choices={d.choices}
        onPress={onPress}
        pendingKey={pendingKey}
        channelId={d.prompt.channelId}
        onHover={onHoverChoice}
        gridAbove={4}
      />
    </div>
  );
}
