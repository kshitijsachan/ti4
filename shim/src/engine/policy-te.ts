/**
 * Autopilot policy for Thunder's Edge decisions (G10). Pure: (decision, state, me) → option.
 *
 * Hard rules (past bugs):
 * - Never press another faction's owner-locked button: a player-scope TE decision is only answered when the engine
 *   resolved it to us with certainty (owner prefix / our private thread / our own interaction), and no option whose
 *   id is locked to another faction is ever chosen. The engine refuses such answers too (TeKinds.ownerLockError).
 * - Never toggle galvanize: optional galvanize menus are left alone; the Bastion agent's forced prompt gets exactly
 *   one galvanize (progress says how many are done), then "Done". Ungalvanize is never chosen.
 */
import type { Decision, GameState, Option, PlayerState } from "./types.js";
import { awaits } from "./types.js";
import { INGRESS_TOKEN, type TeGalvanizeValue, type ThundersEdgeDecision } from "./kinds/te.js";

export type TeChoice = { option: Option<any>; why: string };

const CERTAIN = new Set(["owner_prefix", "spoof_prefix", "cards_thread", "private_channel", "interaction_user"]);

/** Galvanize the biggest ship first. */
const GALVANIZE_RANK = ["ws", "fs", "dn", "cv", "ca", "dd", "mf", "gf", "ff", "pd", "sd"];

const TE_KINDS = new Set<string>([
  "te.fracture.roll",
  "te.fracture.ingress",
  "te.galvanize",
  "te.expedition",
  "te.thunders_edge.place",
  "te.visionaria.respond",
]);

export function isThundersEdgeKind(d: Decision): d is ThundersEdgeDecision {
  return TE_KINDS.has(d.kind);
}

/** Whether `optionId` is locked (FFCC_<faction>_) to someone other than `faction`. */
export function lockedToOther(optionId: string, faction: string | null | undefined): boolean {
  const owner = /^FFCC_([a-z0-9]+)_/i.exec(optionId)?.[1];
  if (!owner) return false;
  if (!faction) return true;
  return owner !== faction && !(owner === "firmament" && faction.includes("obsidian"));
}

/** The commit / dismiss button of a TE prompt ("Done Resolving", "Done Galvanizing Units", "Delete These Buttons"). */
function doneOption(d: Decision): Option<any> | undefined {
  return (d.options as Option<any>[]).find((o) => !o.disabled && o.value === null && /^deleteButtons(_|$)/.test(o.handler));
}

/** null: a TE decision we leave alone (legacy may still look at it). Only call for isThundersEdgeKind(d). */
export function chooseThundersEdge(d: ThundersEdgeDecision, state: GameState | null, me: string): TeChoice | null {
  const self = state?.players.find((p) => p.userId === me);
  if (d.scope === "player" && (d.target?.userId !== me || !CERTAIN.has(d.target.resolvedBy))) return null;
  if (d.scope === "table" && !awaits(d, me)) return null;
  const live = (d.options as Option<any>[]).filter((o) => !o.disabled && !o.needsInput && !lockedToOther(o.id, self?.faction));
  const typed = live.filter((o) => o.value);
  const pick = (o: Option<any> | undefined, why: string): TeChoice | null => (o ? { option: o, why } : null);

  switch (d.kind) {
    case "te.fracture.roll":
      return pick(typed[0], typed[0]?.value.spawn ? "breakthrough: bring The Fracture into play" : "breakthrough: roll for The Fracture");

    case "te.fracture.ingress": {
      const remaining = Number(d.progress?.required?.remaining ?? 1);
      const done = doneOption(d);
      if (remaining <= 0) return pick(done, "The Fracture: ingress tokens for this type placed");
      const free = typed.filter((o) => !o.value.hasIngress && !hasIngress(state, o.value.position));
      free.sort((a, b) => presence(state, self, b.value.position) - presence(state, self, a.value.position));
      return pick(free[0], "The Fracture: place an ingress token near my forces") ?? pick(done, "The Fracture: no legal system left");
    }

    case "te.galvanize": {
      if (d.progress?.required?.mandatory !== true) return null;
      if (Number(d.progress.accumulated?.galvanized ?? 0) >= 1) return pick(doneOption(d), "Bastion agent: one unit galvanized");
      const opts = typed.filter((o) => (o.value as TeGalvanizeValue).action === "galvanize");
      const rank = (o: Option<any>) => {
        const i = GALVANIZE_RANK.indexOf(o.value.unit);
        return i < 0 ? 99 : i;
      };
      opts.sort((a, b) => rank(a) - rank(b));
      return pick(opts[0], "Bastion agent: galvanize my strongest unit");
    }

    case "te.expedition": {
      const tg = typed.find((o) => o.value.expedition === "tradeGoods" && o.value.affordable && (self?.tg ?? 0) >= 3);
      return pick(tg, "expedition: pay 3 trade goods") ?? pick(doneOption(d), "expedition: nothing cheap to pay with");
    }

    case "te.thunders_edge.place": {
      const start = typed.find((o) => o.value.step === "start");
      if (start) return pick(start, "Thunder's Edge: place it");
      const mine = typed.find((o) => o.value.step === "infantry" && o.value.faction === self?.faction);
      if (mine) return pick(mine, "Thunder's Edge: my infantry on it");
      const systems = typed.filter((o) => o.value.step === "system");
      systems.sort((a, b) => presence(state, self, b.value.position) - presence(state, self, a.value.position));
      return pick(systems[0] ?? typed[0], "Thunder's Edge: system near my forces");
    }

    case "te.visionaria.respond": {
      const owner = d.window?.subject?.owner === me;
      const choice = owner ? "end_turn_after_all" : "decline";
      return pick(typed.find((o) => o.value.choice === choice), owner ? "Visionaria Select: end turn once all answered" : "Visionaria Select: decline");
    }
  }
}

function spaceTokens(state: GameState | null, position: string): string[] {
  const tile = state?.tiles.find((t) => t.position === position);
  return tile?.holders.find((h) => h.name === "space")?.tokens ?? [];
}

function hasIngress(state: GameState | null, position: string): boolean {
  return spaceTokens(state, position).includes(INGRESS_TOKEN);
}

/** How much of mine is in a system: my units, plus planets I control there. */
function presence(state: GameState | null, self: PlayerState | undefined, position: string): number {
  const tile = state?.tiles.find((t) => t.position === position);
  if (!tile || !self?.faction) return 0;
  let n = 0;
  for (const h of tile.holders) {
    for (const u of h.units) if (u.owner === self.faction) n += u.count;
    if (self.planets.includes(h.name)) n += 2;
  }
  return n;
}
