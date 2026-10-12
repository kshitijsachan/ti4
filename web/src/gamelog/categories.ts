import {
  IconArrowsExchange,
  IconAtom,
  IconCards,
  IconCoins,
  IconCompass,
  IconCrown,
  IconDots,
  IconFlag,
  IconGavel,
  IconHammer,
  IconHourglass,
  IconPencil,
  IconRocket,
  IconSwords,
  IconTrophy,
  IconUserStar,
  type Icon,
} from "@tabler/icons-react";
import type { EventKind, GameEvent } from "./types";
import { actorLabel, segText } from "./parse/markup";

export type CategoryId =
  | "strategy"
  | "movement"
  | "combat"
  | "production"
  | "planets"
  | "tech"
  | "objectives"
  | "agenda"
  | "cards"
  | "trades"
  | "leaders"
  | "resources"
  | "turns"
  | "setup"
  | "other";

export type Category = { id: CategoryId; label: string; icon: Icon; kinds: EventKind[] };

/** Display order inside a phase. */
export const CATEGORIES: Category[] = [
  { id: "objectives", label: "Objectives & VP", icon: IconTrophy, kinds: ["objective"] },
  { id: "agenda", label: "Agenda", icon: IconGavel, kinds: ["agenda"] },
  { id: "combat", label: "Combat", icon: IconSwords, kinds: ["combat"] },
  { id: "strategy", label: "Strategy cards", icon: IconFlag, kinds: ["sc_pick", "sc_play", "sc_follow"] },
  { id: "movement", label: "Movement", icon: IconRocket, kinds: ["activate", "move", "land"] },
  { id: "planets", label: "Planets & exploration", icon: IconCompass, kinds: ["planet", "explore"] },
  { id: "production", label: "Production", icon: IconHammer, kinds: ["produce"] },
  { id: "tech", label: "Tech", icon: IconAtom, kinds: ["tech"] },
  { id: "cards", label: "Action cards", icon: IconCards, kinds: ["action_card"] },
  { id: "trades", label: "Trades", icon: IconArrowsExchange, kinds: ["transaction"] },
  { id: "leaders", label: "Leaders, relics & abilities", icon: IconUserStar, kinds: ["leader", "relic", "ability"] },
  { id: "resources", label: "Resources", icon: IconCoins, kinds: ["resources"] },
  { id: "turns", label: "Turns & speaker", icon: IconHourglass, kinds: ["turn", "pass", "speaker", "phase"] },
  { id: "setup", label: "Setup", icon: IconCrown, kinds: ["setup"] },
  { id: "other", label: "Other", icon: IconDots, kinds: ["edit", "other"] },
];

const BY_KIND = new Map<EventKind, Category>();
for (const c of CATEGORIES) for (const k of c.kinds) BY_KIND.set(k, c);

export function categoryOf(kind: EventKind): Category {
  return BY_KIND.get(kind) ?? CATEGORIES[CATEGORIES.length - 1];
}

/** Per-kind row icon; most kinds share their category's. */
export function kindIcon(kind: EventKind): Icon {
  if (kind === "edit") return IconPencil;
  return categoryOf(kind).icon;
}

const bold = (e: GameEvent) => e.summary.filter((s) => s.t === "b").map((s) => (s.t === "b" ? s.v : ""));
const uniq = <T,>(xs: T[]) => [...new Set(xs)];
const list = (xs: string[], max = 4) => (xs.length > max ? `${xs.slice(0, max).join(", ")} +${xs.length - max}` : xs.join(", "));

