/**
 * Faction steps of Ghosts of Creuss, L1Z1X, Mentak, Naalu, Nekro and Sardakk N'orr on the shared kinds leader.use /
 * faction.ability (bot FactionSteps{Creuss,L1z1x,Mentak,Naalu,Nekro,Sardakk}.java). Keyed by value.step (the handler
 * prefix). Runs before the generic chooseFaction (policy/faction.ts), which declines optional offers and takes the
 * first legal target for everything not listed here. Returns undefined when the decision has none of these steps,
 * null when the step must wait (an "after the combat" reminder while the combat is still on).
 */
import type { Decision, GameState, Option, TileState } from "../types.js";

type V = Record<string, unknown> & { step: string; action: string; optional: boolean };
type Opt = Option<V | null>;
type Ctx = { d: Decision; opts: Opt[]; state: GameState | null; me: string };
type StepPolicy = (c: Ctx) => Opt | null;

const typed = (opts: Opt[]) => opts.filter((o) => o.value);
const first = (c: Ctx) => typed(c.opts)[0] ?? null;
const byStep = (c: Ctx, step: string) => typed(c.opts).find((o) => o.value!.step === step) ?? null;
const self = (state: GameState | null, me: string) => state?.players.find((p) => p.userId === me) ?? null;

/** Whether units of our colour (mine) / of anyone else (!mine) are in a tile's space area. */
function shipsIn(tile: TileState | undefined, color: string | null | undefined, mine: boolean) {
  const space = tile?.holders.find((h) => h.name === "space");
  return (space?.units ?? []).some((u) => u.count > 0 && (mine ? u.color === color : u.color !== color));
}

/**
 * The tile of the combat a start-of-combat reminder belongs to: remembered while the combat is on (the reminder is
 * posted at its start), so the "after the combat" check still knows the system once GameState.combat is gone.
 */
const combatTile = new Map<string, string>();
function tileFor(c: Ctx, fromValue?: unknown): string | null {
  if (typeof fromValue === "string" && fromValue) return fromValue;
  const known = combatTile.get(c.d.id);
  if (known) return known;
  const now = c.state?.combat?.tile;
  if (now) {
    if (combatTile.size > 500) combatTile.clear();
    combatTile.set(c.d.id, now);
    return now;
  }
  return null;
}

/** After a space combat in `pos`: "won" (only our ships left), "lost" (only others'), "draw" (nobody), or null while it runs. */
function outcome(c: Ctx, pos: string | null): "won" | "lost" | "draw" | null {
  if (!pos || !c.state) return null;
  if (c.state.combat && c.state.combat.tile === pos) return null;
  const me = self(c.state, c.me);
  const tile = c.state.tiles.find((t) => t.position === pos);
  const ours = shipsIn(tile, me?.color, true);
  const theirs = shipsIn(tile, me?.color, false);
  if (ours && !theirs) return "won";
  if (theirs && !ours) return "lost";
  return ours ? null : "draw";
}

export const FACTION_B_STEPS: Record<string, StepPolicy> = {
  // Mentak: Ambush is free dice before combat; Ipswitch only when Ambush is not on offer (purging it is the only way on).
  rollForAmbush: (c) => byStep(c, "rollForAmbush"),
  purgeMentakHero: (c) => byStep(c, "rollForAmbush") ?? byStep(c, "purgeMentakHero"),
  // Pillage: always take it, a trade good over a commodity.
  pillage: (c) => {
    const opts = typed(c.opts).filter((o) => o.value!.step === "pillage");
    return opts.find((o) => o.value!.action === "use") ?? opts.find((o) => o.value!.what === "tg") ?? opts[0] ?? null;
  },
  declinePillage: (c) => byStep(c, "pillage") ?? byStep(c, "declinePillage"),
  // Salvage Operations: after a space combat that did not end in a draw.
  salvageOps: (c) => {
    const o = byStep(c, "salvageOps");
    const r = outcome(c, tileFor(c, o?.value?.tile));
    return r === "won" || r === "lost" ? o : null;
  },
  // S'ula Mentarion: after winning the space combat against that player.
  mentakCommander: (c) => {
    const o = byStep(c, "mentakCommander");
    const r = outcome(c, tileFor(c));
    if (r === null) return null;
    if (r === "won") return o;
    return c.opts.find((x) => !x.value && /^deleteButtons/.test(x.handler)) ?? null;
  },
  // Nekro Technological Singularity: once the combat is over (a unit of theirs was destroyed in it), copy a tech.
  nekroStealTech: (c) => {
    const o = byStep(c, "nekroStealTech");
    const pos = tileFor(c);
    return pos && c.state?.combat?.tile === pos ? null : o;
  },
  // Propagation: the 3 command tokens.
  propagationResearch: (c) => byStep(c, "propagationGainCC") ?? first(c),
  propagationGainCC: (c) => byStep(c, "propagationGainCC"),
  // Free gains.
  placeGhostCommanderFF: (c) => byStep(c, "placeGhostCommanderFF"),
  assimilate: (c) => byStep(c, "assimilate"),
};

export function chooseFactionB(d: Decision, state: GameState | null, me: string): { option: Option<any>; why: string } | null | undefined {
  if (d.kind !== "leader.use" && d.kind !== "faction.ability") return undefined;
  if (d.scope !== "player" || d.target?.userId !== me) return undefined;
  const opts = (d.options as Opt[]).filter((o) => !o.disabled && !o.needsInput && (!o.owner || o.owner.userId === me));
  const steps = typed(opts).map((o) => o.value!.step);
  const step = steps.find((s) => FACTION_B_STEPS[s]);
  if (!step) return undefined;
  const pick = FACTION_B_STEPS[step]({ d, opts, state, me });
  return pick ? { option: pick, why: `${d.kind} ${step}: faction policy (Creuss/L1Z1X/Mentak/Naalu/Nekro/Sardakk)` } : null;
}
