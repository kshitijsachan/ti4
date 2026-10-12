import type { ReactNode } from "react";
import { Loader, UnstyledButton } from "@mantine/core";
import cx from "clsx";
import type { Option } from "../../contract";
import classes from "./Cards.module.css";

type Tone = "go" | "stop" | "plain";

/** One answer button; the caller supplies a label built from typed values. */
export function AnswerButton({
  option,
  label,
  tone = "plain",
  pendingOptionId,
  onAnswer,
}: {
  option: Option<unknown>;
  label: ReactNode;
  tone?: Tone;
  pendingOptionId?: string | null;
  onAnswer: (optionId: string) => void;
}) {
  const pending = pendingOptionId === option.id;
  return (
    <UnstyledButton
      className={cx(classes.button, tone === "go" && classes.go, tone === "stop" && classes.stop)}
      disabled={option.disabled || option.needsInput || !!pendingOptionId}
      data-pending={pending || undefined}
      aria-busy={pending}
      onClick={() => onAnswer(option.id)}
    >
      {pending && <Loader size={12} color="currentColor" />}
      {label}
    </UnstyledButton>
  );
}

/** Untyped extras of a typed decision ("Done", "Decline", "Discard an Action Card"): engine labels, last. */
export function ExtraOptions({
  options,
  pendingOptionId,
  onAnswer,
}: {
  options: Option<unknown>[];
  pendingOptionId?: string | null;
  onAnswer: (optionId: string) => void;
}) {
  const extras = options.filter((o) => o.value == null);
  if (!extras.length) return null;
  return (
    <div className={classes.options}>
      {extras.map((o) => (
        <AnswerButton
          key={o.id}
          option={o}
          label={o.label || "Choose"}
          pendingOptionId={pendingOptionId}
          onAnswer={onAnswer}
        />
      ))}
    </div>
  );
}

export function Head({ title, meta }: { title: ReactNode; meta?: ReactNode }) {
  return (
    <div className={classes.head}>
      <span className={classes.title}>{title}</span>
      {meta && <span className={classes.meta}>{meta}</span>}
    </div>
  );
}
