import { useState } from "react";
import { UnstyledButton } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { getToken } from "@/play/session";
import type { PlayerData } from "@/entities/data/types";
import { baseId, type Choice } from "../../model/controls";
import { ChoiceButton, type PressFn } from "../../ui/ChoiceButtons";
import { playerLabel } from "./shared";
import classes from "./strategy.module.css";

type Counterparty = { faction: string; canTrade: boolean; reason?: string | null };

/** Whether I may transact with the Trade holder right now, from the bot's own rule (neighbours, Guild Ships, convoys…). */
function useCanTradeWith(gameName: string, faction?: string) {
  const query = useQuery({
    queryKey: ["strategy", "tradeOptions", gameName],
    enabled: !!faction,
    staleTime: 10_000,
    retry: false,
    queryFn: async () => {
      const token = getToken();
      const res = await fetch(`/bot/api/game/${encodeURIComponent(gameName)}/trade/options`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`trade options ${res.status}`);
      return (await res.json()) as { counterparties?: Counterparty[] };
    },
  });
  const cp = query.data?.counterparties?.find((c) => c.faction === faction);
  return { loaded: !!query.data, canTrade: !!cp?.canTrade, reason: cp?.reason ?? undefined };
}

/**
 * The Trade card's free options, which only apply when its holder agreed to a deal: a plain free replenish, and
 * "replenish and wash" — a trade (commodities to the holder, trade goods back), so it needs the holder to be someone
 * I may trade with and is behind its own confirm, never a main button.
 */
export function TradeDeal({ choices, holder, gameName, onPress, pendingKey }: {
  choices: Choice[];
  holder?: PlayerData;
  gameName: string;
  onPress: PressFn;
  pendingKey: string | null;
}) {
  const [confirmWash, setConfirmWash] = useState(false);
  const trade = useCanTradeWith(gameName, holder?.faction);
  const refresh = choices.find((c) => baseId(c.customId) === "sc_refresh" && !c.disabled);
  const wash = choices.find((c) => baseId(c.customId) === "sc_refresh_and_wash" && !c.disabled);
  const who = holder ? playerLabel(holder) : "the Trade holder";
  const busy = !!pendingKey;
  if (!refresh && !wash) return null;
  return (
    <div className={classes.actions}>
      <span className={classes.sectionLabel}>Only by deal with {who} — no token</span>
      {refresh && (
        <div className={classes.inlineRow}>
          <span className={classes.sub}>Replenish your commodities for free, if {who} offered it. Counts as following.</span>
          <ChoiceButton choice={{ ...refresh, label: "Replenish for free", style: 2 }} onPress={onPress} pending={pendingKey === refresh.key} busy={busy} compact />
        </div>
      )}
      {wash && !trade.canTrade && (
        <p className={classes.sub}>
          Washing (commodities → trade goods) is a trade with {who}
          {trade.loaded ? ` — not possible: ${trade.reason ?? "you cannot trade with them"}.` : "; checking whether you can trade with them…"}
        </p>
      )}
      {wash && trade.canTrade && !confirmWash && (
        <UnstyledButton className={classes.textLink} onClick={() => setConfirmWash(true)} disabled={busy}>
          Replenish and wash with {who}…
        </UnstyledButton>
      )}
      {wash && trade.canTrade && confirmWash && (
        <div className={classes.confirmBox}>
          <span className={classes.sub}>
            Replenish, then swap all your commodities to {who} for trade goods. Only if {who} agreed to this deal.
          </span>
          <div className={classes.actionRow}>
            <ChoiceButton choice={{ ...wash, label: "Confirm wash", style: 2 }} onPress={onPress} pending={pendingKey === wash.key} busy={busy} compact />
            <UnstyledButton className={classes.textLink} onClick={() => setConfirmWash(false)}>
              Cancel
            </UnstyledButton>
          </div>
        </div>
      )}
    </div>
  );
}
