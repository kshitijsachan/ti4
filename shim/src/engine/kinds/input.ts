import type { DecisionBase } from "../types.js";

/**
 * A form the engine asks for (a Discord modal opened by a button the player answered). `inputs[0]` is its schema.
 * Options: "submit" (send `inputs`) and "cancel". Private to the answering player.
 */
export type InputFormDecision = DecisionBase<"input.form", null>;
