import { Loader, UnstyledButton } from "@mantine/core";
import { cdnImage } from "@/entities/data/cdnImage";
import { getTileById } from "@/entities/lookup/systems";
import { baseId, type Choice } from "../model/controls";
import { ChoiceButton, ChoiceButtons } from "../ui/ChoiceButtons";
import { Prose, ResourceStrip, Section } from "../ui/parts";
import { getColorAlias } from "@/entities/lookup/colors";
import type { DecisionData, RendererProps } from "./types";
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

const SYSTEM = /^(?:ringTile|tacticalMoveFrom)_(\w+)/;
const DONE = /^(concludeMove|doneLanding|doneWithOneSystem|doneWithTacticalAction|tacticalActionBuild)/;

/** Tile id at a ring position, from web-data's "pos:tileId" list. */
function tileAt(data: DecisionData, position: string) {
  const entry = data.web?.tilePositions.find((p) => p.startsWith(`${position}:`));
  return entry ? getTileById(entry.split(":")[1]) : undefined;
}

/** A system to activate: its hex art and name. */
function SystemTile({ c, data, onPress, pendingKey, onHoverChoice }: { c: Choice } & Omit<RendererProps, "d" | "pressOn">) {
  const position = baseId(c.customId).match(SYSTEM)?.[1] ?? "";
  const tile = tileAt(data, position);
  const name = c.label.replace(/^\w+\s*\(/, "").replace(/\)$/, "") || c.label;
  return (
    <UnstyledButton
      className={classes.systemTile}
      onClick={() => onPress(c)}
      onMouseEnter={() => onHoverChoice(c)}
      onMouseLeave={() => onHoverChoice(null)}
      onFocus={() => onHoverChoice(c)}
      onBlur={() => onHoverChoice(null)}
      disabled={!!pendingKey || c.disabled}
    >
      {tile?.imagePath ? (
        <img src={cdnImage(`/tiles/${tile.imagePath}`)} alt="" className={classes.hex} />
      ) : (
        <span className={classes.hexBlank} />
      )}
      <span className={classes.systemText}>
        <span className={classes.systemName}>{name}</span>
        <span className={classes.systemPos}>{position}</span>
      </span>
      {pendingKey === c.key && <Loader size={14} className={classes.tileSpinnerSmall} />}
    </UnstyledButton>
  );
}

const UNIT_MOVE = /^unitTacticalMove_(\w+?)_(\d+)_([a-z]{2})(?:_(\w+))?$/;
const UNIT_NAMES: Record<string, string> = {
  ws: "War Sun",
  fs: "Flagship",
  dn: "Dreadnought",
  ca: "Cruiser",
  cv: "Carrier",
  dd: "Destroyer",
  ff: "Fighter",
  mf: "Mech",
  gf: "Infantry",
  pd: "PDS",
  sd: "Space Dock",
};

/** "Move 1 Carrier" / "Move 2 Carrier" buttons, as one row per unit type with its art. */
function UnitMoveRows({ choices, data, onPress, pendingKey }: { choices: Choice[] } & Pick<RendererProps, "data" | "onPress" | "pendingKey">) {
  const rows = new Map<string, Choice[]>();
  for (const c of choices) {
    const unit = baseId(c.customId).match(UNIT_MOVE)?.[3] ?? "";
    rows.set(unit, [...(rows.get(unit) ?? []), c]);
  }
  const alias = getColorAlias(data.me?.color);
  return (
    <div className={classes.unitRows}>
      {[...rows.entries()].map(([unit, list]) => (
        <div key={unit} className={classes.unitMoveRow}>
          <img src={cdnImage(`/units/${alias}_${unit}.png`)} alt="" className={classes.unitMoveImg} />
          <span className={classes.unitMoveName}>{UNIT_NAMES[unit] ?? unit}</span>
          <span className={classes.grow} />
          {list.map((c) => (
            <ChoiceButton
              key={c.key}
              choice={{ ...c, label: `+${baseId(c.customId).match(UNIT_MOVE)?.[2] ?? ""}${/damaged/i.test(c.label) ? " damaged" : ""}`, style: 2 }}
              onPress={onPress}
              pending={pendingKey === c.key}
              busy={!!pendingKey}
              compact
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** A step of a tactical action: the system / unit choices the bot offers, with my fleet numbers. */
export function TacticalBody({ d, data, onPress, pendingKey, onHoverChoice }: RendererProps) {
  const systems = d.choices.filter((c) => SYSTEM.test(baseId(c.customId)));
  const done = d.choices.filter((c) => DONE.test(baseId(c.customId)) && !c.disabled);
  const unitMoves = d.choices.filter((c) => UNIT_MOVE.test(baseId(c.customId)));
  const movingFrom = systems.some((c) => /^tacticalMoveFrom_/.test(baseId(c.customId)));
  const active = d.position ? tileAt(data, d.position) : undefined;
  const rest = d.choices
    .filter((c) => !systems.includes(c) && !done.includes(c) && !unitMoves.includes(c))
    .map((c) => (/^(ring_|ChooseDifferentDestination|getTilesThisFarAway_)/.test(baseId(c.customId)) ? { ...c, style: 2 } : c));
  const choosingSystem = !movingFrom && (systems.length > 0 || rest.some((c) => /^ring_/.test(baseId(c.customId))));
  let text = d.text;
  if (choosingSystem) text = "Choose the system to activate. Not listed? Open the ring it sits in — ring 1 surrounds Mecatol Rex.";
  if (movingFrom) text = "Pick a system to move ships out of, choose the ships, then press Done moving.";
  return (
    <div className={classes.stack}>
      <ResourceStrip me={data.me} show={["tactic", "fleet", "strategy"]} />
      {active && d.position && !choosingSystem && (
        <div className={classes.destination}>
          <img src={cdnImage(`/tiles/${active.imagePath}`)} alt="" className={classes.hexLarge} />
          <span className={classes.systemText}>
            <span className={classes.sectionCaps}>Active system</span>
            <span className={classes.systemName}>{active.name ?? "System"}</span>
            <span className={classes.systemPos}>{d.position}</span>
          </span>
        </div>
      )}
      <Prose text={text} clamp={4} muted={choosingSystem} />
      {unitMoves.length > 0 && (
        <Section label="Ships and forces to move">
          <UnitMoveRows choices={unitMoves} data={data} onPress={onPress} pendingKey={pendingKey} />
        </Section>
      )}
      {systems.length > 0 && (
        <div className={classes.systemGrid}>
          {systems.map((c) => (
            <SystemTile key={c.key} c={c} data={data} onPress={onPress} pendingKey={pendingKey} onHoverChoice={onHoverChoice} />
          ))}
        </div>
      )}
      <ChoiceButtons
        choices={rest}
        onPress={onPress}
        pendingKey={pendingKey}
        channelId={d.prompt.channelId}
        onHover={onHoverChoice}
        gridAbove={4}
        rankOf={(c) => (choosingSystem && c.rank === "primary" ? "secondary" : c.rank)}
        trailing={done.map((c) => (
          <ChoiceButton key={c.key} choice={{ ...c, style: 3 }} onPress={onPress} pending={pendingKey === c.key} busy={!!pendingKey} emphasis />
        ))}
      />
    </div>
  );
}
