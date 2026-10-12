import type { ReactNode } from "react";
import { Loader, Tooltip, UnstyledButton } from "@mantine/core";
import { IconFlag, IconRefresh } from "@tabler/icons-react";
import cx from "clsx";
import type { GameEnd, GameEndValue, Option } from "../../contract";
import type { AnswerPayload } from "../../link";
import classes from "./game.module.css";

type Props = {
  /** The open end-of-game prompt, or null when there is none (ended, or dismissed). */
  prompt: GameEnd | null;
  /** "ended": the game was ended already (the reason both actions are off). */
  finish: "won" | "ended" | null;
  answer: (d: GameEnd, choice: string | AnswerPayload) => void;
  pendingOptionId?: string | null;
};

function optionFor(prompt: GameEnd | null, actions: GameEndValue["action"][]): Option<GameEndValue> | undefined {
  return prompt?.options.find((o) => !!o.value && actions.includes(o.value.action));
}

/** Why an action is off right now (shown on the greyed button), or null when it can be pressed. */
function offReason(prompt: GameEnd | null, finish: Props["finish"], option: Option<GameEndValue> | undefined, rematch: boolean) {
  if (finish === "ended") return "The game has already been ended.";
  if (!prompt) return "No end-of-game prompt is open (it was dismissed). Use /game end in the actions channel.";
  if (!option) return rematch ? "Rematch is not offered for fog-of-war games." : "Not offered on this prompt.";
  if (option.disabled) return "Not available right now.";
  return null;
}

/**
 * End Game and Rematch from the typed game.end prompt (both always shown; greyed with the reason when they can't be
 * pressed). One click each, like the buttons in the actions channel.
 */
export function EndActions({ prompt, finish, answer, pendingOptionId }: Props) {
  const end = optionFor(prompt, ["end", "end_confirm"]);
  const rematch = optionFor(prompt, ["rematch"]);
  const busy = !!pendingOptionId;
  const endOff = offReason(prompt, finish, end, false);
  const rematchOff = offReason(prompt, finish, rematch, true);
  const deletes = !!end?.value?.deletesChannels;

  const button = (o: Option<GameEndValue> | undefined, off: string | null, label: string, icon: ReactNode, tone: string) => (
    <Tooltip label={off ?? (deletes && o === end ? "Ends the game and deletes its channels" : label)} multiline maw={260} withinPortal>
      <UnstyledButton
        className={cx(classes.action, tone)}
        disabled={!!off || busy}
        data-off={off ? true : undefined}
        aria-disabled={!!off || busy}
        aria-busy={!!o && pendingOptionId === o.id}
        onClick={() => o && prompt && !off && answer(prompt, o.id)}
      >
        {o && pendingOptionId === o.id ? <Loader size={12} color="currentColor" /> : icon}
        <span>{label}</span>
      </UnstyledButton>
    </Tooltip>
  );

  return (
    <div className={classes.actions}>
      {button(end, endOff, end?.value?.action === "end_confirm" || deletes ? "End and delete game" : "End game", <IconFlag size={14} />, classes.end)}
      {button(rematch, rematchOff, "Rematch", <IconRefresh size={14} />, classes.rematch)}
      {(endOff ?? rematchOff) && <p className={classes.reason}>{endOff ?? rematchOff}</p>}
    </div>
  );
}
