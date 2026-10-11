/**
 * Autopilot policy for the components area (C6): the component action menu, relic uses and the generic choose.*
 * kinds. Pure: (decision, state, me) → option. Always answers a decision addressed to
 * this seat (never leaves it to a person), never presses another seat's option (optionsFor). Defaults, no lookahead:
 *  - component.action: purge fragments for a relic when offered, else Cancel (the planner opens the menu only to
 *    look for that; leaders/relics/PNs are not planned).
 *  - relic.use: Crown of Emphidia is purged for the point (Maw of Worlds is not: it exhausts every planet);
 *    Prophet's Tears draws an action card; exhaust/use effects that help us are used; peeking at decks is declined.
 *  - choose.confirm: yes (Silver Flame: take the point); choose.planet: Stellar Converter on someone else's planet, Nano-Forge on one of ours, else first;
 *    choose.player: someone other than us; choose.card/system/unit: the first offered.
 */
import type {
  ChooseConfirm,
  ChoosePlanet,
  ChoosePlayer,
  ComponentAction,
  ComponentsDecision,
  RelicUse,
} from "../kinds/components.js";
import { COMPONENT_KINDS } from "../kinds/components.js";
import { optionsFor, type Decision, type GameState, type Option, type PlayerState } from "../types.js";

export type ComponentsChoice = { option: Option<any>; why: string };

export function isComponentsKind(d: Decision): d is ComponentsDecision {
  return COMPONENT_KINDS.has(d.kind);
}

type Live<V> = Option<V>[];

const DECLINE_LABEL = /^(cancel|decline|no\b|done|close|dismiss|not now|skip)/i;

/** Answer a components-area decision; null only when the seat has no pressable option at all. */
export function chooseComponents(d: ComponentsDecision, state: GameState | null, me: string): ComponentsChoice | null {
  const self = state?.players.find((p) => p.userId === me);
  const opts = (optionsFor(d, me) as Option<any>[]).filter((o) => !o.disabled && !o.needsInput);
  if (!opts.length) return null;
  const typed = opts.filter((o) => o.value);
  const untyped = opts.filter((o) => !o.value);
  // Decline = the message's Cancel / Decline / No / Done (deleteButtons…), never an undo or an unrelated shortcut; none
  // offered → null and the fallback decides.
  const no = untyped.find((o) => /^deleteButtons/i.test(o.handler || o.id) || DECLINE_LABEL.test(o.label.trim()));
  const decline = (why: string): ComponentsChoice | null => (no ? { option: no, why: `${d.kind}: ${why}` } : null);
  const pick = (o: Option<any> | undefined, why: string): ComponentsChoice | null => (o ? { option: o, why: `${d.kind}: ${why}` } : null);

  switch (d.kind) {
    case "component.action":
      return componentAction(typed as Live<ComponentAction["options"][number]["value"]>, pick) ?? decline("nothing planned, cancel");
    case "relic.use":
      return relicUse(typed as Live<RelicUse["options"][number]["value"]>, pick) ?? decline("not worth using now");
    case "choose.confirm": {
      const t = typed as Live<ChooseConfirm["options"][number]["value"]>;
      return (
        pick(t.find((o) => o.value!.confirm && o.value!.choice === "Point"), "take the point") ??
        pick(t.find((o) => o.value!.confirm), `use ${t[0]?.value?.source ?? ""}`) ??
        pick(t[0], "only choice") ??
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
      if (t[0]?.value!.source === "titanprototype") return pick(t.find((o) => o.value!.faction === self?.faction) ?? t[0], "ourselves") ?? decline("none");
      return pick(t.find((o) => o.value!.faction !== self?.faction) ?? t[0], "first other player") ?? decline("none");
    }
    case "choose.card":
      // Neuraloop replaces a public objective at the cost of a relic: not planned.
      if (typed[0]?.value?.source === "neuraloop" && typed[0]?.value?.step === 1) return decline("keep the objective");
      return pick(typed[0], "first offered") ?? decline("none");
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

function relicUse(t: Live<RelicUse["options"][number]["value"]>, pick: Pick): ComponentsChoice | null {
  return (
    pick(t.find((o) => o.value!.effect === "purge_for_point"), "Crown of Emphidia: purge for a victory point") ??
    pick(t.find((o) => o.value!.effect === "draw_action_card"), "Prophet's Tears: draw an action card") ??
    pick(t.find((o) => o.value!.effect === "exhaust" || o.value!.effect === "use"), `use ${t.find((o) => o.value!.effect === "exhaust" || o.value!.effect === "use")?.value?.relic ?? "relic"}`)
  );
}
