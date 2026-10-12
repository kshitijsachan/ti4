import { useEffect, useMemo, useState } from "react";
import { usePlay, type Message, type PlayConnection } from "@/discord";
import type { PlayerData, PlayerDataResponse } from "@/entities/data/types";
import type { Tile } from "@/entities/game/types";
import { baseId } from "@/decisions/model/controls";
import { useHand } from "@/hand/useHand";
import { actionsFor, useRunCardAction } from "@/hand/useHandActions";
import { buttonsOf, pressButton } from "./driver";
import type { UnitGroup } from "./movement";
import { distancesTo, passiveBonuses, type MoveBonus } from "./range";

/** Something I may use before my ships move: an action card from my hand or one of the bot's ability buttons. */
export type BonusOffer = {
  id: string;
  /** "Play Flank Speed (+1 to all ships)". */
  label: string;
  /** What choosing it does in the game ("plays the card"). */
  note: string;
  /** Its move bonus, when the map can count it. */
  bonus?: MoveBonus;
  run: () => Promise<void>;
};

/** The bot's own movement-step buttons that raise move values, with what they add. */
const PROMPT_BONUS: { id: RegExp; bonus?: Omit<MoveBonus, "name"> }[] = [
  { id: /^declareUse_Aetherstream$/, bonus: { amount: 1, ships: Infinity } },
  { id: /^planetAbilityExhaust_tempesta$/, bonus: { amount: 1, ships: 1 } },
  { id: /^exhaustTech_baldrick_gd$/, bonus: { amount: 1, ships: 1 } },
  { id: /^exhaustAgent_saaragent$/ },
  { id: /^exhaustAgent_ghostagent$/ },
  { id: /^declareUse_Vaylerian Commander$/ },
  { id: /^(dominusOrb|eyeOfVogul|planetAbilityExhaust_gyraxis|exhaustTech_(dsuydab|dslizhb|baldrick_lwd)|exhaustRelic_absol_luxarchtreatise)$/ },
];

const FLANK = "Flank Speed";

/** An action card named `name` was played since my newest activation (its bonus lasts the tactical action). */
function playedThisAction(messages: Message[], name: string) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m.author.bot) continue;
    if (/\bactivated \d+\b/i.test(m.content)) return false;
    const text = [m.content, ...(m.embeds ?? []).map((e) => `${e.title ?? ""} ${e.description ?? ""}`)].join(" ");
    if (text.includes(name) && /\bplayed\b|_?Flank Speed_?/i.test(text) && !/\bfound\b/i.test(text)) return true;
  }
  return false;
}

/**
 * Move bonuses for the map's movement step: what counts on its own (Gravity Drive on one ship, gravity rifts on the
 * way, a Flank Speed already played), what I may choose to use first (Flank Speed from my hand, the bot's ability
 * buttons on the movement prompt), and the presses that make a choice real in the game before the ships move.
 */
export function useMoveBonuses(args: {
  gameName: string;
  me?: PlayerData;
  web?: PlayerDataResponse;
  conn: PlayConnection;
  prompt: { channelId: string; messageId: string } | null;
  promptMessage?: Message;
  tiles: Record<string, Tile>;
  target: string | null;
  groups: Record<string, UnitGroup[]>;
  distances: Map<string, number>;
  moving: boolean;
}) {
  const { gameName, me, web, conn, prompt, promptMessage, tiles, target, groups, distances, moving } = args;
  const hand = useHand(gameName);
  const runCard = useRunCardAction(hand.threadId, hand.actionsId);
  const actions = usePlay((s) => (hand.actionsId ? s.messages[hand.actionsId] : undefined));
  const [chosen, setChosen] = useState<string[]>([]);
  const promptId = prompt?.messageId;
  useEffect(() => setChosen([]), [promptId]);

  const flankPlayed = useMemo(
    () => !!actions && playedThisAction(actions.ids.map((id) => actions.byId[id]).filter(Boolean), FLANK),
    [actions],
  );

  const offers = useMemo<BonusOffer[]>(() => {
    if (!moving || !prompt) return [];
    const out: BonusOffer[] = [];
    if (!flankPlayed) {
      const card = hand.groups.flatMap((g) => g.cards).find((c) => c.kind === "ac" && c.name === FLANK);
      const play = card && actionsFor(card, hand).find((a) => a.id === "play");
      if (play)
        out.push({
          id: "flank",
          label: `Play ${FLANK} (+1 to all ships)`,
          note: "plays the card from your hand before the ships move",
          bonus: { name: FLANK, amount: 1, ships: Infinity },
          run: async () => {
            const r = await runCard(play);
            if (r.error) throw new Error(`${FLANK}: ${r.error}`);
          },
        });
    }
    for (const c of buttonsOf(promptMessage, me?.faction)) {
      const id = baseId(c.customId);
      const known = PROMPT_BONUS.find((k) => k.id.test(id));
      if (!known || !c.customId) continue;
      const customId = c.customId;
      const name = c.label.replace(/^(Exhaust|Declare|Use|Purge)\s+/i, "");
      const bonus = known.bonus ? { name, ...known.bonus } : undefined;
      const what = bonus ? ` (+${bonus.amount} to ${bonus.ships === Infinity ? "all ships" : "one ship"})` : "";
      out.push({
        id: customId,
        label: `${c.label}${what}`,
        note: bonus ? "uses it in the game before the ships move" : "uses it in the game before the ships move; the map does not count its effect",
        bonus,
        run: () => pressButton(conn, { ...prompt, customId }),
      });
    }
    return out;
  }, [moving, prompt, flankPlayed, hand, promptMessage, me?.faction, runCard, conn]);

  /* Gravity rifts on the way count +1 by themselves: say so when that is what brings a system in range. */
  const riftHelps = useMemo(() => {
    if (!moving || !target || !me) return false;
    const plain = distancesTo(target, tiles, me.faction, me.techs ?? [], web, me.relics ?? [], false);
    return Object.keys(groups).some((o) => (distances.get(o) ?? Infinity) < (plain.get(o) ?? Infinity));
  }, [moving, target, me, tiles, web, groups, distances]);

  const active = useMemo<MoveBonus[]>(() => {
    const out = passiveBonuses(me);
    if (flankPlayed) out.push({ name: FLANK, amount: 1, ships: Infinity });
    for (const o of offers) if (o.bonus && chosen.includes(o.id)) out.push(o.bonus);
    return out;
  }, [me, flankPlayed, offers, chosen]);

  const notes: string[] = [];
  for (const b of passiveBonuses(me)) notes.push(`${b.name}: +${b.amount} to one ship, counted automatically`);
  if (flankPlayed) notes.push(`${FLANK} played: +1 to all ships this action`);
  if (riftHelps) notes.push("Gravity rifts on the way: +1 for ships that use them (they roll for the rift after moving)");

  const live = offers.filter((o) => chosen.includes(o.id));
  return {
    active,
    offers,
    chosen,
    toggle: (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id])),
    notes,
    /** Presses what I chose (play the card, exhaust the ability), in order, before the movement is committed. */
    runChosen: async (onProgress?: (text: string) => void) => {
      for (const o of live) {
        onProgress?.(`${o.label.replace(/\s*\(.*\)$/, "")}…`);
        await o.run();
      }
      setChosen([]);
    },
  };
}
