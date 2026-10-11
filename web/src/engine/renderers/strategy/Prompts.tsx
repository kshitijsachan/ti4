import { useState } from "react";
import type { StrategyCardPick } from "../../../../../shim/src/engine/types";
import type {
  CommandTokenAdjust,
  ConstructionPlace,
  DiplomacySystem,
  PlanetReady,
  PoliticsAgenda,
  PoliticsSpeaker,
  StrategicAction,
  StrategyCardQueuePick,
  TradeReplenish,
} from "../../../../../shim/src/engine/kinds/strategy";
import { Choice, live, Meta, playerName, Title, viewer, type RendererProps } from "./shared";
import classes from "./strategy.module.css";

/** Strategy phase: pick a card (trade goods on it shown). */
export function PickCard({ decision, answer }: RendererProps<StrategyCardPick>) {
  const opts = live(decision.options).filter((o) => o.value);
  return (
    <div className={classes.panel}>
      <Title>Pick a strategy card</Title>
      <div className={classes.choices}>
        {opts.map((o) => (
          <Choice key={o.id} option={o} onPick={answer}>
            {o.value!.strategyCard} {o.value!.name ?? o.label}
            {o.value!.tradeGoods > 0 && <Meta>+{o.value!.tradeGoods} trade goods</Meta>}
          </Choice>
        ))}
      </div>
    </div>
  );
}

/** Before your pick: queue cards in order; the first still free is picked for you. */
export function QueuePick({ decision, answer }: RendererProps<StrategyCardQueuePick>) {
  const opts = live(decision.options).filter((o) => o.value);
  const queued = opts[0]?.value?.queued ?? [];
  return (
    <div className={classes.panel}>
      <Title sub={queued.length ? `Queued: ${queued.join(" → ")}` : "Nothing queued yet."}>Queue a strategy card</Title>
      <div className={classes.choices}>
        {opts.map((o) =>
          o.value!.restart ? (
            <Choice key={o.id} option={o} onPick={answer} quiet>
              Clear the queue
            </Choice>
          ) : (
            <Choice key={o.id} option={o} onPick={answer}>
              {o.value!.strategyCard} {o.value!.name}
              {o.value!.tradeGoods > 0 && <Meta>+{o.value!.tradeGoods} trade goods</Meta>}
            </Choice>
          ),
        )}
      </div>
    </div>
  );
}

export function StrategicActionView({ decision, answer }: RendererProps<StrategicAction>) {
  const opts = live(decision.options).filter((o) => o.value);
  return (
    <div className={classes.panel}>
      <Title>Strategic action</Title>
      <div className={classes.choices}>
        {opts.map((o) => (
          <Choice key={o.id} option={o} onPick={answer}>
            Play {o.value!.strategyCard} {o.value!.name}
          </Choice>
        ))}
      </div>
    </div>
  );
}

/** Diplomacy part 1: a system with a planet you control (Mecatol Rex is never offered). */
export function DiplomacySystemView({ decision, answer }: RendererProps<DiplomacySystem>) {
  const opts = live(decision.options).filter((o) => o.value);
  return (
    <div className={classes.panel}>
      <Title sub="Every other player puts a command token there. Then ready up to 2 planets (part 2).">Diplomacy: choose a system</Title>
      <div className={classes.choices}>
        {opts.map((o) => (
          <Choice key={o.id} option={o} onPick={answer}>
            {o.value!.tile ?? o.label}
            <Meta>
              {o.value!.planets.join(", ")}
              {o.value!.home ? " · home" : ""} · {o.value!.resources}/{o.value!.influence}
            </Meta>
          </Choice>
        ))}
      </div>
    </div>
  );
}

/** Ready exhausted planets; Diplomacy allows 2, then Done. */
export function PlanetReadyView({ decision, answer }: RendererProps<PlanetReady>) {
  const [readied, setReadied] = useState<string[]>([]);
  const opts = live(decision.options);
  const done = opts.find((o) => o.value?.done);
  const limit = done?.value?.done ? done.value.limit : Infinity;
  const planets = opts.filter((o) => o.value && !o.value.done && !readied.includes(o.id));
  const full = readied.length >= limit;
  const pick = (id: string) => {
    setReadied((r) => [...r, id]);
    answer(id);
  };
  return (
    <div className={classes.panel}>
      <Title sub={Number.isFinite(limit) ? `${readied.length}/${limit} readied` : undefined}>Ready planets</Title>
      <div className={classes.choices}>
        {planets.map((o) => (
          <button key={o.id} type="button" className={classes.choice} disabled={full} onClick={() => pick(o.id)}>
            {o.value!.planet}
            <Meta>
              {o.value && !o.value.done ? `${o.value.resources}/${o.value.influence}` : ""}
            </Meta>
          </button>
        ))}
        {done && <Choice option={done} onPick={answer} quiet={!full} />}
      </div>
    </div>
  );
}

