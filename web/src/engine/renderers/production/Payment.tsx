import { planetName } from "../tactical/names";
import { useMemo } from "react";
import { UnstyledButton } from "@mantine/core";
import { IconCheck } from "@tabler/icons-react";
import type { ObjectiveCost, PaymentDoneValue, PaymentPayload, PaymentPlanetValue, PaymentSpend } from "../../../../../shim/src/engine/kinds/production";
import type { PlanetId } from "../../../../../shim/src/engine/types";
import { isPaymentDone, planObjectivePayment, planPayment } from "./model";
import { ExtraOptions, Meter, selfOf, Stepper, type AreaRendererProps } from "./shared";
import classes from "./production.module.css";
import { useDecisionState } from "../../draftState";
import { DecisionFooter } from "../../ui/Popup";

const CONTEXT_TITLE: Record<string, string> = {
  tacticalAction: "Pay for the units you produced",
  warfare: "Pay for the units you produced (Warfare)",
  construction: "Pay for Construction",
  technology: "Pay for research",
  leadership: "Spend influence for command tokens (Leadership)",
  poscore: "Pay to score the objective",
};

const valueOf = (p: PaymentPlanetValue, inf: boolean) => (inf ? p.influence : p.resources);

/**
 * payment.spend: planets (values include attachments), trade goods, commodities (only with the Keleres agent) and
 * Sarween Tools, answered as ONE payload the engine validates (never less than the cost it knows) and executes
 * atomically. Nothing is applied until Pay, so a reload loses nothing: the panel re-reads the engine's progress.
 */
export function PaymentRenderer(props: AreaRendererProps<PaymentSpend>) {
  const done = props.decision.options.map((o) => o.value).find(isPaymentDone);
  if (done?.context === "poscore" && done.objectiveCost) return <ObjectivePayment {...props} done={done} cost={done.objectiveCost} />;
  return <BillPayment {...props} />;
}

