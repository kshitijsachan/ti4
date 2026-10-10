/** What a map hover card is about: a unit stack or a planet. */
export type HoverKind = "unit" | "planet";

const targets: Record<HoverKind, Element | null> = { unit: null, planet: null };

/** Remembers the element the pointer entered, so its hover card can be placed beside it instead of on top of it. */
export function rememberHoverTarget(kind: HoverKind, element: Element | null) {
  targets[kind] = element;
}

/** The element last hovered for this kind, while it is still on the page. */
export function hoverTarget(kind: HoverKind): Element | null {
  const element = targets[kind];
  return element?.isConnected ? element : null;
}
