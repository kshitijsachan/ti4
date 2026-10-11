/**
 * Autopilot policy for the components area (C6): the component action menu, relic uses, the generic agent exhaust
 * step and the generic choose.* kinds. Pure: (decision, state, me) → option. Always answers a decision addressed to
 * this seat (never leaves it to a person), never presses another seat's option (optionsFor). Defaults, no lookahead:
 *  - component.action: purge fragments for a relic when offered, else Cancel (the planner opens the menu only to
 *    look for that; leaders/relics/PNs are not planned).
 *  - relic.use: Prophet's Tears draws an action card; exhaust/use effects that help us are used (Temporal Command
 *    Suite only on our own agent); peeking at decks is declined.
 *  - leader.agent: the "who uses the agent" menu → ourselves, else the first; optional "use agent" offers → decline.
 *  - choose.confirm: yes (Silver Flame: take the point); choose.amount (commodities): convert when we hold enough,
 *    else gain; choose.planet: Stellar Converter on someone else's planet, Nano-Forge on one of ours, else first;
 *    choose.player: someone other than us; choose.card/system/unit: the first offered.
 */
import type {
  ChooseAmount,
  ChooseConfirm,
  ChoosePlanet,
  ChoosePlayer,
  ComponentAction,
  ComponentsDecision,
  LeaderAgent,
  RelicUse,
} from "../kinds/components.js";
import { COMPONENT_KINDS } from "../kinds/components.js";
import { optionsFor, type Decision, type GameState, type Option, type PlayerState } from "../types.js";

export type ComponentsChoice = { option: Option<any>; why: string };

export function isComponentsKind(d: Decision): d is ComponentsDecision {
  return COMPONENT_KINDS.has(d.kind);
}

type Live<V> = Option<V>[];

/** Answer a components-area decision; null only when the seat has no pressable option at all. */
export function chooseComponents(d: ComponentsDecision, state: GameState | null, me: string): ComponentsChoice | null {
  const self = state?.players.find((p) => p.userId === me);
  const opts = (optionsFor(d, me) as Option<any>[]).filter((o) => !o.disabled && !o.needsInput);
  if (!opts.length) return null;
  const typed = opts.filter((o) => o.value);
  const untyped = opts.filter((o) => !o.value);
  const decline = (why: string): ComponentsChoice =>
    untyped[0] ? { option: untyped[0], why: `${d.kind}: ${why}` } : { option: opts[0], why: `${d.kind}: ${why} (no decline offered)` };
  const pick = (o: Option<any> | undefined, why: string): ComponentsChoice | null => (o ? { option: o, why: `${d.kind}: ${why}` } : null);

  switch (d.kind) {
    case "component.action":
      return componentAction(typed as Live<ComponentAction["options"][number]["value"]>, pick) ?? decline("nothing planned, cancel");
    case "relic.use":
      return relicUse(typed as Live<RelicUse["options"][number]["value"]>, self, pick) ?? decline("not worth using now");
    case "leader.agent":
      return leaderAgent(typed as Live<LeaderAgent["options"][number]["value"]>, untyped.length > 0, self, pick) ?? decline("keep the agent ready");
    case "choose.confirm": {
      const t = typed as Live<ChooseConfirm["options"][number]["value"]>;
      return (
        pick(t.find((o) => o.value!.confirm && o.value!.choice === "Point"), "take the point") ??
        pick(t.find((o) => o.value!.confirm), `use ${t[0]?.value?.source ?? ""}`) ??
        pick(t[0], "only choice") ??
        decline("decline")
      );
    }
    case "choose.amount": {
      const t = typed as Live<ChooseAmount["options"][number]["value"]>;
      const comms = self?.commodities ?? 0;
      const convert = t
        .filter((o) => o.value!.effect === "convert_commodities" && (o.value!.amount ?? 0) <= comms)
        .sort((a, b) => (b.value!.amount ?? 0) - (a.value!.amount ?? 0))[0];
      const gain = t.filter((o) => o.value!.effect === "gain_commodities").sort((a, b) => (b.value!.amount ?? 0) - (a.value!.amount ?? 0))[0];
      if (convert && comms >= (convert.value!.amount ?? 0) && (convert.value!.amount ?? 0) > 0) return pick(convert, "convert commodities");
      return (
        pick(gain, "gain commodities") ??
        pick([...t].sort((a, b) => (b.value!.amount ?? 0) - (a.value!.amount ?? 0))[0], "largest amount") ??
        decline("decline")
      );
    }
    case "choose.planet": {
      const t = typed as Live<ChoosePlanet["options"][number]["value"]>;
      const mine = new Set(self?.planets ?? []);
      if (t[0]?.value!.source === "stellarconverter") {
        return pick(t.find((o) => !mine.has(o.value!.planet)), "Stellar Converter: an opponent's planet") ?? decline("no target");
      }
      if (t[0]?.value!.source === "nanoforge") return pick(t.find((o) => mine.has(o.value!.planet)) ?? t[0], "Nano-Forge: our planet") ?? decline("none");
      return pick(t[0], "first planet") ?? decline("none");
    }
    case "choose.player": {
      const t = typed as Live<ChoosePlayer["options"][number]["value"]>;
      return pick(t.find((o) => o.value!.faction !== self?.faction) ?? t[0], "first other player") ?? decline("none");
    }
    case "choose.card":
    case "choose.system":
    case "choose.unit":
      return pick(typed[0], "first offered") ?? decline("none");
    default:
      return null;
  }
}

type Pick = (o: Option<any> | undefined, why: string) => ComponentsChoice | null;

function componentAction(t: Live<ComponentAction["options"][number]["value"]>, pick: Pick): ComponentsChoice | null {
  return pick(t.find((o) => o.value!.component === "getRelic"), "purge fragments for a relic");
}

function relicUse(t: Live<RelicUse["options"][number]["value"]>, self: PlayerState | undefined, pick: Pick): ComponentsChoice | null {
  return (
    pick(t.find((o) => o.value!.effect === "draw_action_card"), "Prophet's Tears: draw an action card") ??
    pick(t.find((o) => o.value!.effect === "ready_agent" && o.value!.faction === self?.faction), "ready our agent") ??
    pick(t.find((o) => o.value!.effect === "exhaust" || o.value!.effect === "use"), `use ${t.find((o) => o.value!.effect === "exhaust" || o.value!.effect === "use")?.value?.relic ?? "relic"}`)
  );
}

function leaderAgent(
  t: Live<LeaderAgent["options"][number]["value"]>,
  hasDecline: boolean,
  self: PlayerState | undefined,
  pick: Pick,
): ComponentsChoice | null {
  // "Choose the user of the agent" (one option per player, no decline): ourselves, else the first.
  const perPlayer = t.filter((o) => o.value!.faction);
  if (!hasDecline && perPlayer.length && perPlayer.length === t.length) {
    return pick(perPlayer.find((o) => o.value!.faction === self?.faction) ?? perPlayer[0], "agent: we use it");
  }
  if (!hasDecline) return pick(t[0], "agent: only choice");
  return null;
}
