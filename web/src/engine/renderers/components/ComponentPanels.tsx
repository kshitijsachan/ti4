import { Loader, UnstyledButton } from "@mantine/core";
import cx from "clsx";
import type { ReactNode } from "react";
import type {
  ChooseDecision,
  ComponentAction,
  RelicUse,
  TechStep,
} from "../../../../../shim/src/engine/kinds/components";
import type { GameState, Option } from "../../../../../shim/src/engine/types";
import { strategyCardName } from "../tactical/names";
import { unavailableReason } from "../explore/types";
import { sourceName } from "../../sourceNames";
import classes from "./components.module.css";
import { engineStore } from "../../store";

export type RendererProps<D> = {
  decision: D;
  state: GameState | null;
  answer: (optionIdOrPayload: string) => unknown;
  pendingOptionId?: string | null;
};

const live = <V,>(o: Option<V>) => !o.disabled && !o.needsInput;

export { sourceName };

function Choice({
  option,
  pendingOptionId,
  answer,
  quiet,
  children,
}: {
  option: Option<unknown>;
  pendingOptionId?: string | null;
  answer: (id: string) => unknown;
  quiet?: boolean;
  children: ReactNode;
}) {
  const pending = pendingOptionId === option.id;
  // A use the player cannot make right now (engine value.unavailable, e.g. the card is exhausted): greyed out with
  // the reason; it enables by itself when the engine re-reads it as usable.
  const reason = unavailableReason(option);
  return (
    <UnstyledButton
      className={cx(classes.option, quiet && classes.quiet)}
      disabled={!live(option) || !!pendingOptionId || !!reason}
      data-pending={pending || undefined}
      data-unavailable={reason ? true : undefined}
      aria-busy={pending}
      title={reason ?? undefined}
      onClick={() => answer(option.id)}
    >
      {pending && <Loader size={12} color="currentColor" />}
      <span>{children}</span>
      {reason && <span className={classes.reason}>{reason}</span>}
    </UnstyledButton>
  );
}

/** Options without a typed value (Cancel, Decline, Done): shown last, quiet. */
function Rest({ options, pendingOptionId, answer }: { options: Option<unknown>[]; pendingOptionId?: string | null; answer: (id: string) => unknown }) {
  const rest = options.filter((o) => !o.value);
  if (!rest.length) return null;
  return (
    <div className={classes.row}>
      {rest.map((o) => (
        <Choice key={o.id} option={o} pendingOptionId={pendingOptionId} answer={answer} quiet>
          {o.label || "Cancel"}
        </Choice>
      ))}
    </div>
  );
}

function factionLabel(state: GameState | null, faction: string | null | undefined): string {
  if (!faction) return "";
  const p = state?.players.find((x) => x.faction === faction);
  return p ? `${faction} (${p.userName})` : faction;
}

type ChooseValue = NonNullable<ChooseDecision["options"][number]["value"]>;

const str = (x: unknown): string => (typeof x === "string" || typeof x === "number" ? String(x) : "");
const cap = (x: string) => x.replace(/^\w/, (c) => c.toUpperCase());

function cardText(a: Record<string, unknown>): string {
  if (a.cardName) return str(a.cardName);
  const relic = str(a.relicName) || str(a.relic);
  if (a.relic2Name) return `${relic} ⇄ ${str(a.relic2Name)}`;
  if (relic) return a.faction ? `${relic} (${str(a.faction)})` : relic;
  if (a.trait) return `${cap(str(a.trait))} deck`;
  if (typeof a.position === "number") return `Card #${a.position + 1}`;
  return str(a.card) || str(a.choice);
}

const JR_CHOICES: Record<string, string> = { sd: "Place a space dock", pds: "Place a PDS", monument: "Place a monument", tg: "Gain 1 trade good" };

const sc = (n: unknown) => (typeof n === "number" ? strategyCardName(n) : "");

/** choose.confirm options whose text depends on the source (else the choice, else Yes/No). */
function confirmText(a: Record<string, unknown>, state: GameState | null): string {
  switch (a.source) {
    case "jrxs455o":
      return JR_CHOICES[str(a.choice)] ?? "";
    case "imperialarbiter":
      return a.confirm ? "Swap strategy cards" : "Decline";
    case "minister_peace":
      return "End the active player's turn";
    case "mahactagent":
    case "scepter_of_emelpar":
    case "cognitive_parallax_engine":
      return `Follow ${sc(a.strategyCard)}`;
    case "warfare":
      return a.choice === "tactical" ? "Perform the tactical action" : "Redistribute command tokens";
    case "ixthian_artifact":
      return a.choice === "ignore_speaker" ? "Roll anyway" : "Roll";
    case "spend_objective_tokens": {
      const s = typeof a.strategy === "number" ? a.strategy : 0;
      const t = typeof a.tactic === "number" ? a.tactic : 0;
      return [s ? `${s} from strategy` : "", t ? `${t} from tactic` : ""].filter(Boolean).join(" + ");
    }
    case "pay_debt": {
      const n = typeof a.amount === "number" ? a.amount : 1;
      const to = factionLabel(state, str(a.faction));
      if (a.choice === "debt") return `Erase ${n} debt owed to ${to}`;
      return `Send ${n} ${a.choice === "tg" ? (n === 1 ? "trade good" : "trade goods") : n === 1 ? "commodity" : "commodities"} to ${to}`;
    }
    default:
      return "";
  }
}

