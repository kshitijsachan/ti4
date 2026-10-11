/**
 * The engine contract (docs/ENGINE.md §3), shared with the shim: one source of truth in shim/src/engine/types.ts.
 * Type-only, so nothing from the shim is bundled (the Docker web stage copies shim/src/engine for the type check).
 */
export type * from "../../../shim/src/engine/types";
