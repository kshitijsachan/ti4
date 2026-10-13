import { useState, type ReactNode } from "react";
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
  /**
   * With no end-of-game prompt open (it was dismissed), End game / Rematch run the bot's own `/game end` (the same
   * end as the prompt's buttons) instead of being greyed. Absent: they are greyed with the reason.
   */
  endByCommand?: (rematch: boolean) => void;
};

function optionFor(prompt: GameEnd | null, actions: GameEndValue["action"][]): Option<GameEndValue> | undefined {
  return prompt?.options.find((o) => !!o.value && actions.includes(o.value.action));
}

/** Why an action is off right now (shown on the greyed button), or null when it can be pressed. */
function offReason(prompt: GameEnd | null, finish: Props["finish"], option: Option<GameEndValue> | undefined, rematch: boolean, byCommand: boolean) {
  if (finish === "ended") return "The game has already been ended.";
  if (!prompt) return byCommand ? null : "No end-of-game prompt is open (it was dismissed). Use /game end in the actions channel.";
  if (!option) return rematch ? "Rematch is not offered for fog-of-war games." : "Not offered on this prompt.";
  if (option.disabled) return "Not available right now.";
  return null;
}

/**
 * End Game and Rematch from the typed game.end prompt (both always shown; greyed with the reason when they can't be
 * pressed). One click each, like the buttons in the actions channel.
 */
export function EndActions({ prompt, finish, answer, pendingOptionId, endByCommand }: Props) {
  const end = optionFor(prompt, ["end", "end_confirm"]);
  const rematch = optionFor(prompt, ["rematch"]);
  const [sent, setSent] = useState<"end" | "rematch" | null>(null);
  const busy = !!pendingOptionId || !!sent;
  const byCommand = !prompt && !!endByCommand;
  const endOff = offReason(prompt, finish, end, false, byCommand);
  const rematchOff = offReason(prompt, finish, rematch, true, byCommand);
  const deletes = !!end?.value?.deletesChannels;

  /* No prompt open: the same end through /game end (one click, like the prompt's own button). */
  const viaCommand = (which: "end" | "rematch") => {
    if (!endByCommand || sent) return;
    setSent(which);
    endByCommand(which === "rematch");
  };

  const button = (o: Option<GameEndValue> | undefined, off: string | null, label: string, icon: ReactNode, tone: string, which: "end" | "rematch") => (
    <Tooltip
      label={off ?? (byCommand ? `${label} (the end-of-game prompt was dismissed: this ends the game directly)` : deletes && o === end ? "Ends the game and deletes its channels" : label)}
      multiline
      maw={260}
      withinPortal
    >
      <UnstyledButton
        className={cx(classes.action, tone)}
        disabled={!!off || busy}
        data-off={off ? true : undefined}
        aria-disabled={!!off || busy}
        aria-busy={(!!o && pendingOptionId === o.id) || sent === which}
        onClick={() => {
          if (off) return;
          if (byCommand) return viaCommand(which);
          if (o && prompt) answer(prompt, o.id);
        }}
      >
        {(o && pendingOptionId === o.id) || sent === which ? <Loader size={12} color="currentColor" /> : icon}
        <span>{label}</span>
      </UnstyledButton>
    </Tooltip>
  );

  return (
    <div className={classes.actions}>
      {button(end, endOff, end?.value?.action === "end_confirm" || deletes ? "End and delete game" : "End game", <IconFlag size={14} />, classes.end, "end")}
      {button(rematch, rematchOff, "Rematch", <IconRefresh size={14} />, classes.rematch, "rematch")}
      {(endOff ?? rematchOff) && <p className={classes.reason}>{endOff ?? rematchOff}</p>}
    </div>
  );
}
