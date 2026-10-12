import { Loader, UnstyledButton } from "@mantine/core";
import cx from "clsx";
import type { ReactNode } from "react";
import type {
  ExploreCardPick,
  ExploreEvent,
  ExploreFrontier,
  ExploreOutcome,
  ExplorePlanet,
  FragmentCounts,
  RelicDraw,
  RelicFragments,
} from "../../../../../shim/src/engine/kinds/explore";
import type { Option } from "../../../../../shim/src/engine/types";
import classes from "./explore.module.css";
import { isLive, latestExplore, traitLabel, unavailableReason, type RendererProps } from "./types";

const TRAIT_CLASS: Record<string, string | undefined> = {
  cultural: classes.cultural,
  industrial: classes.industrial,
  hazardous: classes.hazardous,
  frontier: classes.frontier,
};

type ButtonProps = {
  option: Option<unknown>;
  pendingOptionId?: string | null;
  answer: (id: string) => unknown;
  className?: string;
  disabled?: boolean;
  children: ReactNode;
};

/**
 * One option. A costed option the player cannot pay right now (value.unavailable, re-read by the engine on every
 * state change) stays visible, greyed out, with the reason; it enables by itself once the resource arrives.
 */
function Choice({ option, pendingOptionId, answer, className, disabled, children }: ButtonProps) {
  const pending = pendingOptionId === option.id;
  const reason = unavailableReason(option);
  return (
    <UnstyledButton
      className={cx(classes.option, className)}
      disabled={!isLive(option) || !!pendingOptionId || disabled || !!reason}
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

/** "What was explored": the card, where, and its text. Exported for boards / logs. */
export function ExploreResult({ event, title }: { event: ExploreEvent; title?: string }) {
  const traitClass = event.type === "relic" ? classes.relicTrait : TRAIT_CLASS[event.trait ?? ""];
  const where = event.planetName ?? (event.tile ? `frontier token, ${event.tile}` : null);
  return (
    <div className={cx(classes.result, traitClass)}>
      {title && <div className={classes.heading}>{title}</div>}
      <div className={classes.resultTitle}>
        <span>{event.name ?? event.card}</span>
        {where && <span className={classes.where}>{where}</span>}
        {event.trait && <span className={classes.where}>{traitLabel(event.trait)}</span>}
      </div>
      {event.text && <div className={classes.text}>{event.text}</div>}
    </div>
  );
}

/** Choose a planet (and trait) to explore; several planets are grouped one row each. */
export function ExplorePlanetPanel({ decision, answer, pendingOptionId }: RendererProps<ExplorePlanet>) {
  const byPlanet = new Map<string, Option<ExplorePlanet["options"][number]["value"]>[]>();
  const other: Option<unknown>[] = [];
  for (const o of decision.options) {
    if (!o.value) {
      other.push(o);
      continue;
    }
    byPlanet.set(o.value.planet, [...(byPlanet.get(o.value.planet) ?? []), o]);
  }
  return (
    <div className={classes.root}>
      <div className={classes.heading}>Explore</div>
      <div className={classes.rows}>
        {[...byPlanet.entries()].map(([planet, opts]) => (
          <div key={planet} className={classes.row}>
            <span className={classes.rowName}>{opts[0].value!.planetName}</span>
            {opts.map((o) => (
              <Choice
                key={o.id}
                option={o}
                answer={answer}
                pendingOptionId={pendingOptionId}
                className={cx(classes.traitButton, TRAIT_CLASS[o.value!.trait])}
              >
                {traitLabel(o.value!.trait)}
                {o.value!.frontierInstead && " (breakthrough)"}
                {o.value!.fromDiscard && " from discard"}
              </Choice>
            ))}
          </div>
        ))}
      </div>
      <OtherOptions options={other} answer={answer} pendingOptionId={pendingOptionId} />
    </div>
  );
}

/** Pick one of the drawn cards (Distant Suns, Voidsailors, alternative resolutions). */
export function ExploreCardPickPanel({ decision, answer, pendingOptionId }: RendererProps<ExploreCardPick>) {
  const cards = decision.options.filter((o) => o.value);
  const where = cards[0]?.value?.planetName ?? (cards[0]?.value?.tile ? `frontier token, ${cards[0].value.tile}` : "");
  return (
    <div className={classes.root}>
      <div className={classes.heading}>Choose a card to resolve{where ? ` · ${where}` : ""}</div>
      <div className={classes.cards}>
        {cards.map((o) => (
          <div key={o.id} className={cx(classes.card, TRAIT_CLASS[o.value!.cardType ?? ""])}>
            <div className={classes.resultTitle}>{o.value!.cardName ?? o.value!.card}</div>
            {o.value!.cardText && <div className={classes.text}>{o.value!.cardText}</div>}
            <Choice option={o} answer={answer} pendingOptionId={pendingOptionId} className={classes.go}>
              Resolve
            </Choice>
          </div>
        ))}
      </div>
      <OtherOptions
        options={decision.options.filter((o) => !o.value)}
        answer={answer}
        pendingOptionId={pendingOptionId}
      />
    </div>
  );
}

/** Choose the system whose frontier token to explore. */
export function ExploreFrontierPanel({ decision, answer, pendingOptionId }: RendererProps<ExploreFrontier>) {
  return (
    <div className={classes.root}>
      <div className={classes.heading}>Explore a frontier token</div>
      <div className={classes.options}>
        {decision.options.map((o) => (
          <Choice
            key={o.id}
            option={o}
            answer={answer}
            pendingOptionId={pendingOptionId}
            className={cx(classes.traitButton, classes.frontier)}
          >
            {o.value ? `System ${o.value.tile}` : o.label}
          </Choice>
        ))}
      </div>
    </div>
  );
}

type OutcomeValue = NonNullable<ExploreOutcome["options"][number]["value"]>;

const EFFECT_TEXT: Record<string, string> = {
  decline: "Decline",
  ready_planet: "Ready the planet",
  gain_trade_good: "Gain 1 trade good",
  gain_command_token: "Gain 1 command token",
  remove_command_token: "Remove a command token",
  ready_agent: "Ready an agent",
  draw_action_card: "Draw 1 action card",
  produce: "Produce",
  place_mech: "Place 1 mech",
  convert_commodities: "Convert commodities",
  replenish_commodities: "Replenish commodities",
  gain_trade_good_instead: "Gain a trade good instead",
  draw_two_choose_one: "Draw 2, choose 1",
  explore: "Explore",
};

const COST_TEXT: Record<string, string> = {
  mech_present: "with your mech there",
  remove_infantry: "by removing 1 infantry",
  commodity_or_tg: "for 1 commodity or trade good",
};

function outcomeText(v: OutcomeValue): string {
  let main = EFFECT_TEXT[v.effect] ?? v.effect;
  if (v.effect === "place_units") main = `Place ${v.units ?? "units"}`;
  if (v.effect === "gain_commodities") main = `Gain ${v.amount ?? 1} commodit${v.amount === 1 ? "y" : "ies"}`;
  if (v.effect === "convert_commodities" && v.amount) main = `Convert ${v.amount} commodities`;
  if (v.effect === "place_ion_storm") main = `Ion Storm: ${v.side} side`;
  if (v.effect === "ready_agent" && v.leader) main = `Ready ${v.leader}`;
  return v.cost ? `${main} ${COST_TEXT[v.cost] ?? ""}`.trim() : main;
}

/** How to resolve the explored card: the card on top (from state), then its choices. */
export function ExploreOutcomePanel({ decision, state, answer, pendingOptionId }: RendererProps<ExploreOutcome>) {
  const found = latestExplore(state, decision.target?.userId);
  return (
    <div className={classes.root}>
      {found && <ExploreResult event={found} title="Explored" />}
      <div className={classes.options}>
        {decision.options.map((o) => (
          <Choice
            key={o.id}
            option={o}
            answer={answer}
            pendingOptionId={pendingOptionId}
            className={o.value?.effect === "decline" ? classes.stop : o.value ? classes.go : undefined}
          >
            {o.value ? outcomeText(o.value) : o.label}
          </Choice>
        ))}
      </div>
    </div>
  );
}

const TRAITS: (keyof FragmentCounts)[] = ["cultural", "industrial", "hazardous", "frontier"];

/** Purge fragments for a relic: holdings, purged so far vs the set size, purge buttons, then draw. */
export function RelicFragmentsPanel({ decision, state, answer, pendingOptionId }: RendererProps<RelicFragments>) {
  const me = state?.players.find((p) => p.userId === decision.target?.userId);
  const first = decision.options.find((o) => o.value)?.value;
  const setSize = Number(decision.progress?.required?.setSize ?? first?.setSize ?? 3);
  const purged = Number(decision.progress?.accumulated?.purged ?? 0);
  const canDraw = decision.progress ? decision.progress.canCommit : true;
  const held = countFragments(me?.fragments ?? []);
  return (
    <div className={classes.root}>
      <div className={classes.heading}>Relic fragments</div>
      <div className={classes.counts}>
        {TRAITS.map((t) => (
          <span key={t} className={cx(classes.count, TRAIT_CLASS[t])}>
            {traitLabel(t)} {held[t]}
          </span>
        ))}
      </div>
      <div className={classes.meter}>
        Purged {purged} / {setSize}
      </div>
      <div className={classes.options}>
        {decision.options.map((o) => {
          const v = o.value;
          if (!v) {
            return (
              <Choice key={o.id} option={o} answer={answer} pendingOptionId={pendingOptionId}>
                {o.label}
              </Choice>
            );
          }
          if (v.action === "draw") {
            return (
              <Choice key={o.id} option={o} answer={answer} pendingOptionId={pendingOptionId} className={classes.relic} disabled={!canDraw}>
                {v.explore ? "Explore 3 planets" : "Draw a relic"}
              </Choice>
            );
          }
          return (
            <Choice
              key={o.id}
              option={o}
              answer={answer}
              pendingOptionId={pendingOptionId}
              className={cx(classes.traitButton, TRAIT_CLASS[v.trait ?? ""])}
            >
              Purge {v.supermassive ? "supermassive" : v.count} {traitLabel(v.trait)}
            </Choice>
          );
        })}
      </div>
    </div>
  );
}

/** Draw a relic; shows the last relic drawn in this game when there is one. */
export function RelicDrawPanel({ decision, state, answer, pendingOptionId }: RendererProps<RelicDraw>) {
  const last = [...(state?.exploration?.recent ?? [])].reverse().find((e) => e.type === "relic");
  return (
    <div className={classes.root}>
      <div className={classes.heading}>Relic</div>
      {last && <ExploreResult event={last} title="Last relic drawn" />}
      <div className={classes.options}>
        {decision.options.map((o) => (
          <Choice key={o.id} option={o} answer={answer} pendingOptionId={pendingOptionId} className={o.value ? classes.relic : undefined}>
            {o.value ? `Draw a relic (${o.value.relicDeck} left)` : o.label}
          </Choice>
        ))}
      </div>
    </div>
  );
}

function OtherOptions({
  options,
  answer,
  pendingOptionId,
}: {
  options: Option<unknown>[];
  answer: (id: string) => unknown;
  pendingOptionId?: string | null;
}) {
  if (!options.length) return null;
  return (
    <div className={classes.options}>
      {options.map((o) => (
        <Choice key={o.id} option={o} answer={answer} pendingOptionId={pendingOptionId}>
          {o.label}
        </Choice>
      ))}
    </div>
  );
}

function countFragments(ids: string[]): FragmentCounts {
  const c: FragmentCounts = { cultural: 0, industrial: 0, hazardous: 0, frontier: 0 };
  for (const f of ids) {
    if (f.startsWith("crf")) c.cultural++;
    else if (f.startsWith("irf")) c.industrial++;
    else if (f.startsWith("hrf")) c.hazardous++;
    else if (f.startsWith("urf")) c.frontier++;
  }
  return c;
}
