import { useMemo } from "react";
import { UnstyledButton } from "@mantine/core";
import { IconCheck } from "@tabler/icons-react";
import type { PaymentPayload, PaymentPlanetValue, PaymentSpend } from "../../../../../shim/src/engine/kinds/production";
import { isPaymentDone, planPayment } from "./model";
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
};

const valueOf = (p: PaymentPlanetValue, inf: boolean) => (inf ? p.influence : p.resources);

/**
 * payment.spend: planets (values include attachments), trade goods, commodities (only with the Keleres agent) and
 * Sarween Tools, answered as ONE payload the engine validates (never less than the cost it knows) and executes
 * atomically. Nothing is applied until Pay, so a reload loses nothing: the panel re-reads the engine's progress.
 */
export function PaymentRenderer({ decision, state, answer, pendingOptionId }: AreaRendererProps<PaymentSpend>) {
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
  const short = cost !== null && total < cost;
  const busy = !!pendingOptionId;
  const extras = options.filter((o) => !o.value && !o.disabled);
  const reset = options.find((o) => o.value && "action" in o.value && o.value.action === "reset");

  const toggle = (id: string) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    edit({ planets: [...next] });
  };
  const pay = () => {
    if (!doneOpt || short) return;
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
              <span className={classes.grow}>{p.planet}</span>
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
        <UnstyledButton className={classes.commit} onClick={pay} disabled={busy || !doneOpt || short}>
          {short ? `${cost - total} ${unit} short` : spending > 0 ? `Pay ${spending} ${unit}` : "Done — pay nothing more"}
        </UnstyledButton>
      </DecisionFooter>
    </div>
  );
}
