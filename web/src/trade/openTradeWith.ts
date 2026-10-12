import { OPEN_TRADE_EVENT } from "@/decisions";

/** Fired when something outside the panel asks it to select a partner. */
export const SELECT_PARTNER_EVENT = "ti4:trade:select-partner";

let wanted: string | undefined;

/**
 * Opens the trade drawer with `faction` selected (e.g. from a seat card). Unlike the decision popup's "Counter…",
 * it never touches an offer from that player.
 */
export function openTradeWith(faction: string) {
  wanted = faction;
  window.dispatchEvent(new CustomEvent(SELECT_PARTNER_EVENT, { detail: faction }));
  window.dispatchEvent(new CustomEvent(OPEN_TRADE_EVENT));
}

/** The partner last asked for, once (the panel may mount after the request). */
export function takeWantedPartner(): string | undefined {
  const w = wanted;
  wanted = undefined;
  return w;
}
