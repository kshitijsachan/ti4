import { Loader, UnstyledButton } from "@mantine/core";
import cx from "clsx";
import { cdnImage } from "@/entities/data/cdnImage";
import { getTileById } from "@/entities/lookup/systems";
import { baseId, type Choice } from "../model/controls";
import { ChoiceButton, ChoiceButtons } from "../ui/ChoiceButtons";
import { Prose } from "../ui/parts";
import { usePlay } from "@/discord";
import { cleanLabel } from "../model/controls";
import { getColorAlias } from "@/entities/lookup/colors";
import type { DecisionData, RendererProps } from "./types";
import classes from "./renderers.module.css";

/** Anything without a dedicated renderer: the bot's words, cleaned, and its choices ranked. */
export function GenericBody({ d, onPress, pendingKey, onHoverChoice }: RendererProps) {
  return (
    <div className={classes.stack}>
      <Prose text={d.text} clamp={3} />
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
const DONE = /^(concludeMove|doneLanding|doneWithOneSystem|doneWithTacticalAction|tacticalActionBuild|deleteButtons_tacticalAction)/;

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
              choice={{
                ...c,
                label: `${/_reverse$/.test(c.customId ?? "") ? "−" : "+"}${baseId(c.customId).match(UNIT_MOVE)?.[2] ?? ""}${/damaged/i.test(c.label) ? " damaged" : ""}`,
                style: /_reverse$/.test(c.customId ?? "") ? 104 : 2,
              }}
              onPress={onPress}
              pending={pendingKey === c.key}
              busy={!!pendingKey}
              compact
              ariaLabel={`${/_reverse$/.test(c.customId ?? "") ? "Take back" : "Move"} ${baseId(c.customId).match(UNIT_MOVE)?.[2] ?? ""} ${UNIT_NAMES[unit] ?? unit}${/damaged/i.test(c.label) ? " (damaged)" : ""}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** "moved 1 Carrier\nmoved 1 Fighter" → "1 Carrier, 1 Fighter". */
function movedSummary(text: string) {
  const parts = [...text.matchAll(/moved (\d+ [A-Za-z ]+?)(?= from\b| \(|\n|$|>)/g)].map((m) => m[1].trim());
  return parts.length ? parts.join(", ") : "nothing yet";
}

/** "Produce Dreadnought (4)" → "Dreadnought · 4 left"; "Produce 2 Infantry on Arc Prime (4/0)" → "2 Infantry on Arc Prime". */
function produceLabel(c: Choice): Choice {
  if (!/^Produce /.test(c.label)) return c;
  const left = c.label.match(/^Produce (.+?) \((\d+)\)$/);
  if (left) return { ...c, label: `${left[1]} · ${left[2]} left`, style: 2 };
  return { ...c, label: c.label.replace(/^Produce /, "").replace(/\s*\(\d+\/\d+\)$/, ""), style: 2 };
}

/**
 * What the explore just before this step found ("Gamma Wormhole: Place a gamma wormhole token…"): only on the first
 * prompt after it, not on later steps.
 */
function useExploreResult(channelId: string, promptId: string) {
  const data = usePlay((s) => s.messages[channelId]);
  if (!data) return undefined;
  for (let i = data.ids.length - 1; i >= 0; i--) {
    const m = data.byId[data.ids[i]];
    if (!m?.author.bot || m.id === promptId) continue;
    /* Another prompt between this step and the explore: the explore belongs to an earlier step. */
    if ((m.components ?? []).length) return undefined;
    if (/\bactivated \d+/.test(m.content)) return undefined;
    const embed = m.embeds?.[0];
    if (!/\bexplored\b/i.test(m.content) || !embed?.title) continue;
    const name = cleanLabel(embed.title).replace(/[_*]/g, "").trim();
    const what = cleanLabel(embed.description ?? "").replace(/[_*]/g, "").trim();
    return what ? `${name}: ${what}` : name;
  }
  return undefined;
}

/** A step of a tactical action: the system / unit choices the bot offers, with my fleet numbers. */
export function TacticalBody({ d, data, onPress, pendingKey, onHoverChoice }: RendererProps) {
  const systems = d.choices.filter((c) => SYSTEM.test(baseId(c.customId)));
  const done = d.choices.filter((c) => DONE.test(baseId(c.customId)) && !c.disabled);
  const unitMoves = d.choices.filter((c) => UNIT_MOVE.test(baseId(c.customId)));
  const movingFrom = systems.some((c) => /^tacticalMoveFrom_/.test(baseId(c.customId)));
  const active = d.position ? tileAt(data, d.position) : undefined;
  const explored = useExploreResult(d.prompt.channelId, d.id);
  /* BOMBARDMENT only matters when someone else has ground forces on a planet here. */
  const planets = d.position ? Object.values(data.web?.tileUnitData?.[d.position]?.planets ?? {}) : [];
  const enemyOnPlanets = planets.some((p) =>
    Object.entries(p?.entities ?? {}).some(([f, units]) => f !== data.me?.faction && units.some((u) => u.entityType === "unit")),
  );
  const rest = d.choices
    .filter((c) => !systems.includes(c) && !done.includes(c) && !unitMoves.includes(c))
    .map(produceLabel)
    .map((c) => (/^(ring_|ChooseDifferentDestination|getTilesThisFarAway_)/.test(baseId(c.customId)) ? { ...c, style: 2 } : c));
  const choosingSystem = !movingFrom && (systems.length > 0 || rest.some((c) => /^ring_/.test(baseId(c.customId))));
  let text = d.text;
  if (choosingSystem) text = "Not listed? Open the ring it is in (ring 1 surrounds Mecatol Rex).";
  const moved = movingFrom && /\bmoved\b/i.test(d.text) ? d.text.replace(/^\*\*Tactical Action in system[^\n]*\n*/i, "") : "";
  if (movingFrom) text = moved ? "" : "Pick where your ships come from.";
  if (unitMoves.length) text = d.text.match(/from system [^\n(]+/i)?.[0]?.trim() ?? "";
  if (d.title === "Finish the tactical action") text = "Nothing else to do in this system. Conclude the action to end it.";
  if (d.choices.some((c) => /^deleteButtons_tacticalAction/.test(baseId(c.customId)))) {
    const total = d.text.match(/Producing a total of (\d+) units? \(PRODUCTION limit is (\d+)\) for a total cost of (\d+) resources?/i);
    text = total
      ? `So far: ${total[1]} unit${total[1] === "1" ? "" : "s"} of ${total[2]}, costing ${total[3]} resources${data.me?.resources !== undefined ? ` (you have ${data.me.resources} ready)` : ""}. Press Done, then pay.`
      : "Each press adds a unit (your docks' production limits the total). Press Done, then pay for them.";
  }
  const build = d.choices.find((c) => /^tacticalActionBuild/.test(baseId(c.customId)));
  if (build && d.choices.some((c) => /^doneWithTacticalAction/.test(baseId(c.customId)))) {
    const value = build.label.match(/\((\d+) PRODUCTION/i)?.[1];
    text = `Produce units here${value ? ` (production ${value})` : ""}, or conclude the action.`;
  }
  return (
    <div className={classes.stack}>
      {active && d.position && !choosingSystem && (
        <div className={classes.destination}>
          <img src={cdnImage(`/tiles/${active.imagePath}`)} alt="" className={classes.hexSmall} />
          <span className={classes.systemName}>{active.name ?? "System"}</span>
          <span className={classes.systemPos}>{d.position}</span>
        </div>
      )}
      {moved && <p className={classes.hint}>Moving in: {movedSummary(moved)}</p>}
      {explored && !/^Explore /.test(d.title) && <p className={classes.cardText}>Explored — {explored}</p>}
      {d.title === "Land ground forces" && data.web?.gameState?.activeCombat && data.web.gameState.activeCombat.system === d.position && (
        <p className={cx(classes.hint, classes.warn)}>The space combat here is not over yet. Ground forces land once it is won.</p>
      )}
      {/distance exceeds move value/i.test(d.text) && (
        <p className={cx(classes.hint, classes.warn)}>Some of these ships do not have the move value to reach this system. Take them back or use an ability that allows it.</p>
      )}
      {text && <Prose text={text} clamp={4} muted={choosingSystem} />}
      {unitMoves.length > 0 && <UnitMoveRows choices={unitMoves} data={data} onPress={onPress} pendingKey={pendingKey} />}
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
        rankOf={(c) => {
          if (/^bombardConfirm/.test(baseId(c.customId)) && !enemyOnPlanets) return "more";
          return choosingSystem && c.rank === "primary" ? "secondary" : c.rank;
        }}
        trailing={done.map((c) => (
          <ChoiceButton key={c.key} choice={{ ...c, style: 3 }} onPress={onPress} pending={pendingKey === c.key} busy={!!pendingKey} emphasis />
        ))}
      />
    </div>
  );
}
