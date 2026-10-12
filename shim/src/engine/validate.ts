/**
 * Boundary check of the engine contract's id unions (ids.ts): walks an incoming GameState / Decision and reports
 * every id outside its union — a homebrew faction, a renamed card, a phase spelled differently, a field the Java side
 * started filling with something else. It never throws and never changes the data: it is a drift detector, not a
 * gate. Each (family, id) is reported once per process.
 *
 * On by default; off when NODE_ENV=production unless ENGINE_VALIDATE=1; ENGINE_VALIDATE=0 turns it off anywhere.
 * Dependency-free (the web can use it with its own reporter).
 */
import { is } from "./ids.js";

type Family = Exclude<keyof typeof is, "strategyCardNumber"> | "holder";

/** Object keys whose string values (or string array elements) are ids of one family, wherever they appear. */
const STRING_FIELDS: Record<string, Family> = {
  faction: "faction",
  factions: "faction",
  holderFaction: "faction",
  playedBy: "faction",
  planetOwner: "faction",
  ownerFaction: "faction",
  owner: "faction",
  mayTransactWith: "faction",
  spaceCannonOffence: "faction",
  color: "color",
  ownerColor: "color",
  planet: "planet",
  planets: "planet",
  exhaustedPlanets: "planet",
  tech: "tech",
  techs: "tech",
  exhaustedTechs: "tech",
  unit: "unit",
  tileId: "tile",
  holder: "holder",
  actionCard: "actionCard",
  secretObjective: "secretObjective",
  scorableSecrets: "secretObjective",
  objective: "publicObjective",
  agendaId: "agenda",
  agenda: "agenda",
  laws: "agenda",
  relic: "relic",
  relics: "relic",
  promissoryNote: "promissoryNote",
  promissoryNotes: "promissoryNote",
  promissoryNotesInPlayArea: "promissoryNote",
  excludedGivePromissoryNotes: "promissoryNote",
  leader: "leader",
  leaders: "leaderStatus",
  fragment: "relicFragment",
  fragments: "relicFragment",
  discard: "exploreCard",
  rejected: "exploreCard",
  breakthrough: "breakthrough",
  publicScored: "publicObjective",
  secretScored: "secretObjective",
};

/** Keys whose numbers (or number array elements) are strategy card numbers. */
const NUMBER_FIELDS = new Set(["strategyCard", "strategyCards", "queued"]);

/** Plain-object maps whose KEYS are ids. */
const KEYED_MAPS: Record<string, Family> = {
  actionCards: "actionCard",
  secretObjectives: "secretObjective",
  secretsScored: "secretObjective",
  promissoryNotes: "promissoryNote",
  breakthroughs: "faction",
  produced: "unit",
};

/**
 * Arrays of card references ({id, name, text?, ownerFaction?, …}: TradeModels.CardRef in trade.me / counterparties):
 * the element's `id` is the id, not a key of a map. The same field names hold id-keyed maps in Hand.
 */
const REF_ARRAYS: Record<string, Family> = {
  actionCards: "actionCard",
  promissoryNotes: "promissoryNote",
  secretObjectives: "secretObjective",
  relics: "relic",
};

/** Values that are not ids but legitimately sit in an id field. */
const ALLOWED = new Set(["none", "any", "pending"]);

/** Map-template placeholder tiles (a seat's colour + 1–6 or "blank") sit on the board until the draft fills it. */
const placeholderTile = (x: string) => {
  const m = /^([a-z]+?)([1-6]|blank)$/.exec(x);
  return !!m && is.color(m[1]);
};

/**
 * Fields that hold another vocabulary in some kinds (strategy_card.resolve unit: "spacedock" / "facility", holder:
 * the holder's faction; strategy_card.construction_place unit: "pds"; action_card.step unit: long names). Keyed by decision-kind prefix.
 */
const KIND_SKIPS: [prefix: string, keys: string[]][] = [
  ["strategy_card.", ["unit", "holder"]],
  ["action_card.step", ["unit"]], // the option id's own unit token (gf or infantry)
  ["setup.player", ["faction"]], // the drafted "keleres" before its flavour is chosen (setupStep2)
];

const check: Record<Family, (x: unknown) => boolean> = {
  ...is,
  holder: (x) => x === "space" || is.planet(x),
};

export type DriftReporter = (message: string) => void;

export interface Validator {
  enabled: boolean;
  state(state: unknown, where: string): void;
  decision(decision: unknown, where: string): void;
  /** "family:id" → times seen (each is reported once). */
  readonly seen: Map<string, number>;
}

function defaultEnabled(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  if (env.ENGINE_VALIDATE === "0") return false;
  if (env.ENGINE_VALIDATE === "1") return true;
  return env.NODE_ENV !== "production";
}

