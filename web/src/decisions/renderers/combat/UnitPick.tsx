import type { Message } from "@/discord";
import type { PlayerData } from "@/entities/data/types";
import { lookupUnit } from "@/entities/lookup/units";
import { getPlanetData } from "@/entities/lookup/planets";
import type { Decision } from "../../model/classify";
import { baseId, choicesOf } from "../../model/controls";
import { ChoiceButtons } from "../../ui/ChoiceButtons";
import type { RendererProps } from "../types";
import { HitPanel } from "./HitPanel";
import { useRunFlow, doneOf } from "./run";
import { picksOf, pressesFor, rowsFromPicks, rowsFromTile, suggestPlan, unitName, type PickButton, type UnitRowModel } from "./units";

const SHIPS = new Set(["ws", "fs", "dn", "ca", "cv", "dd", "ff"]);
const CARRIED = new Set(["ff", "gf", "mf"]);
import classes from "./combat.module.css";

const OPENER = /^getDamageButtons_(\d+|[a-z]{2})_remove$/;

function mine(p: PickButton, faction?: string) {
  return !p.prefix || p.prefix.includes(`_${faction}_`);
}

/**
 * A prompt that takes units off the board outside combat: the bot's per-unit "Remove 1 Fighter" ladder (gravity rift
 * losses, action cards, explores), or its "Remove Units in 308" opener after a fleet pool / capacity overflow.
 */
export function isUnitPick(d: Decision, faction?: string) {
  if (d.choices.some((c) => OPENER.test(baseId(c.customId)))) return true;
  return picksOf(d.choices).some((p) => mine(p, faction));
}

/**
 * What overflows now, from the live map (the bot's numbers are from when it posted): fleet pool (non-fighter ships
 * beyond the fleet tokens) and capacity (fighters and ground forces in space beyond what the ships carry).
 */
function overflow(text: string, rows: UnitRowModel[], me: PlayerData | undefined) {
  const notes: string[] = [];
  let minimum = 0;
  const space = rows.filter((r) => r.holder === "space");
  if (/fleet pool/i.test(text) && me) {
    const ships = space.filter((r) => SHIPS.has(r.unit) && r.unit !== "ff").reduce((n, r) => n + r.count, 0);
    const over = ships - me.fleetCC;
    if (over > 0) notes.push(`Fleet pool: ${ships} non-fighter ships, ${me.fleetCC} fleet tokens — remove ${over} ship${over === 1 ? "" : "s"}.`);
    minimum += Math.max(0, over);
  }
  if (/capacity/i.test(text) && me) {
    const room = space.reduce((n, r) => n + r.count * (lookupUnit(r.unit, me.faction, me)?.capacityValue ?? 0), 0);
    const carried = space.filter((r) => CARRIED.has(r.unit)).reduce((n, r) => n + r.count, 0);
    const over = carried - room;
    if (over > 0) notes.push(`Capacity: ${carried} fighters and ground forces in space, room for ${room} — remove ${over}.`);
    minimum += Math.max(0, over);
  }
  const settled = !notes.length && /fleet pool|capacity/i.test(text);
  return { note: notes.join(" "), minimum: minimum || undefined, settled };
}

export function UnitPickBody({ d, data, pressOn, pendingKey, onHoverChoice }: RendererProps) {
  const runFlow = useRunFlow();
  const me = data.me;
  const opener = d.choices.find((c) => OPENER.test(baseId(c.customId)));
  const pos = opener ? baseId(opener.customId).match(OPENER)?.[1] : picksOf(d.choices)[0]?.pos;
  const tile = pos ? data.web?.tileUnitData?.[pos] : undefined;
  const picks = picksOf(d.choices).filter((p) => mine(p, me?.faction));
  const sustain = picks.some((p) => p.action === "assignDamage");
  const rows = opener ? rowsFromTile(tile, me, "any") : rowsFromPicks(picks, tile, me);
  const names = Object.fromEntries(rows.filter((r) => r.holder !== "space").map((r) => [r.holder, getPlanetData(r.holder)?.name ?? r.holder]));
  const { note, minimum, settled } = overflow(d.text, rows, me);
  /* Already fixed (units moved, landed or were destroyed since): nothing to choose, just clear it. */
  const empty = !rows.length || settled;
  const runKey = `remove:${d.id}`;
  const template: PickButton[] =
    picks.length ? picks : me && pos ? [{ choice: d.choices[0], action: "assignHits", pos, unit: "ff", holder: "space", color: me.color, prefix: `FFCC_${me.faction}_` }] : [];
  const rest = d.choices.filter((c) => c !== opener && !picks.some((p) => p.choice === c) && baseId(c.customId) !== "deleteButtons" && !/^assignHits_\w+_All/.test(baseId(c.customId)));
  const dismiss = d.choices.find((c) => baseId(c.customId) === "deleteButtons");

  return (
    <div className={classes.stack}>
      {empty && <p className={classes.status}>{rows.length ? "Nothing overflows any more: your fleet pool and capacity are fine now." : "None of your units are there any more: nothing to remove."}</p>}
      {!empty && <HitPanel
        key={d.id}
        rows={rows}
        color={me?.color}
        mode={sustain ? "combat" : "remove"}
        initial={suggestPlan(rows, 0, false)}
        holderNames={names}
        heading={sustain ? "Sustain or destroy units" : "Remove units"}
        note={note}
        minimum={minimum}
        runKey={runKey}
        onConfirm={(plan) => {
          const ids = pressesFor(plan, rows, template).map((customId) => ({ customId, label: labelOf(customId) }));
          if (opener?.customId) {
            void runFlow({
              key: runKey,
              opener: { channelId: d.prompt.channelId, messageId: d.id, customId: opener.customId, label: "Opening the unit buttons" },
              isFollowUp: (m: Message) => !!m.author?.bot && picksOf(choicesOf(m)).length > 0,
              ids,
              finish: doneOf,
            });
            return;
          }
          void runFlow({ key: runKey, target: { channelId: d.prompt.channelId, messageId: d.id }, ids, finish: doneOf });
        }}
      />}
      {(rest.length > 0 || dismiss) && (
        <ChoiceButtons
          choices={[...rest, ...(dismiss ? [{ ...dismiss, label: empty ? "Dismiss" : opener ? "Dismiss (fix it later)" : "Done", rank: empty ? ("primary" as const) : ("more" as const) }] : [])].map((c) => ({ ...c, rank: c.rank === "undo" || c.rank === "primary" ? c.rank : ("more" as const) }))}
          onPress={pressOn(d)}
          pendingKey={pendingKey}
          channelId={d.prompt.channelId}
          rankOf={(c) => (c.rank === "undo" || c.rank === "primary" ? c.rank : "more")}
          onHover={onHoverChoice}
        />
      )}
    </div>
  );
}

function labelOf(customId: string) {
  const m = baseId(customId).match(/^(assignHits|assignDamage)_[^_]+_\d+_([a-z]{2})/);
  if (!m) return "Pressing";
  return `${m[1] === "assignDamage" ? "Sustaining" : "Removing"} 1 ${unitName(m[2])}`;
}