function BillPayment({ decision, state, answer, pendingOptionId }: AreaRendererProps<PaymentSpend>) {
  const options = decision.options;
  const doneOpt = options.find((o) => isPaymentDone(o.value));
  const done = doneOpt && isPaymentDone(doneOpt.value) ? doneOpt.value : undefined;
  const me = selfOf(state);
  const req = (decision.progress?.required ?? {}) as { cost?: number | null; remaining?: number | null };
  const cost = req.cost ?? done?.cost ?? null;
  const inf = done?.currency === "inf";
  const unit = inf ? "influence" : "resources";
  const counted = cost !== null && typeof req.remaining === "number" ? cost - req.remaining : inf ? (done?.spentInfluence ?? 0) : (done?.spentResources ?? 0);
  const exhausted = new Set(me?.exhaustedPlanets ?? []);
  const planets = options.flatMap((o) => (o.value && "source" in o.value && o.value.source === "planet" ? [o.value] : [])).filter((p) => !exhausted.has(p.planet));
  const hasTg = options.some((o) => o.value && "source" in o.value && o.value.source === "tg");
  const commOffered = !!done?.keleresAgent && options.some((o) => o.value && "source" in o.value && o.value.source === "commodities");
  const sarweenOffered = options.some((o) => o.value && "source" in o.value && o.value.source === "discount");
  const tgMax = hasTg ? (me?.tg ?? 0) : 0;
  const commMax = commOffered ? (me?.commodities ?? 0) : 0;
  const worth = done?.tgValue ?? 1;

  const suggested = useMemo<PaymentPayload>(() => planPayment(decision, state, me?.userId ?? "")?.payload ?? { planets: [], sarween: sarweenOffered }, [decision, state, me?.userId, sarweenOffered]);
  const [manual, setManual] = useDecisionState<PaymentPayload | null>(decision.id, "manual", null);
  const pick = manual ?? suggested;
  const chosen = new Set(pick.planets);
  const edit = (patch: Partial<PaymentPayload>) => setManual({ ...pick, ...patch });

  const planetSum = planets.filter((p) => chosen.has(p.planet)).reduce((n, p) => n + valueOf(p, inf), 0);
  const total = counted + planetSum + ((pick.tg ?? 0) + (pick.commodities ?? 0)) * worth + (pick.sarween ? 1 : 0);
  /* Everything offered is in the answer: the engine lets Done finish a bill that cannot be covered. */
  const spendsAll =
    planets.every((p) => valueOf(p, inf) <= 0 || chosen.has(p.planet)) &&
    (pick.tg ?? 0) >= tgMax &&
    (pick.commodities ?? 0) >= commMax &&
    (!sarweenOffered || !!pick.sarween);
  const short = cost !== null && total < cost;
  const blocked = short && !spendsAll;
  const busy = !!pendingOptionId;
  const extras = options.filter((o) => !o.value && !o.disabled);
  const reset = options.find((o) => o.value && "action" in o.value && o.value.action === "reset");

  const toggle = (id: PlanetId) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    edit({ planets: [...next] });
  };
  const pay = () => {
    if (!doneOpt || blocked) return;
    answer({ optionId: doneOpt.id, payload: { ...pick } as Record<string, unknown> });
  };

  const spending = total - counted;
  return (
    <div className={classes.panel}>
      <div className={classes.head}>
        <span className={classes.title}>{CONTEXT_TITLE[done?.context ?? ""] ?? (inf ? "Spend influence" : "Spend resources")}</span>
        {done?.tech && <span className={classes.muted}>Technology research</span>}
      </div>
      <Meter have={total} need={cost} unit={unit} />
      {counted > 0 && (
        <span className={classes.muted}>
          {counted} {unit} already counted on this payment.{" "}
          {reset && (
            <UnstyledButton className={classes.link} onClick={() => answer(reset.id)} disabled={busy}>
              Start over
            </UnstyledButton>
          )}
        </span>
      )}
      {sarweenOffered && (
        <UnstyledButton role="switch" aria-checked={!!pick.sarween} className={classes.toggle} onClick={() => edit({ sarween: !pick.sarween })} disabled={busy}>
          <span className={classes.check}>{pick.sarween && <IconCheck size={12} />}</span>
          <span className={classes.grow}>Sarween Tools</span>
          <span className={classes.muted}>−1</span>
        </UnstyledButton>
      )}
      {planets.length > 0 && (
        <div className={classes.grid} role="group" aria-label="Planets to exhaust">
          {planets.map((p) => (
            <UnstyledButton key={p.planet} role="checkbox" aria-checked={chosen.has(p.planet)} className={classes.tile} onClick={() => toggle(p.planet)} disabled={busy}>
              <span className={classes.check}>{chosen.has(p.planet) && <IconCheck size={12} />}</span>
              <span className={classes.grow}>{planetName(p.planet)}</span>
              <span className={inf ? classes.inf : classes.res}>{valueOf(p, inf)}</span>
            </UnstyledButton>
          ))}
        </div>
      )}
      {tgMax > 0 && (
        <Stepper
          label="Trade goods"
          value={pick.tg ?? 0}
          max={tgMax}
          onChange={(n) => edit({ tg: n })}
          hint={`you have ${tgMax}${worth > 1 ? " · worth 2 each (Mirror Computing)" : ""}`}
          disabled={busy}
        />
      )}
      {commMax > 0 && (
        <Stepper
          label="Commodities"
          value={pick.commodities ?? 0}
          max={commMax}
          onChange={(n) => edit({ commodities: n })}
          hint={`as trade goods via the Keleres agent (exhausts it) · you have ${commMax}`}
          disabled={busy}
        />
      )}
      <div className={classes.row}>
        <UnstyledButton className={classes.link} onClick={() => setManual(null)} disabled={busy}>
          Suggest
        </UnstyledButton>
        <UnstyledButton className={classes.link} onClick={() => setManual({ planets: [], tg: 0, commodities: 0, sarween: false })} disabled={busy}>
          Clear
        </UnstyledButton>
      </div>
      <ExtraOptions options={extras} answer={answer} busy={busy} />
      <DecisionFooter>
        <UnstyledButton className={classes.commit} onClick={pay} disabled={busy || !doneOpt || blocked}>
          {blocked
            ? `${cost - total} ${unit} short`
            : short
              ? `Pay all you have (${cost - total} ${unit} short)`
              : spending > 0
                ? `Pay ${spending} ${unit}`
                : "Done — pay nothing more"}
        </UnstyledButton>
      </DecisionFooter>
    </div>
  );
}

const OBJECTIVE_NAME: Record<string, string> = {
  monument: "Erect a Monument",
  golden_age: "Found a Golden Age",
  sway_council: "Sway the Council",
  manipulate_law: "Manipulate Galactic Law",
  amass_wealth: "Amass Wealth",
  vast_reserves: "Hold Vast Reserves",
};

/**
 * A spend objective (Amass Wealth, Erect a Monument, ...) is paid first and scored by the same press: each planet
 * counts its resources or its influence, trade goods beyond the ones it asks for count toward either. Score stays
 * greyed, with what is missing, until the selection covers it; "Don't score it" gives back what was spent.
 */
