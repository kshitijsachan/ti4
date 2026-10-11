import type { ComponentType } from "react";
import { ActionCardDiscardRenderer, CommandTokensAdjustRenderer, StatusAdvanceRenderer, StatusHomeworkRenderer, StatusImperialRenderer } from "./Homework";
import { StatusRevealObjectiveRenderer, StatusScoreRenderer, StatusScoreSecretRenderer } from "./Scoring";
import type { StatusRendererProps } from "./shared";

export type { Answer, StatusRendererProps } from "./shared";

/**
 * Status phase renderers (G7), keyed by decision kind. Each is `(props: { decision, state, answer })`; `answer`
 * takes an option id, or `{ optionId, payload }` for options whose value says payload: true.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const renderers: Record<string, ComponentType<StatusRendererProps<any>>> = {
  "status.score": StatusScoreRenderer,
  "status.score_secret": StatusScoreSecretRenderer,
  "status.reveal_objective": StatusRevealObjectiveRenderer,
  "status.homework": StatusHomeworkRenderer,
  "status.advance": StatusAdvanceRenderer,
  "status.imperial": StatusImperialRenderer,
  "command_tokens.adjust": CommandTokensAdjustRenderer,
  "action_card.discard": ActionCardDiscardRenderer,
};
