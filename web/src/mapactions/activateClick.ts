/** What a map click does while I can activate a system: open its inline confirm, confirm it, or nothing. */
export type ActivateClick = { kind: "ignore" } | { kind: "confirm"; position: string } | { kind: "offer"; position: string; label: string };

/** The inline confirm on the clicked system: what activating it costs. */
export const activateLabel = (name: string) => `Activate ${name} (−1 tactic token)`;

/**
 * Map-first activation, two clicks on the same spot: the first click on a system I can activate offers its inline
 * confirm, a second click on that same system (or its ✓) activates it. A blocked system does nothing (its hover
 * tooltip says why) so the map's own click (the system dossier) still works.
 */
export function activateClick(
  position: string,
  canActivate: boolean,
  openConfirm: { kind: string; position: string } | null,
  name: string,
): ActivateClick {
  if (!canActivate) return { kind: "ignore" };
  if (openConfirm?.kind === "activate" && openConfirm.position === position) return { kind: "confirm", position };
  return { kind: "offer", position, label: activateLabel(name || "system") };
}