function ObjectivePayment({ decision, state, answer, pendingOptionId, done, cost }: AreaRendererProps<PaymentSpend> & { done: PaymentDoneValue; cost: ObjectiveCost }) {
  const options = decision.options;
  const doneOpt = options.find((o) => isPaymentDone(o.value));
  const cancel = options.find((o) => o.value && "action" in o.value && o.value.action === "cancel");
  const me = selfOf(state);
  const exhausted = new Set(me?.exhaustedPlanets ?? []);
  const planets = options.flatMap((o) => (o.value && "source" in o.value && o.value.source === "planet" ? [o.value] : [])).filter((p) => !exhausted.has(p.planet));
  const hasTg = options.some((o) => o.value && "source" in o.value && o.value.source === "tg");
  const tgMax = hasTg ? (me?.tg ?? 0) : 0;
  const worth = done.tgValue ?? 1;
  const pool = useMemo(() => planets.map((p) => ({ id: p.planet, resources: p.resources, influence: p.influence })), [planets]);
  const suggested = useMemo<PaymentPayload>(() => planObjectivePayment(cost, pool, tgMax, worth) ?? { planets: [], tg: cost.tg }, [cost, pool, tgMax, worth]);
  const [manual, setManual] = useDecisionState<PaymentPayload | null>(decision.id, "manual", null);
  const pick = manual ?? suggested;
  const chosen = new Set(pick.planets);
  const edit = (patch: Partial<PaymentPayload>) => setManual({ ...pick, ...patch });
  const toggle = (id: PlanetId) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    edit({ planets: [...next] });
  };
  const tg = pick.tg ?? 0;
  const covered = !!planObjectivePayment(cost, pool.filter((p) => chosen.has(p.id)), tg, worth, { fixedTg: tg });
  const res = pool.filter((p) => chosen.has(p.id)).reduce((n, p) => n + p.resources, 0);
  const inf = pool.filter((p) => chosen.has(p.id)).reduce((n, p) => n + p.influence, 0);
  const busy = !!pendingOptionId;
  const name = OBJECTIVE_NAME[done.objective ?? ""] ?? "the objective";
  const missing = [
    tg < cost.tg ? `${cost.tg - tg} more trade goods` : "",
    !covered && tg >= cost.tg ? `planets worth ${cost.resources ? `${cost.resources} resources` : ""}${cost.resources && cost.influence ? " and " : ""}${cost.influence ? `${cost.influence} influence` : ""}` : "",
  ].filter(Boolean);
  const score = () => {
    if (!doneOpt || !covered) return;
    answer({ optionId: doneOpt.id, payload: { ...pick } as Record<string, unknown> });
  };
  return (
    <div className={classes.panel}>
      <div className={classes.head}>
        <span className={classes.title}>Pay to score {name}</span>
        <span className={classes.muted}>
          {[cost.influence ? `${cost.influence} influence` : "", cost.resources ? `${cost.resources} resources` : "", cost.tg ? `${cost.tg} trade goods` : ""].filter(Boolean).join(", ")}
        </span>
      </div>
      <span className={classes.muted}>Each planet counts its resources or its influence, not both. Selected: {res} resources / {inf} influence on the planets.</span>
      {planets.length > 0 && (
        <div className={classes.grid} role="group" aria-label="Planets to exhaust">
          {planets.map((p) => (
            <UnstyledButton key={p.planet} role="checkbox" aria-checked={chosen.has(p.planet)} className={classes.tile} onClick={() => toggle(p.planet)} disabled={busy}>
              <span className={classes.check}>{chosen.has(p.planet) && <IconCheck size={12} />}</span>
              <span className={classes.grow}>{planetName(p.planet)}</span>
              {cost.resources > 0 && <span className={classes.res}>{p.resources}</span>}
              {cost.influence > 0 && <span className={classes.inf}>{p.influence}</span>}
            </UnstyledButton>
          ))}
        </div>
      )}
      {tgMax > 0 && (
        <Stepper
          label="Trade goods"
          value={tg}
          max={tgMax}
          onChange={(n) => edit({ tg: n })}
          hint={`${cost.tg ? `${cost.tg} required · ` : ""}you have ${tgMax}${worth > 1 ? " · extra worth 2 each (Mirror Computing)" : ""}`}
          disabled={busy}
        />
      )}
      <div className={classes.row}>
        <UnstyledButton className={classes.link} onClick={() => setManual(null)} disabled={busy}>
          Suggest
        </UnstyledButton>
        {cancel && (
          <UnstyledButton className={classes.link} onClick={() => answer(cancel.id)} disabled={busy}>
            Don&apos;t score it
          </UnstyledButton>
        )}
      </div>
      <DecisionFooter>
        <UnstyledButton className={classes.commit} onClick={score} disabled={busy || !doneOpt || !covered}>
          {covered ? `Pay and score ${name}` : `Not enough: ${missing.join(", ")}`}
        </UnstyledButton>
      </DecisionFooter>
    </div>
  );
}
