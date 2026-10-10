import cx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDecisionRequests } from "@/decisions";
import { useGameData } from "@/state/useGameContext";
import { proposeTrade } from "./api";
import { LedgerColumn } from "./components/LedgerColumn";
import { OfferList } from "./components/OfferList";
import { QuickDeals } from "./components/QuickDeals";
import { SeatPicker } from "./components/SeatPicker";
import { draftFromOffer } from "./counter";
import { dealsWith, tradeHolderOf, type Deal } from "./deals";
import {
  clampSide,
  emptyDraft,
  giveLimits,
  receiveLimits,
  sideCount,
  toRequest,
  type SideDraft,
  type TradeDraft,
} from "./model";
import { SELECT_PARTNER_EVENT, takeWantedPartner } from "./openTradeWith";
import { createSocketPresser } from "./shimSocket";
import classes from "./Trade.module.css";
import type { ButtonRef, PendingOffer, PressButton } from "./types";
import { useTradeData } from "./useTradeData";

export type TradePanelProps = {
  /** Bot game id, e.g. `pbd1`. */
  gameName: string;
  /** The player's seat token, sent as `Authorization: Bearer`. */
  token: string;
  /** Where the bot API is mounted (default `/bot`, the shim proxy). */
  botBase?: string;
  /**
   * Presses a bot button (Accept / Reject / Rescind) through the shim. Pass the app's PlayConnection click to
   * reuse its socket; without it the panel opens its own `/app/ws` connection for the token.
   */
  onPress?: PressButton;
  /** Preselects a trade partner (faction, color or user id). */
  initialCounterparty?: string;
  /** Any value; a change triggers an immediate refetch (e.g. the latest message id in the cards thread). */
  refreshSignal?: unknown;
  pollMs?: number;
  className?: string;
};

type Status = { kind: "ok" | "error"; text: string } | null;

/** The decision popup's last "Counter…" request this page has acted on (the request outlives the drawer). */
let handledTradeRequest = 0;

const hiddenKey = (game: string) => `ti4-trade-hidden:${game}`;