/** Politics part 1: who gets the speaker token (before looking at agendas). */
export function SpeakerView({ decision, state, answer }: RendererProps<PoliticsSpeaker>) {
  const opts = live(decision.options).filter((o) => o.value);
  return (
    <div className={classes.panel}>
      <Title sub="Before drawing action cards or looking at agendas.">Politics: give the speaker token</Title>
      <div className={classes.choices}>
        {opts.map((o) => (
          <Choice key={o.id} option={o} onPick={answer}>
            {o.value!.self ? "Me" : playerName(state, o.value!.faction)}
          </Choice>
        ))}
      </div>
    </div>
  );
}

/** Politics parts 2–3: look at the top 2 agendas, then top/bottom each. */
export function AgendaView({ decision, answer }: RendererProps<PoliticsAgenda>) {
  const opts = live(decision.options).filter((o) => o.value);
  const draw = opts.find((o) => o.value!.action === "draw");
  if (draw) {
    return (
      <div className={classes.panel}>
        <Title>Politics: look at the top 2 agendas</Title>
        <div className={classes.choices}>
          <Choice option={draw} onPick={answer} />
        </div>
      </div>
    );
  }
  const v = opts[0]?.value;
  const agenda = v && v.action !== "draw" ? v.agenda : null;
  return (
    <div className={classes.panel}>
      <Title sub={agenda ?? undefined}>Politics: place this agenda</Title>
      <div className={classes.choices}>
        {opts.map((o) => (
          <Choice key={o.id} option={o} onPick={answer} quiet={o.value!.action === "discard"}>
            {o.value!.action === "top" ? "Top of the deck" : o.value!.action === "bottom" ? "Bottom of the deck" : "Discard"}
          </Choice>
        ))}
      </div>
    </div>
  );
}

/** Construction: the planet for one structure. */
export function ConstructionPlaceView({ decision, answer }: RendererProps<ConstructionPlace>) {
  const opts = live(decision.options).filter((o) => o.value);
  const unit = opts[0]?.value?.unit === "spacedock" ? "space dock" : "PDS";
  return (
    <div className={classes.panel}>
      <Title>Construction: place a {unit}</Title>
      <div className={classes.choices}>
        {opts.map((o) => (
          <Choice key={o.id} option={o} onPick={answer}>
            {o.value!.planet}
            <Meta>
              {o.value!.resources}/{o.value!.influence}
              {o.value!.home ? " · home" : ""}
              {o.value!.pds ? ` · ${o.value!.pds} PDS` : ""}
            </Meta>
          </Choice>
        ))}
      </div>
    </div>
  );
}

/** Trade holder: grant free replenishes (deals), then Done. */
export function TradeReplenishView({ decision, state, answer }: RendererProps<TradeReplenish>) {
  const opts = live(decision.options);
  return (
    <div className={classes.panel}>
      <Title sub="Optional: replenish another player's commodities without their strategy token.">Trade: free replenish</Title>
      <div className={classes.choices}>
        {opts.map((o) =>
          o.value ? (
            <Choice key={o.id} option={o} onPick={answer}>
              {playerName(state, o.value.faction)}
              <Meta>
                {o.value.commodities}/{o.value.commoditiesMax}
                {o.value.reacted ? " · already answered" : ""}
              </Meta>
            </Choice>
          ) : (
            <Choice key={o.id} option={o} onPick={answer} quiet />
          ),
        )}
      </div>
    </div>
  );
}

/** Command-token panel: pools now vs when it opened; gained = the difference (never a press count). */
export function CommandTokensView({ decision, state, answer }: RendererProps<CommandTokenAdjust>) {
  const opts = live(decision.options);
  const typed = opts.find((o) => o.value?.current);
  const me = viewer(state);
  const cur = typed?.value?.current ?? me?.commandTokens ?? null;
  const orig = typed?.value?.original ?? null;
  const gained = cur && orig ? cur.tactic + cur.fleet + cur.strategy - (orig.tactic + orig.fleet + orig.strategy) : null;
  return (
    <div className={classes.panel}>
      <Title sub={gained !== null ? `Net ${gained >= 0 ? "+" : ""}${gained} · ${typed?.value?.reinforcements ?? "?"} in reinforcements` : undefined}>Command tokens</Title>
      {cur && (
        <div className={classes.pools}>
          <span>T {cur.tactic}</span>
          <span>F {cur.fleet}</span>
          <span>S {cur.strategy}</span>
        </div>
      )}
      <div className={classes.choices}>
        {opts.map((o) => (
          <Choice key={o.id} option={o} onPick={answer} quiet={!o.value || o.value.action !== "gain"} />
        ))}
      </div>
    </div>
  );
}