/** choose.player: the player, plus what they get (a strategy card swap / gift, a planet). */
function playerText(a: Record<string, unknown>, state: GameState | null): string {
  const who = factionLabel(state, str(a.faction));
  if (a.source === "imperialarbiter" && typeof a.strategyCard === "number")
    return `${who}: their ${sc(a.strategyCard)} for our ${sc(a.strategyCard2)}`;
  if (a.planet) return `${who} (${str(a.planetName) || str(a.planet)})`;
  return who;
}

/** One line for a typed choose.* option, from its value only. */
function chooseText(kind: string, v: ChooseValue, state: GameState | null): string {
  const a = v as unknown as Record<string, unknown>;
  const at = (where: unknown) => (str(where) ? ` (${str(where)})` : "");
  switch (kind) {
    case "choose.planet":
      return `${str(a.planetName) || str(a.planet)}${at(a.tile)}`;
    case "choose.system":
      return `${str(a.tileName) || str(a.tile) || str(a.tileId)}${at(a.tile)}`;
    case "choose.player":
      return playerText(a, state);
    case "choose.unit":
      return `${a.damaged ? "Damaged " : ""}${str(a.unit)}${at(str(a.planetName) || str(a.tile))}`;
    case "choose.card":
      return cardText(a);
    case "choose.confirm":
      return confirmText(a, state) || str(a.choice) || (a.confirm ? "Yes" : "No");
    default:
      return "";
  }
}

/** Every choose.* kind: heading from the source, one button per typed option, then Cancel/Decline. */
export function ChoosePanel({ decision, state, answer, pendingOptionId }: RendererProps<ChooseDecision>) {
  const opts = decision.options as Option<ChooseValue>[];
  const first = opts.find((o) => o.value)?.value;
  const relic = first && (first as unknown as Record<string, unknown>).relicText;
  return (
    <div className={classes.root}>
      <div className={classes.heading}>{sourceName(first?.source) || "Choose"}</div>
      {decision.kind === "choose.card" && typeof relic === "string" && opts.filter((o) => o.value).length === 1 && (
        <div className={classes.text}>{relic}</div>
      )}
      <div className={classes.row}>
        {opts
          .filter((o) => o.value)
          .map((o) => (
            <Choice key={o.id} option={o} pendingOptionId={pendingOptionId} answer={answer}>
              {chooseText(decision.kind, o.value!, state)}
            </Choice>
          ))}
      </div>
      <Rest options={opts} pendingOptionId={pendingOptionId} answer={answer} />
      {redistributeOnly(opts) && (
        <div className={classes.row}>
          {/* Optional (Warfare: "you may redistribute"): set aside, it waits behind "Available now". */}
          <UnstyledButton className={cx(classes.option, classes.quiet)} onClick={() => engineStore.getState().defer(decision.id)} disabled={!!pendingOptionId}>
            <span>Skip — keep my tokens as they are</span>
          </UnstyledButton>
        </div>
      )}
    </div>
  );
}

/** Warfare's redistribute offer with nothing else on it (after its tactical action): optional. */
function redistributeOnly(opts: Option<ChooseValue>[]): boolean {
  const typed = opts.filter((o) => o.value);
  return typed.length > 0 && typed.every((o) => (o.value as unknown as Record<string, unknown>).source === "warfare" && (o.value as unknown as Record<string, unknown>).choice === "redistribute");
}

const GROUPS: [string, (c: string) => boolean][] = [
  ["Technologies", (c) => c === "tech"],
  ["Leaders", (c) => c === "leader"],
  ["Relics", (c) => c === "relic" || c === "getRelic"],
  ["Promissory notes", (c) => c === "pn"],
  ["Abilities and other", () => true],
];

const COMPONENT_NAMES: Record<string, string> = {
  getRelic: "Purge fragments for a relic",
  generic: "Generic component action",
  doStarCharts: "Purge 2 Star Charts",
  doMutagens: "Purge 2 Mutagens",
  doVolatileMutagenics: "Purge Volatile Mutagenics",
  doTotalWarPoint: "Gain 1 VP (Total War)",
  stellarAtomicsAction: "Stellar Atomics",
  mercenariesForHireAction: "Mercenaries for Hire",
  absolMOW: "Minister of War",
  turnInBounty: "Turn in bounty",
};

