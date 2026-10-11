import type { DecisionOf, GameState } from "../../contract";
import type { EngineRendererProps } from "../../registry";
import { AnswerButton, ExtraOptions, Head } from "../cards/parts";
import { getTechData } from "@/entities/lookup/tech";
import { planetName, playerLabel } from "../cards/labels";
import classes from "../cards/Cards.module.css";

type FactionKind = "leader.use" | "faction.ability";
type Value = NonNullable<DecisionOf<FactionKind>["options"][number]["value"]>;

const UNIT: Record<string, string> = {
  gf: "Infantry",
  mf: "Mech",
  ff: "Fighter",
  dd: "Destroyer",
  ca: "Cruiser",
  cv: "Carrier",
  dn: "Dreadnought",
  fs: "Flagship",
  ws: "War Sun",
  pd: "PDS",
  sd: "Space Dock",
};

const words = (id: string) =>
  id
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());

function componentName(v: Value): string {
  if ("leader" in v) return `${words(v.leader.replace(v.faction ?? "", ""))} (${words(v.faction ?? "")})`;
  return words(v.id);
}

/** Button text from the typed fields: target player, planet, system, unit, amounts. */
function optionLabel(state: GameState | null, v: Value): string {
  const parts: string[] = [];
  if (v.action === "skip") parts.push("Finish");
  if (v.reset) return "Start over";
  if (v.hits) parts.push(`${v.hits} hit${v.hits > 1 ? "s" : ""}`);
  if (v.unit) parts.push(`${v.count && v.count > 1 ? `${v.count} ` : ""}${v.damaged ? "damaged " : ""}${UNIT[v.unit] ?? v.unit}`);
  if (v.techOut) parts.push(`swap out ${getTechData(v.techOut)?.name ?? v.techOut}`);
  if (v.tech) parts.push(`${v.techOut ? "for " : ""}${getTechData(v.tech)?.name ?? v.tech}`);
  if (v.what) parts.push(`look at ${{ ac: "action cards", pn: "promissory notes", so: "secret objectives" }[v.what]}`);
  if (v.who) parts.push(v.who === "self" ? "look and choose yourself" : "Yssaril chooses for you");
  if (v.cardName ?? v.actionCard) parts.push(String(v.cardName ?? v.actionCard));
  if (v.target) parts.push(playerLabel(state, v.target));
  if (v.planet) parts.push(planetName(v.planet));
  else if (v.holder === "space") parts.push("space");
  if (v.tile) parts.push(`System ${v.tile}`);
  const extra = v as Value & { wormhole?: string; what?: string; tech?: string; pn?: string };
  if (extra.wormhole) parts.push(`${words(extra.wormhole)} wormhole`);
  if (extra.what) parts.push(extra.what === "tg" ? "take 1 trade good" : "take 1 commodity");
  if (extra.tech) parts.push(`technology ${extra.tech}`);
  if (extra.pn) parts.push(`note ${extra.pn}`);
  if (v.from) parts.push(`from ${planetName(v.from)}`);
  if (v.strategyCard != null) parts.push(`take strategy card ${v.strategyCard}`);
  if (v.amount) parts.push(`+${v.amount}`);
  if (v.cost) parts.push(`costs ${v.cost}`);
  if (v.free) parts.push("free");
  if (!parts.length) parts.push(v.action === "use" ? `Use ${words(v.step)}` : words(v.step));
  return parts.join(" · ");
}

/** leader.use / faction.ability: one list of typed choices for the leader or ability, then Decline / Done. */
export function FactionStep({ decision, state, answer, pendingOptionId }: EngineRendererProps<DecisionOf<FactionKind>>) {
  const typed = decision.options.filter((o) => o.value);
  const first = typed[0]?.value as Value | undefined;
  const title = first ? componentName(first) : decision.kind === "leader.use" ? "Leader" : "Faction ability";
  const meta = first ? ("leaderType" in first ? first.leaderType : first.source) : undefined;
  return (
    <div className={classes.root}>
      <Head title={title} meta={meta} />
      <div className={classes.options}>
        {typed.map((o) => (
          <AnswerButton
            key={o.id}
            option={o}
            label={optionLabel(state, o.value as Value)}
            tone={(o.value as Value).action === "skip" ? "plain" : "go"}
            pendingOptionId={pendingOptionId}
            onAnswer={answer}
          />
        ))}
      </div>
      <ExtraOptions options={decision.options} pendingOptionId={pendingOptionId} onAnswer={answer} />
    </div>
  );
}