export function createValidator(report: DriftReporter, enabled = defaultEnabled()): Validator {
  const seen = new Map<string, number>();

  const flag = (family: string, value: unknown, path: string) => {
    const key = `${family}:${String(value)}`;
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    if (n === 0) report(`engine contract drift: unknown ${family} ${JSON.stringify(value)} at ${path}`);
  };

  const walk = (node: unknown, path: string, key: string, skip: Set<string>, depth: number): void => {
    if (node === null || node === undefined || depth > 12) return;
    if (typeof node === "string") {
      const family = skip.has(key) ? undefined : STRING_FIELDS[key];
      if (family && !ALLOWED.has(node) && !check[family](node) && !(family === "tile" && placeholderTile(node))) flag(family, node, path);
      return;
    }
    if (typeof node === "number") {
      if (NUMBER_FIELDS.has(key) && !is.strategyCardNumber(node)) flag("strategyCardNumber", node, path);
      return;
    }
    if (Array.isArray(node)) {
      const refFamily = skip.has(key) ? undefined : REF_ARRAYS[key];
      node.forEach((x, i) => {
        if (refFamily && x && typeof x === "object" && !Array.isArray(x)) {
          // A card reference: check its id, walk its other fields (ownerFaction, ownerColor) by their own names.
          for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
            if (k === "id") {
              if (typeof v === "string" && !ALLOWED.has(v) && !check[refFamily](v)) flag(refFamily, v, `${path}[${i}].id`);
            } else walk(v, `${path}[${i}].${k}`, k, skip, depth + 2);
          }
          return;
        }
        walk(x, `${path}[${i}]`, key, skip, depth + 1);
      });
      return;
    }
    if (typeof node !== "object") return;
    const mapFamily = KEYED_MAPS[key];
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (mapFamily && !check[mapFamily](k)) flag(mapFamily, k, `${path} key`);
      // Board holders carry their name ("space" / planet id) under `name`; elsewhere `name` is display text.
      if (k === "name" && key === "holders" && typeof v === "string" && !check.holder(v)) flag("holder", v, `${path}.name`);
      walk(v, `${path}.${k}`, mapFamily ? "" : k, skip, depth + 1);
    }
  };

  const guard = (fn: () => void) => {
    if (!v.enabled) return;
    try {
      fn();
    } catch (e) {
      report(`engine contract validator failed: ${(e as Error).message}`);
    }
  };

  const NO_SKIP = new Set<string>();
  const v: Validator = {
    enabled,
    seen,
    state(state, where) {
      guard(() => {
        if (!state || typeof state !== "object") return;
        const s = state as Record<string, unknown>;
        // `phase` is a Game phase only here, in agenda.stage and in trade.phase (status.score_secret's phase is a
        // card's timing); publicObjectives keys may be custom objective names (an open set).
        const phase = (value: unknown, path: string) => {
          if (typeof value === "string" && !is.phase(value)) flag("phase", value, path);
        };
        phase(s.phase, `${where}.phase`);
        phase((s.agenda as Record<string, unknown> | null)?.stage, `${where}.agenda.stage`);
        phase((s.trade as Record<string, unknown> | null)?.phase, `${where}.trade.phase`);
        walk({ ...s, strategyCards: undefined, publicObjectives: undefined }, where, "", NO_SKIP, 0);
        if (Array.isArray(s.strategyCards)) {
          s.strategyCards.forEach((c: Record<string, unknown>, i) => {
            if (!c || typeof c !== "object") return;
            if (!is.strategyCardNumber(c.number)) flag("strategyCardNumber", c.number, `${where}.strategyCards[${i}].number`);
            if (c.card != null && !is.strategyCard(c.card)) flag("strategyCard", c.card, `${where}.strategyCards[${i}].card`);
            // holder is a user id here.
            walk({ ...c, number: undefined, card: undefined, holder: undefined }, `${where}.strategyCards[${i}]`, "", NO_SKIP, 1);
          });
        }
      });
    },
    decision(decision, where) {
      guard(() => {
        if (!decision || typeof decision !== "object") return;
        const d = decision as Record<string, unknown>;
        const kind = typeof d.kind === "string" ? d.kind : "";
        const skip = new Set(KIND_SKIPS.filter(([p]) => kind.startsWith(p)).flatMap(([, keys]) => keys));
        const at = `${where} ${kind || "?"} ${String(d.id ?? "")}`;
        walk(d.target, `${at}.target`, "target", skip, 1);
        if (Array.isArray(d.options)) {
          d.options.forEach((o: Record<string, unknown>, i) => {
            if (o && typeof o === "object") walk(o.value, `${at}.options[${i}].value`, "value", skip, 2);
          });
        }
        // window.subject is an untyped Record (user ids and factions under the same key names): not checked.
        if (d.progress && typeof d.progress === "object") {
          walk((d.progress as Record<string, unknown>).accumulated, `${at}.progress.accumulated`, "accumulated", skip, 2);
        }
      });
    },
  };
  return v;
}