function readHidden(game: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(hiddenKey(game)) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function writeHidden(game: string, ids: Set<string>) {
  try {
    localStorage.setItem(hiddenKey(game), JSON.stringify([...ids].slice(-100)));
  } catch {
    /* storage unavailable */
  }
}

/** Propose trades (bot "transactions") to other players and answer the ones sent to you. */
export function TradePanel({
  gameName,
  token,
  botBase = "/bot",
  onPress,
  initialCounterparty,
  refreshSignal,
  pollMs,
  className,
}: TradePanelProps) {
  const { options, pending, error, loading, refresh } = useTradeData(gameName, token, { botBase, pollMs });
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<TradeDraft>(emptyDraft);
  const [status, setStatus] = useState<Status>(null);
  const [sending, setSending] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const presser = useRef<ReturnType<typeof createSocketPresser> | null>(null);

  useEffect(() => () => presser.current?.close(), []);
  useEffect(() => {
    if (refreshSignal !== undefined) void refresh();
  }, [refreshSignal, refresh]);

  const counterparties = options?.counterparties ?? [];
  const cp = counterparties.find((c) => c.faction === selected) ?? null;

  useEffect(() => {
    if (!options || (cp && cp.canTrade)) return;
    const wanted = initialCounterparty?.toLowerCase();
    const preferred = counterparties.find(
      (c) => c.canTrade && wanted && [c.faction, c.color, c.userId, c.userName.toLowerCase()].includes(wanted),
    );
    const first = preferred ?? counterparties.find((c) => c.canTrade);
    setSelected(first?.faction ?? null);
  }, [options, cp, counterparties, initialCounterparty]);

  const limits = useMemo(() => {
    if (!options || !cp) return null;
    return { give: giveLimits(options.me, cp), receive: receiveLimits(cp) };
  }, [options, cp]);

  const give = limits ? clampSide(draft.give, limits.give) : draft.give;
  const receive = limits ? clampSide(draft.receive, limits.receive) : draft.receive;
  const giveCount = sideCount(give);
  const getCount = sideCount(receive);
  const pendingWith = useMemo(
    () => new Set((pending?.outgoing ?? []).map((o) => o.otherFaction)),
    [pending],
  );
  const [hidden, setHidden] = useState<Set<string>>(() => readHidden(gameName));
  const offers = useMemo(() => {
    const incoming = pending?.incoming ?? [];
    const live = new Set(incoming.filter((o) => o.current).map((o) => o.otherFaction));
    const visible = incoming.filter(
      (o) => o.current || (!live.has(o.otherFaction) && !hidden.has(o.accept?.messageId ?? "")),
    );
    return [...visible, ...(pending?.outgoing ?? [])];
  }, [pending, hidden]);

  const hide = (offer: PendingOffer) => {
    const id = offer.accept?.messageId;
    if (!id) return;
    const next = new Set(hidden).add(id);
    setHidden(next);
    writeHidden(gameName, next);
  };

  const press = async (button: ButtonRef) => {
    const fn = onPress ?? (presser.current ??= createSocketPresser(token)).press;
    const res = await fn(button.channelId, button.messageId, button.customId);
    if (res && res.error) throw new Error(res.error);
  };

  const pressOffer = async (button: ButtonRef, offer: PendingOffer) => {
    setBusyKey(`${offer.direction}:${offer.otherFaction}:${offer.offerNumber}:${offer.createdAt}`);
    try {
      await press(button);
      const verb = button.customId.startsWith("accept")
        ? "Accepted"
        : button.customId.startsWith("reject")
          ? "Rejected"
          : "Rescinded";
      setStatus({ kind: "ok", text: `${verb} offer ${offer.direction === "incoming" ? "from" : "to"} ${offer.otherUserName}.` });
    } catch (e) {
      setStatus({ kind: "error", text: (e as Error).message });
    } finally {
      setBusyKey(null);
      window.setTimeout(() => void refresh(), 700);
      window.setTimeout(() => void refresh(), 2500);
    }
  };

  const counter = async (offer: PendingOffer) => {
    if (!options || !offer.reject) return;
    await pressOffer(offer.reject, offer);
    setSelected(offer.otherFaction);
    setDraft({ ...draftFromOffer(offer, options.me.faction), note: "" });
    setStatus({ kind: "ok", text: `Rejected — edit the terms below and propose your counter to ${offer.otherUserName}.` });
  };

  // "Counter…" in the decision popup opens this drawer: reject that offer and load it here, mirrored, to edit.
  const tradeRequest = useDecisionRequests((s) => s.openTrade);
  useEffect(() => {
    if (!tradeRequest || tradeRequest.key <= handledTradeRequest || !options || !pending) return;
    handledTradeRequest = tradeRequest.key;
    const name = tradeRequest.playerName?.toLowerCase();
    const offer = pending.incoming.find(
      (o) => o.current && (o.otherFaction === tradeRequest.faction || (!!name && o.otherUserName.toLowerCase() === name)),
    );
    if (offer) void counter(offer);
    else if (tradeRequest.faction) setSelected(tradeRequest.faction);
    // counter() only closes over the latest options/pending, which are dependencies here.
  }, [tradeRequest, options, pending]);

  const setSide = (key: "give" | "receive") => (next: SideDraft) =>
    setDraft((d) => ({ ...d, [key]: next }));

  const choose = (faction: string) => {
    if (faction === selected) return;
    setSelected(faction);
    setDraft(emptyDraft());
    setStatus(null);
  };

  const holder = tradeHolderOf(useGameData()?.playerData);

  // A seat card's "Trade" asks for a partner (possibly before this panel mounted).
  const [wantedPartner, setWantedPartner] = useState<string | undefined>(takeWantedPartner);
  useEffect(() => {
    const onSelect = () => setWantedPartner(takeWantedPartner());
    window.addEventListener(SELECT_PARTNER_EVENT, onSelect);
    return () => window.removeEventListener(SELECT_PARTNER_EVENT, onSelect);
  }, []);
  useEffect(() => {
    if (!wantedPartner || !options) return;
    setWantedPartner(undefined);
    if (counterparties.some((c) => c.faction === wantedPartner && c.canTrade)) choose(wantedPartner);
    // choose() only reads the current selection, which a re-render keeps fresh.
  }, [wantedPartner, options]);

  const sendDraft = async (d: TradeDraft) => {
    if (!cp) return;
    setSending(true);
    setStatus(null);
    try {
      const res = await proposeTrade(botBase, gameName, token, toRequest(cp.faction, d));
      setDraft(emptyDraft());
      setStatus({
        kind: "ok",
        text: `Offer #${res.offerNumber} sent to ${cp.userName}. It waits in their trade popup until they accept, reject or counter; you can rescind it below.`,
      });
      void refresh();
      window.setTimeout(() => void refresh(), 1500);
    } catch (e) {
      setStatus({ kind: "error", text: (e as Error).message });
    } finally {
      setSending(false);
    }
  };

  const submit = () => sendDraft({ give, receive, note: draft.note });
  const sendDeal = (deal: Deal) => void sendDraft(deal.draft);
  const editDeal = (deal: Deal) => {
    setDraft(deal.draft);
    setStatus(null);
  };

  if (!options) {
    return (
      <div className={cx(classes.root, className)}>
        <div className={classes.plate}>
          <div className={classes.rail}>
            <span className={classes.railLabel}>Trade</span>
          </div>
          <div className={classes.empty}>{loading ? "Reading the table…" : (error ?? "No trade data.")}</div>
        </div>
      </div>
    );
  }

  const blocked = options.blockedReason;
  const replacing = cp && pendingWith.has(cp.faction);
  const canSubmit = !!cp && !blocked && !sending && giveCount + getCount > 0;
  const incomingCount = pending?.incoming.filter((o) => o.current).length ?? 0;

  const offersPlate = (
      <div className={classes.plate}>
      <div className={classes.rail}>
        <span className={classes.railLabel}>Open offers</span>
        <span className={classes.railMeta}>
          <span className={classes.mono}>{incomingCount}</span> to you ·{" "}
          <span className={classes.mono}>{pending?.outgoing.length ?? 0}</span> from you
        </span>
      </div>
      <OfferList
        offers={offers}
        myFaction={options.me.faction}
        busyKey={busyKey}
        onPress={(b, o) => void pressOffer(b, o)}
        onCounter={(o) => void counter(o)}
        onHide={hide}
      />
    </div>
  );

  return (
    <div className={cx(classes.root, className)}>
      {incomingCount > 0 && offersPlate}
      <div className={cx(classes.plate, classes.container)}>
        <div className={classes.rail}>
          <span className={classes.railLabel}>Trade</span>
          <span className={classes.railMeta}>
            Round <span className={classes.mono}>{options.round}</span> · {options.phase} phase
          </span>
          <span className={classes.spacer} />
          <span className={classes.railMeta}>
            You: <span className={classes.mono}>{options.me.tg}</span> TG ·{" "}
            <span className={classes.mono}>{options.me.commodities}</span> comm
          </span>
          <button type="button" className={classes.railButton} onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
        {blocked && <div className={classes.banner}>{blocked}</div>}
        {error && <div className={classes.banner}>{error}</div>}
        {counterparties.length === 0 ? (
          <div className={classes.empty}>No other players to trade with.</div>
        ) : (
          <SeatPicker
            counterparties={counterparties}
            selected={selected}
            onSelect={choose}
            phase={options.phase}
            pendingWith={pendingWith}
          />
        )}
        {cp && limits && (
          <>
            <QuickDeals
              me={options.me}
              cp={cp}
              deals={blocked ? [] : dealsWith(options.me, cp, holder)}
              holder={holder}
              busy={sending}
              onSend={sendDeal}
              onEdit={editDeal}
              onPickHolder={holder ? () => choose(holder.faction) : undefined}
            />
            <div className={classes.ledger}>
              <LedgerColumn mode="give" side={give} limits={limits.give} me={options.me} cp={cp} onChange={setSide("give")} />
              <LedgerColumn mode="receive" side={receive} limits={limits.receive} me={options.me} cp={cp} onChange={setSide("receive")} />
            </div>
            <div className={classes.footer}>
              <input
                className={classes.note}
                placeholder="Deal terms (optional) — e.g. “and I won't activate your home system”"
                maxLength={300}
                value={draft.note}
                onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canSubmit) void submit();
                }}
              />
              <span className={classes.summary}>
                {replacing ? "Replaces your open offer · " : ""}
                give <span className={classes.mono}>{giveCount}</span> · get{" "}
                <span className={classes.mono}>{getCount}</span>
              </span>
              <button
                type="button"
                className={classes.ghost}
                disabled={giveCount + getCount === 0 && !draft.note}
                onClick={() => setDraft(emptyDraft())}
              >
                Clear
              </button>
              <button type="button" className={classes.primary} disabled={!canSubmit} onClick={() => void submit()}>
                {sending ? "Sending…" : `Propose to ${cp.userName}`}
              </button>
            </div>
          </>
        )}
        {status && (
          <div className={cx(classes.status, status.kind === "ok" ? classes.statusOk : classes.statusError)} role="status">
            {status.text}
          </div>
        )}
      </div>
      {incomingCount === 0 && offersPlate}
    </div>
  );
}
