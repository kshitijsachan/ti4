import { ANY_PN, emptyDraft, type SideDraft, type TradeDraft } from "./model";
import type { FragmentTrait, PendingOffer, TradeItem } from "./types";

function apply(side: SideDraft, item: TradeItem, giving: boolean): SideDraft {
  switch (item.kind) {
    case "tg":
      return { ...side, tg: side.tg + item.amount };
    case "commodities":
      return { ...side, commodities: side.commodities + item.amount };
    case "pn":
      return { ...side, promissoryNote: item.id ?? side.promissoryNote };
    case "pnAny":
      return giving ? side : { ...side, promissoryNote: ANY_PN };
    case "ac":
      if (giving && item.id) return { ...side, actionCards: [...side.actionCards, item.id] };
      return { ...side, actionCardCount: side.actionCardCount + 1 };
    case "acAny":
      return giving ? side : { ...side, actionCardCount: side.actionCardCount + item.amount };
    case "fragment": {
      const trait = item.id as FragmentTrait;
      if (!(trait in side.fragments)) return side;
      return { ...side, fragments: { ...side.fragments, [trait]: side.fragments[trait] + item.amount } };
    }
    case "relic":
      return item.id ? { ...side, relics: [...side.relics, item.id] } : side;
    case "sendDebt":
      return { ...side, sendDebt: side.sendDebt + item.amount };
    case "clearDebt":
      return { ...side, clearDebt: side.clearDebt + item.amount };
    default:
      return side;
  }
}

/** Turns an offer into a draft from my point of view, to edit and send back as a counter-offer. */
export function draftFromOffer(offer: PendingOffer, myFaction: string): TradeDraft {
  const draft = emptyDraft();
  for (const item of offer.items) {
    if (item.kind === "note") continue;
    if (item.from === myFaction) draft.give = apply(draft.give, item, true);
    else draft.receive = apply(draft.receive, item, false);
  }
  return draft;
}