/** The component action menu, grouped by component type. */
export function ComponentActionPanel({ decision, answer, pendingOptionId }: RendererProps<ComponentAction>) {
  const typed = (decision.options).filter((o) => o.value);
  const used = new Set<string>();
  return (
    <div className={classes.root}>
      <div className={classes.heading}>Component action</div>
      {GROUPS.map(([title, test]) => {
        const group = typed.filter((o) => !used.has(o.id) && test(o.value!.component));
        group.forEach((o) => used.add(o.id));
        if (!group.length) return null;
        return (
          <div key={title} className={classes.group}>
            <div className={classes.sub}>{title}</div>
            <div className={classes.row}>
              {group.map((o) => (
                <Choice key={o.id} option={o} pendingOptionId={pendingOptionId} answer={answer}>
                  {o.value!.name ?? COMPONENT_NAMES[o.value!.component] ?? sourceName(o.value!.id ?? o.value!.component)}
                  {o.value!.leaderType ? ` (${o.value!.leaderType})` : ""}
                </Choice>
              ))}
            </div>
          </div>
        );
      })}
      <Rest options={decision.options as Option<unknown>[]} pendingOptionId={pendingOptionId} answer={answer} />
    </div>
  );
}

const RELIC_EFFECT: Record<string, string> = {
  exhaust: "Exhaust",
  use: "Use",
  draw_action_card: "Draw an action card",
  tech_skip: "Technology skip",
  look_explore_decks: "Look at the exploration decks",
  look_relic_deck: "Look at the relic deck",
  move_from_command_token_systems: "Move ships from systems with your tokens",
  purge_for_technology: "Purge: exhaust all planets, gain a technology",
  purge_for_point: "Purge for 1 victory point",
};

/** A relic use offer. */
export function RelicUsePanel({ decision, answer, pendingOptionId }: RendererProps<RelicUse>) {
  const typed = (decision.options).filter((o) => o.value);
  const first = typed[0]?.value;
  return (
    <div className={classes.root}>
      <div className={classes.heading}>{first?.relicName ?? "Relic"}</div>
      {first?.relicText && <div className={classes.text}>{first.relicText}</div>}
      <div className={classes.row}>
        {typed.map((o) => (
          <Choice key={o.id} option={o} pendingOptionId={pendingOptionId} answer={answer}>
            {RELIC_EFFECT[o.value!.effect] ?? o.value!.effect}
            {o.value!.relicName && o.value!.relicName !== first?.relicName ? ` — ${o.value!.relicName}` : ""}
          </Choice>
        ))}
      </div>
      <Rest options={decision.options as Option<unknown>[]} pendingOptionId={pendingOptionId} answer={answer} />
    </div>
  );
}

type TechStepValue = NonNullable<TechStep["options"][number]["value"]>;

/** One line for a tech.step option, from its value only. */
function techStepText(v: TechStepValue): string {
  const where = str(v.planetName) || str(v.planet) || str(v.tileName) || str(v.tile);
  switch (v.step) {
    case "exhaust":
      return `Exhaust ${str(v.techName) || str(v.tech)}`;
    case "ready":
      return `Ready ${v.target === "tech" ? str(v.targetTechName) || str(v.tech) : where}`;
    case "target":
      return `${cap(str(v.unit).replace(/(damaged|galvanized)/g, " ($1)"))}${v.color ? ` (${str(v.color)})` : ""}`;
    case "use":
      return `Use ${str(v.techName) || sourceName(v.source)}${where ? ` on ${where}` : ""}`;
    case "open":
      return `Use ${str(v.techName) || sourceName(v.source)}`;
    case "exhaust_planet":
      return `Exhaust ${where} for 1 trade good`;
    case "research":
      return v.unitUpgradeOnly ? "Research a unit upgrade" : "Research a technology";
    case "gain":
      return `Gain ${str(v.targetTechName) || str(v.tech)}`;
    default:
      return where || str(v.techName) || str(v.source);
  }
}

/** A generic technology's follow-up step: heading from the tech, one button per typed option, then Decline/Done. */
export function TechStepPanel({ decision, answer, pendingOptionId }: RendererProps<TechStep>) {
  const opts = decision.options;
  const typed = opts.filter((o) => o.value);
  const names = [...new Set(typed.map((o) => (o.value!.step === "exhaust" ? "" : str(o.value!.techName) || sourceName(o.value!.source))))].filter(Boolean);
  return (
    <div className={classes.root}>
      <div className={classes.heading}>{names.length === 1 ? names[0] : "Technology"}</div>
      <div className={classes.row}>
        {typed.map((o) => (
          <Choice key={o.id} option={o} pendingOptionId={pendingOptionId} answer={answer}>
            {techStepText(o.value!)}
          </Choice>
        ))}
      </div>
      <Rest options={opts as Option<unknown>[]} pendingOptionId={pendingOptionId} answer={answer} />
    </div>
  );
}
