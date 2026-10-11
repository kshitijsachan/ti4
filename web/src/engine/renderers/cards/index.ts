import type { RendererModule } from "../../registry";
import {
  ActionCardDiscard,
  ActionCardDraw,
  ActionCardPlay,
  ActionCardResolve,
  ActionCardSabotage,
  ActionCardTarget,
} from "./ActionCards";
import { PromissoryNotePlay } from "./PromissoryNotes";
import { ActionCardStep, ActionCardWhenAfter, PromissoryNoteResolve } from "./Steps";

/** G8: action cards and promissory notes. */
export const renderers: RendererModule["renderers"] = {
  "action_card.play": ActionCardPlay,
  "action_card.sabotage": ActionCardSabotage,
  "action_card.discard": ActionCardDiscard,
  "action_card.draw": ActionCardDraw,
  "action_card.resolve": ActionCardResolve,
  "action_card.target": ActionCardTarget,
  "action_card.step": ActionCardStep,
  "action_card.when_after": ActionCardWhenAfter,
  "promissory_note.play": PromissoryNotePlay,
  "promissory_note.resolve": PromissoryNoteResolve,
};
