import type { Choice } from "../../model/controls";
import classes from "./payment.module.css";

/** A button of my own (not a bot button) styled like the bot's choices. */
export function actionChoice(key: string, label: string, style = 3, disabled = false): Choice {
  return { key, kind: "button", customId: key, label, style, disabled, rank: "primary", component: { type: 2 } };
}

/** "Paid 4 of 6" with a bar; over- and under-payment are called out. */
export function Meter({ paid, need, unit }: { paid: number; need: number | undefined; unit: string }) {
  const known = need !== undefined;
  const pct = known && need > 0 ? Math.min(100, (paid / need) * 100) : paid > 0 ? 100 : 0;
  const state = !known ? "" : paid < need ? classes.short : paid > need ? classes.over : classes.exact;
  return (
    <div className={classes.meter}>
      <div className={classes.meterLine}>
        <span>
          Paid <span className={classes.num}>{paid}</span>
          {known && (
            <>
              {" "}
              of <span className={classes.num}>{need}</span>
            </>
          )}{" "}
          {unit}
        </span>
        {known && paid < need && <span className={classes.short}>{need - paid} short</span>}
        {known && paid > need && <span className={classes.over}>{paid - need} wasted</span>}
        {known && paid === need && need > 0 && <span className={classes.exact}>exact</span>}
      </div>
      <div className={classes.bar}>
        <div className={`${classes.fill} ${state}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}
