/**
 * Autopilot policy for the table-driven Thunder's Edge kinds (c5): te.breakthrough, te.breach, te.plot. Pure:
 * (decision, state, me) → option. Called from chooseThundersEdge (policy-te.ts) after its target / owner-lock checks,
 * with `live` = enabled options not locked to another faction.
 *
 * Every decision addressed to the bot gets an answer (never "left to a person"):
 * - a flow already under way (action "target"): the best typed choice for the step, else the first one;
 * - an optional offer (action "use" + a Decline/Done option): declined, except a few clear wins (The Reaping's TG,
 *   Valefar Z copying a flagship is left out on purpose: it purges the breakthrough);
 * - nothing typed left: the Done / Decline option, else the first live option.
 * The Firmament's plot panel (te.plot panel=true) is a bookkeeping menu, a background prompt: never pressed.
 */
import type { GameState, Option, PlayerState } from "../types.js";
import type { TeBreach, TeBreakthrough, TePlot, TeStepFields } from "../kinds/te.js";

export type TeTableChoice = { option: Option<any>; why: string };

type Ctx = { state: GameState | null; self: PlayerState | undefined; live: Option<any>[] };

function done(live: Option<any>[]): Option<any> | undefined {
  return live.find((o) => o.value === null && /^deleteButtons(_|~|$)/.test(o.handler));
}

function pick(o: Option<any> | undefined, why: string): TeTableChoice | null {
  return o ? { option: o, why } : null;
}

/** Opponents ranked by victory points (the leader first). */
function vpRank(state: GameState | null, faction: string | undefined): number {
  return state?.players.find((p) => p.faction === faction)?.victoryPoints ?? -1;
}

function byVpDesc(state: GameState | null) {
  return (a: Option<any>, b: Option<any>) => vpRank(state, b.value?.target) - vpRank(state, a.value?.target);
}

/** The default for a step of a flow under way, or an offer. */
function fallback(c: Ctx, typed: Option<any>[], what: string): TeTableChoice | null {
  const target = typed.filter((o) => (o.value as TeStepFields).action === "target");
  if (target.length) return pick(target[0], `${what}: continue`);
  const skip = typed.find((o) => (o.value as TeStepFields).action === "skip");
  const d = done(c.live);
  if (typed.some((o) => (o.value as TeStepFields).optional) && d) return pick(d, `${what}: decline the optional effect`);
  return pick(skip, `${what}: finish`) ?? pick(d, `${what}: done`) ?? pick(typed[0], `${what}: only choice`) ?? pick(c.live[0], `${what}: only option`);
}

export function chooseTeBreakthrough(d: TeBreakthrough, c: Ctx): TeTableChoice | null {
  const typed = c.live.filter((o) => o.value);
  const step = typed[0]?.value?.step as string | undefined;
  const me = c.self?.faction ?? undefined;
  switch (step) {
    case "deorbitBarrageTarget": {
      const opts = typed.filter((o) => o.value.target !== me).sort(byVpDesc(c.state));
      return pick(opts[0], "Deorbit Barrage: hit the points leader");
    }
    case "deorbitBarrageResource": {
      // Resources spent (planets / trade goods): up to 3, never the whole treasury.
      const opts = typed.filter((o) => (o.value.amount ?? 0) <= 3).sort((a, b) => (b.value.amount ?? 0) - (a.value.amount ?? 0));
      return pick(opts[0] ?? typed[0], "Deorbit Barrage: spend up to 3 resources");
    }
    case "useThundersParadox_step3":
    case "useThundersParadox_step4":
    case "valefarZ":
    case "addNekroToken": {
      const opts = typed.filter((o) => o.value.target !== me).sort(byVpDesc(c.state));
      if (step === "valefarZ") return pick(done(c.live), "Valefar Z: keep the breakthrough") ?? pick(opts[0], "Valefar Z: copy");
      return pick(opts[0] ?? typed[0], "breakthrough: choose the points leader");
    }
    case "theReapingAddTg":
      return pick(typed[0], "The Reaping: take the trade goods");
    case "theSowingAddTg": {
      const opts = [...typed].sort((a, b) => (a.value.amount ?? 0) - (b.value.amount ?? 0));
      return pick(done(c.live), "The Sowing: keep my trade goods") ?? pick(opts[0], "The Sowing: the smallest stake");
    }
    case "useExecutiveOrder":
      return pick(typed.find((o) => o.value.choice === "top") ?? typed[0], "Executive Order: reveal from the top");
  }
  return fallback(c, typed, `breakthrough ${d.options.find((o) => o.value)?.value?.breakthrough ?? ""}`.trim());
}

export function chooseTeBreach(_d: TeBreach, c: Ctx): TeTableChoice | null {
  const typed = c.live.filter((o) => o.value);
  const crimson = c.self?.faction === "crimson";
  const step = typed[0]?.value?.step as string | undefined;
  if (step === "removeBreach" || step === "statusRemoveBreach") {
    // Breaches make systems adjacent for the Crimson Rebellion: they keep theirs, everyone else removes them.
    if (crimson) return pick(done(c.live), "breach: keep it") ?? fallback(c, typed, "breach");
    return pick(typed[0], "breach: remove the Crimson Rebellion's breach");
  }
  if (step === "placeBreach" || step === "placeInactiveBreach") {
    return pick(typed.find((o) => o.value.step === "placeBreach") ?? typed[0], "breach: place one");
  }
  if (step === "flipBreach") return pick(done(c.live), "breach: leave it as it is") ?? pick(typed[0], "breach: flip");
  return fallback(c, typed, "breach");
}

export function chooseTePlot(_d: TePlot, c: Ctx): TeTableChoice | null {
  const typed = c.live.filter((o) => o.value);
  if (typed.length && typed.every((o) => o.value.panel)) return null; // bookkeeping panel: background
  const me = c.self?.faction ?? undefined;
  const step = typed[0]?.value?.step as string | undefined;
  switch (step) {
    case "addFactionTokenToPlot":
    case "revealSeethe":
    case "revealExtract": {
      const opts = typed.filter((o) => !o.value.panel && o.value.target && o.value.target !== me).sort(byVpDesc(c.state));
      // Never ourselves (pbd161: the last faction left on the Seethe picker was the Firmament itself): decline.
      return pick(opts[0], "plot: the points leader") ?? pick(done(c.live), "plot: no other player to puppet");
    }
    case "resolveSeethe":
      return pick(typed.find((o) => o.value.planet) ?? typed[0], "Seethe: eradicate a planet");
  }
  return fallback(c, typed.filter((o) => !o.value.panel), "plot");
}
