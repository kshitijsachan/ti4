import cx from "clsx";
import type { DraftOrderOption, DraftState } from "../types";
import type { PickAvailability } from "../model";
import { playerById } from "../model";
import { PlayerTag } from "./PlayerTag";
import { Glyph } from "./Glyphs";
import classes from "../Draft.module.css";

type Props = {
  draft: DraftState;
  options: DraftOrderOption[];
  kind: "order" | "seat";
  availabilityOf: (o: DraftOrderOption) => PickAvailability;
  pendingKey: string | null;
  focusedKey: string | null;
  onFocus: (key: string | null, pin: boolean) => void;
  onPick: (o: DraftOrderOption) => void;
};

const ORDINAL = [
  "",
  "1st",
  "2nd",
  "3rd",
  "4th",
  "5th",
  "6th",
  "7th",
  "8th",
  "9th",
  "10th",
  "11th",
  "12th",
];

/** Speaker-order (or seat) tokens. Position 1 is the speaker. */
export function OrderPicker({
  draft,
  options,
  kind,
  availabilityOf,
  pendingKey,
  focusedKey,
  onFocus,
  onPick,
}: Props) {
  return (
    <div className={classes.orderRow}>
      {options.map((o) => {
        const owner = playerById(draft, o.choice.pickedBy);
        const avail = availabilityOf(o);
        const pending = pendingKey === o.choice.key;
        const isSpeaker = kind === "order" && o.number === 1;
        return (
          <button
            key={o.choice.key}
            type="button"
            className={cx(
              classes.plate,
              classes.orderToken,
              owner && draft.status === "drafting" && classes.taken,
              avail.ok && classes.orderReady,
              pending && classes.orderPending,
              focusedKey === o.choice.key && classes.focused,
            )}
            disabled={!avail.ok || pending}
            title={avail.ok ? `Pick ${o.label}` : avail.reason}
            onMouseEnter={() => onFocus(o.choice.key, false)}
            onMouseLeave={() => onFocus(null, false)}
            onClick={() => avail.ok && onPick(o)}
          >
            <span className={classes.orderNumber}>{o.number}</span>
            <span className={classes.orderCaption}>
              {isSpeaker ? (
                <>
                  <Glyph
                    src={draft.icons.glyphs.speaker}
                    alt="speaker"
                    size={12}
                  />{" "}
                  Speaker
                </>
              ) : kind === "seat" ? (
                `Seat ${o.number}`
              ) : (
                `${ORDINAL[o.number] ?? o.number} pick`
              )}
            </span>
            <span className={classes.orderStatus}>
              {owner ? (
                <PlayerTag player={owner} draft={draft} compact />
              ) : pending ? (
                "Sending…"
              ) : avail.ok ? (
                <span className={classes.orderPickHint}>Pick</span>
              ) : (
                <span className={classes.orderOpen}>Open</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