/** One-line digest for a collapsed group header ("2 researched: Gravity Drive, Sarween Tools"). */
export function groupDigest(cat: CategoryId, events: GameEvent[], perPlayer = false): string {
  const of = (...kinds: EventKind[]) => events.filter((e) => kinds.includes(e.kind));
  const name = (e: GameEvent) => (perPlayer ? "" : actorLabel(e.actor));
  const line = (e: GameEvent) => `${name(e)} ${segText(e.summary)}`.trim();
  switch (cat) {
    case "strategy": {
      const picks = of("sc_pick").map((e) => `${name(e)} ${bold(e)[0]?.replace(/^\d+ · /, "") ?? ""}`.trim());
      if (picks.length && !perPlayer) return list(picks, 8);
      if (picks.length) return `picked ${list(picks, 8)}${of("sc_play").length ? ` · played ${of("sc_play").length}` : ""}`;
      const plays = of("sc_play").map((e) => bold(e)[0]?.replace(/^\d+ · /, "") ?? "");
      const follows = of("sc_follow").filter((e) => e.importance > 1).length;
      return [plays.length ? `played ${list(plays)}` : "", follows ? `${follows} followed` : ""].filter(Boolean).join(" · ");
    }
    case "tech": {
      const t = of("tech").map((e) => bold(e)[0] ?? "");
      return `${t.length} researched: ${list(t)}`;
    }
    case "combat": {
      const starts = of("combat").filter((e) => e.importance === 3);
      if (!starts.length) return list(events.map(line), 2);
      return starts.map((e) => `${actorLabel(e.actor)} vs ${actorLabel(e.target)}${e.systemPosition ? ` in ${e.systemPosition}` : ""}`).join(" · ");
    }
    case "objectives": {
      const revealed = events.filter((e) => /revealed/.test(segText(e.summary))).map((e) => bold(e)[0] ?? "");
      const scored = events.filter((e) => e.vp).map((e) => (perPlayer ? `${bold(e)[0] ?? ""} +${e.vp}` : `${actorLabel(e.actor)} +${e.vp}`));
      const parts = [revealed.length ? `revealed ${list(revealed)}` : "", scored.length ? `scored ${list(scored)}` : ""].filter(Boolean);
      return parts.join(" · ") || list(events.map(line), 2);
    }
    case "agenda": {
      const out: { name: string; outcome?: string; law?: boolean }[] = [];
      for (const e of events) {
        const t = segText(e.summary);
        const cur = out[out.length - 1];
        if (/^Agenda revealed: /.test(t)) out.push({ name: bold(e)[0] ?? t });
        else if (/ resolved: /.test(t) && cur) cur.outcome = bold(e)[1];
        else if (/is now law/.test(t) && cur) cur.law = true;
        else if (/Law repealed/.test(t)) out.push({ name: `repealed ${bold(e)[0] ?? ""}` });
      }
      const fmt = out.map((a) => `${a.name}${a.outcome ? ` → ${a.outcome}` : ""}${a.law ? " (law)" : ""}`);
      return list(fmt, 3) || list(events.map(line), 2);
    }
    case "movement": {
      const systems = uniq(of("activate", "move").map((e) => e.systemPosition).filter((p): p is string => !!p));
      return systems.length ? `${systems.length} system${systems.length === 1 ? "" : "s"} activated: ${list(systems)}` : `${events.length} moves`;
    }
    case "trades": {
      const deals = of("transaction").filter((e) => e.importance > 1);
      return deals.length ? `${deals.length} deal${deals.length === 1 ? "" : "s"}: ${list(uniq(deals.map((e) => `${actorLabel(e.actor)} ⇄ ${actorLabel(e.target)}`)))}` : list(events.map(line), 2);
    }
    case "turns": {
      const passed = of("pass").map((e) => actorLabel(e.actor));
      const speaker = of("speaker").map((e) => actorLabel(e.actor));
      if (perPlayer) return [passed.length ? `passed ${passed.length}×` : "", speaker.length ? "became speaker" : ""].filter(Boolean).join(" · ") || list(events.map(line), 2);
      return [passed.length ? `passed: ${list(passed, 8)}` : "", speaker.length ? `speaker: ${speaker[speaker.length - 1]}` : ""].filter(Boolean).join(" · ") || list(events.map(line), 2);
    }
    default:
      return list(events.map(line), 2);
  }
}
