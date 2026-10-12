import { Button } from "@mantine/core";
import cx from "clsx";
import type { CombatRoll, CombatRollValue, CombatRound, CombatState } from "../../../../../shim/src/engine/kinds/combat";
import type { Option } from "../../../../../shim/src/engine/types";
import { holderName, live, me, playerName, ROLL_NAMES, unitLabel, type RendererProps } from "./types";
import classes from "./combat.module.css";

const ACTION_LABEL: Record<string, string> = {
  decline_space_cannon: "Decline space cannon",
  assign_manual: "Assign hits by hand",
  announce_retreat: "Announce a retreat",
  retreat: "Retreat",
  ready_for_dice: "Ready for dice",
  action_cards: "Combat action cards",
  repair: "Repair damage",
  automate: "Automate combat",
  temp_mod: "Use Supercharge (+1 next roll)",
};

const str = (v: unknown, fallback: string) => (typeof v === "string" ? v : fallback);

/** One roll as dice faces, hits marked. */
export function Dice({ roll }: { roll: CombatRoll }) {
  return (
    <span className={classes.dice} title={ROLL_NAMES[roll.rollType]}>
      {roll.dice.flatMap((g, gi) =>
        g.results.map((r, i) => (
          <span key={`${gi}-${i}`} className={cx(classes.die, r >= g.threshold && classes.hit)} title={`${g.unit}: hits on ${g.threshold}`}>
            {r}
          </span>
        )),
      )}
      <span className={classes.mono}>
        {" → "}
        {roll.hits} hit{roll.hits === 1 ? "" : "s"}
      </span>
    </span>
  );
}

function lastRoll(combat: CombatState, faction: string, holder: string, rollType: string) {
  return [...combat.rolls].reverse().find((r) => r.faction === faction && r.tile === combat.tile && r.holder === holder && r.rollType === rollType);
}

function Sides({ combat, holder, rollType, state }: { combat: CombatState; holder: string; rollType: string; state: RendererProps<CombatRound>["state"] }) {
  const front = combat.fronts.find((f) => f.holder === holder);
  if (!front) return null;
  return (
    <div className={classes.sides}>
      {front.sides.map((s) => {
        const roll = lastRoll(combat, s.faction, holder, rollType);
        return (
          <div key={s.faction} className={classes.side}>
            <span className={classes.sideName}>
              {playerName(state, s.faction)} <span className={cx(classes.sub, classes.mono)}>R{s.roundsRolled}</span>
            </span>
            <span className={classes.units}>
              {s.units.length ? (
                s.units.map((u) => (
                  <span key={u.unit} className={cx(classes.unit, u.damaged > 0 && classes.unitDamaged)}>
                    {unitLabel(u)}
                  </span>
                ))
              ) : (
                <span className={classes.note}>no units left</span>
              )}
            </span>
            {roll ? <Dice roll={roll} /> : <span className={classes.note}>—</span>}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The combat controls: both sides' units, the latest dice, whose roll it is (from the engine's roll window), the
 * roll button when it is mine, and the other combat actions (retreat, action-card window, manual hits...).
 */
export function CombatRoundPanel({ decision: d, state, answer }: RendererProps<CombatRound>) {
  const self = me(state);
  const combat = state?.combat ?? null;
  const w = d.window;
  const rollType = str(w?.subject.rollType, "combat");
  const holder = str(w?.subject.holder, "space");
  const mine = !!self && !!w && w.eligible.includes(self.userId) && !w.responded.includes(self.userId);
  const waitingOn = w ? w.eligible.filter((u) => !w.responded.includes(u) && u !== self?.userId) : [];
  const options = d.options.filter(live).filter((o) => !o.id.includes("dummyPlayerSpoof"));
  const rolls = options.filter((o): o is Option<CombatRollValue> => o.value?.action === "roll");
  // A temporary modifier (Supercharge) belongs to its owner and may be used whoever rolls next.
  const others = options.filter((o) => o.value?.action !== "roll" && (o.value?.action !== "temp_mod" || !o.owner?.userId || o.owner.userId === self?.userId));
  const blocked = !!w && !mine;
  const names = waitingOn.map((u) => state?.players.find((p) => p.userId === u)?.userName ?? u);

  return (
    <div className={classes.panel}>
      <div className={classes.head}>
        {ROLL_NAMES[rollType] ?? "Combat"}
        <span className={classes.sub}>
          {combat?.tile ?? str(w?.subject.tile, "")} · {holderName(holder)}
        </span>
      </div>
      {combat && <Sides combat={combat} holder={holder} rollType={rollType} state={state} />}
      <p className={classes.status}>
        {mine ? <strong>Your roll.</strong> : w && self && w.responded.includes(self.userId) ? "You have rolled." : ""}
        {names.length > 0 && <span className={classes.warn}> Waiting for {names.join(", ")}.</span>}
      </p>
      <div className={classes.actions}>
        {rolls.map((o) => (
          <Button key={o.id} size="xs" variant={mine && o.value?.rollType === rollType ? "filled" : "default"} disabled={blocked} onClick={() => answer(o.id)}>
            Roll {ROLL_NAMES[String(o.value?.rollType)]?.toLowerCase() ?? ""}
          </Button>
        ))}
        {others.map((o) => (
          <Button key={o.id} size="xs" variant="default" disabled={blocked && o.value?.action !== "temp_mod"} onClick={() => answer(o.id)}>
            {ACTION_LABEL[String(o.value?.action)] ?? o.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
