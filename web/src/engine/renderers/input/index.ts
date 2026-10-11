import type { ComponentType } from "react";
import { InputFormRenderer, type InputRendererProps } from "./InputForm";

export { SelectInputs, SchemaForm, type InputAnswer } from "./InputForm";

/**
 * Typed input (W-INFRA-3): forms the engine opens when a seat presses a form button ("input.form"). Answers are
 * `{ optionId: "submit", inputs }` / `"cancel"`; select menus on other decisions answer `{ optionId: menuId, values }`
 * (see SelectInputs). The answer op must forward `values` / `inputs` to AnswerRequest.
 */
export const renderers: Record<string, ComponentType<InputRendererProps>> = {
  "input.form": InputFormRenderer,
};
