import { useState } from "react";
import { Button } from "@mantine/core";
import type { GameState, Option } from "../../../../../shim/src/engine/types";
import type {
  MoveRequest,
  TacticalActivate,
  TacticalConclude,
  TacticalLand,
  TacticalMove,
  TacticalRift,
  TurnAction,
} from "../../../../../shim/src/engine/kinds/tactical";
import { planetName, strategyCardName, systemName, unitName } from "./names";
import classes from "./Tactical.module.css";
import { optionRole } from "../../optionKinds";
import type { FollowWait } from "../../../../../shim/src/engine/kinds/tactical";
import { followHolds, followsOwed, owesFollow } from "../../follows";
import { useMyDecisions } from "../../store";
import { useEngineAnswer } from "../../link";
import { factionName } from "../../names";
import { displayLabel } from "@/decisions/model/phrasing";

/**
 * A direct action payload for `answer`: the decision's kind-specific endpoint (`POST …/decisions/{id}/{action}`)
 * instead of one option. Tactical decisions use "move" (tactical.move) and "land" (tactical.land).
 */
export type DirectAction =
  | { action: "move"; body: Omit<MoveRequest, "userId"> }
  | { action: "land"; body: { landings: { planet: string; unit: string; count: number }[]; done?: boolean } };

export type RendererProps<D> = {
  decision: D;
  state: GameState | null;
  answer: (optionIdOrPayload: string | DirectAction) => void;
};

const live = <V,>(options: Option<V>[]) =>
  options.filter((o) => !o.disabled && !o.needsInput && o.value);

function OptionButton({
  id,
  label,
  answer,
  variant = "default",
}: {
  id: string;
  label: string;
  answer: (id: string) => void;
  variant?: string;
}) {
  return (
    <Button size="xs" variant={variant} onClick={() => answer(id)}>
      {label}
    </Button>
  );
}

/** Untyped options of a typed decision (faction abilities on the turn menu, …), with the engine's labels. */
function Extras({
  options,
  answer,
}: {
  options: Option<unknown>[];
  answer: (id: string) => void;
}) {
  const [more, setMore] = useState(false);
  const extras = options.filter((o) => !o.disabled && !o.needsInput && !o.value);
  if (!extras.length) return null;
  const main = extras.filter((o) => optionRole(o) === "main");
  const back = extras.filter((o) => optionRole(o) === "back");
  const utilities = extras.filter((o) => optionRole(o) === "utility");
  return (
    <>
      {main.length > 0 && (
        <div className={classes.row}>
          {main.map((o) => (
            <OptionButton key={o.id} id={o.id} label={o.label} answer={answer} variant="light" />
          ))}
        </div>
      )}
      {(back.length > 0 || utilities.length > 0) && (
        <div className={classes.row}>
          {back.map((o) => (
            <OptionButton key={o.id} id={o.id} label={o.label} answer={answer} variant="subtle" />
          ))}
          {utilities.length > 0 && (
            <Button size="xs" variant="subtle" color="gray" onClick={() => setMore((v) => !v)} aria-expanded={more}>
              {more ? "Fewer options" : `More options (${utilities.length})`}
            </Button>
          )}
        </div>
      )}
      {more && (
        <div className={classes.row}>
          {utilities.map((o) => (
            <OptionButton key={o.id} id={o.id} label={o.label} answer={answer} variant="subtle" />
          ))}
        </div>
      )}
    </>
  );
}

type TurnOpt = Option<TurnAction["options"][number]["value"]>;

function turnLabel(o: TurnOpt, tactic: number | undefined): string {
  const v = o.value!;
  switch (v.action) {
    case "tactical":
      // Live tokens first: the value is the count when the prompt was posted (a token gained since made it stale).
      return `Tactical action (${tactic ?? v.tacticTokens ?? "?"} tactic tokens)`;
    case "component":
      return "Component action";
    case "strategic":
      return `Play ${strategyCardName(v.strategyCard)}`;
    case "pass":
      return v.abilities ? "Pass (with abilities)" : "Pass";
    case "end_turn":
      return v.abilities ? "End turn (abilities first)" : "End turn";
    case "end_turn_when_followed":
      return "End turn when all have followed";
    case "another_action":
      return v.sources?.length ? `Take another action (${v.sources.join(", ")})` : "Take another action";
  }
}

/** Steps of my tactical action that mean it is not over yet (End turn is refused until it is concluded). */
const MID_ACTION = /^tactical\.(move|land|conclude)$/;

/** The follow windows that hold this turn (the engine refuses end turn / pass until they close). */
function followWaits(options: TurnOpt[], state: GameState | null | undefined): FollowWait[] {
  /* Live from the game state when the engine reports blocksTurn (it re-enables by itself as players answer); the
     option values only say who was pending when the turn menu was posted. */
  if (state?.strategyCards.some((c) => c.blocksTurn !== undefined)) {
    return followHolds(state).map((h) => ({
      strategyCard: h.strategyCard as FollowWait["strategyCard"],
      name: h.name,
      factions: h.pending.map((p) => p.faction) as FollowWait["factions"],
      userIds: h.pending.map((p) => p.userId),
    }));
  }
  for (const o of options) {
    const v = o.value;
    if (v && (v.action === "end_turn" || v.action === "pass") && v.waitingFor?.length) return v.waitingFor;
  }
  return [];
}

/**
 * My turn menu. A tactical action starts on the map (click a system: it is activated after one confirm there), so
 * the menu says so instead of offering a "Tactical action" button that would only lead to a list of systems.
 */
export function TurnActionView({ decision, state, answer }: RendererProps<TurnAction>) {
  const me = state?.players.find((p) => p.userId === decision.target?.userId);
  const tactical = decision.options.find((o) => o.value?.action === "tactical");
  const tokens = tactical?.value?.action === "tactical" ? (me?.commandTokens.tactic ?? tactical.value.tacticTokens ?? null) : null;
  const mine = useMyDecisions();
  const answerOther = useEngineAnswer();
  const opts = live(decision.options) as TurnOpt[];
  /* Rules: every player answers a played strategy card before the next turn begins. A follow I still owe (its prompt
     is open) comes first: my actions wait, greyed out, until I answer it. */
  const owed = followsOwed(state, me?.userId).filter((f) =>
    mine.some((d) => owesFollow(d, me?.userId, me?.faction) && d.window?.subject?.strategyCard === f.strategyCard),
  );
  const waits = followWaits(opts, state);
  const defer = opts.find((o) => o.value!.action === "end_turn_when_followed");
  const ends = (o: TurnOpt) => o.value!.action === "end_turn" || o.value!.action === "pass";
  /* Rules (fleet pool, capacity): units over the limit go before the turn ends. The engine judges the board itself
     (a dismissed reminder changes nothing) and refuses End Turn / Pass while any system is over. */
  /* Also (rules audit, core): over the action card hand limit (discard first), and Pass with a strategy card not yet
     played. Each End turn / Pass option carries its own reasons. */
  const overOf = (o: TurnOpt): string[] => {
    const v = o.value as { action?: string; overLimits?: string[] } | null;
    return (v?.action === "end_turn" || v?.action === "pass") && v.overLimits ? v.overLimits : [];
  };
  /* My tactical action is under way (Thunder's Edge Warfare posts this menu before it): the engine refuses End turn
     until it is concluded (pt9 058). */
  const midAction = mine.some((d) => MID_ACTION.test(d.kind) && d.target?.userId === me?.userId);
  const endsTurn = (o: TurnOpt) => o.value!.action === "end_turn";
  /* The card I played this turn has a mandatory primary part left (Imperial's secret / Mecatol point): the engine
     refuses End turn until it is done (pt9). */
  const primaryMissing = opts.map((o) => (o.value!.action === "end_turn" ? o.value!.primaryMissing : null)).find((x): x is string => !!x) ?? null;
  const disabled = (o: TurnOpt) =>
    owed.length > 0 ||
    ((waits.length > 0 || overOf(o).length > 0) && ends(o)) ||
    ((midAction || !!primaryMissing) && endsTurn(o));
  const pending = waits.flatMap((w) => w.userIds.map((id, i) => state?.players.find((p) => p.userId === id)?.userName ?? factionName(w.factions[i] ?? id)));
  /* One click to the missing part: that part's own buttons from my played card's panel (pt9 soak pbd821: the holder
     waited on End turn without knowing where the primary was). */
  const missingValue = opts.map((o) => (o.value!.action === "end_turn" ? o.value! : null)).find((v) => !!v?.primaryMissing);
  const missingParts = missingValue && "primaryMissingParts" in missingValue ? (missingValue.primaryMissingParts ?? []) : [];
  const missingCard = missingValue && "primaryMissingCard" in missingValue ? missingValue.primaryMissingCard : null;
  const cardPanel = missingCard == null ? undefined : mine.find((d) => d.kind === "strategy_card.resolve" && d.options.some((o) => (o.value as { strategyCard?: number; who?: string } | null)?.strategyCard === missingCard && (o.value as { who?: string }).who !== "others"));
  const partButtons = (cardPanel?.options ?? []).filter((o) => {
    const v = o.value as { part?: string | null; who?: string } | null;
    return !o.disabled && !!v?.part && v.who !== "others" && missingParts.includes(v.part);
  });
  const reminders = waits
    .map((w) => {
      const panel = mine.find((d) => d.kind === "strategy_card.resolve" && d.options.some((o) => (o.value as { action?: string; strategyCard?: number } | null)?.action === "request_all" && (o.value as { strategyCard?: number }).strategyCard === w.strategyCard));
      const option = panel?.options.find((o) => !o.disabled && (o.value as { action?: string } | null)?.action === "request_all");
      return panel && option ? { panel, option, name: w.name } : null;
    })
    .filter((x) => x !== null);
  const label = (o: TurnOpt) => {
    if (midAction && endsTurn(o)) return `${turnLabel(o, me?.commandTokens.tactic)} · finish your tactical action first`;
    if (primaryMissing && endsTurn(o)) return `${turnLabel(o, me?.commandTokens.tactic)} · ${primaryMissing}`;
    if (overOf(o).length && ends(o)) return `${turnLabel(o, me?.commandTokens.tactic)} · ${overOf(o).join("; ")}`;
    if (waits.length && ends(o))
      return `${turnLabel(o, me?.commandTokens.tactic)} · waiting for ${pending.length} player${pending.length === 1 ? "" : "s"} to follow ${waits.map((w) => w.name).join(" and ")}`;
    return turnLabel(o, me?.commandTokens.tactic);
  };
  /*
   * The tactical action starts on the map, so this line stands in for its button: never hidden on a menu that starts an
   * action, greyed with the reason while it can't be taken (UI principle: show it greyed, say why).
   */
  const startsAction = opts.some((o) => o.value!.action === "component" || o.value!.action === "strategic" || o.value!.action === "pass");
  const tacticalNote: { live: boolean; text: string } | null = tactical
    ? tokens === 0
      ? { live: false, text: "Tactical action: no command tokens in your tactic pool." }
      : owed.length > 0
        ? { live: false, text: `Tactical action: follow ${owed.map((f) => f.name).join(" and ")} first.` }
        : tactical.disabled
          ? { live: false, text: "Tactical action: not available right now." }
          : { live: true, text: `Tactical action: click a system on the map to activate it (${tokens ?? "?"} tactic token${tokens === 1 ? "" : "s"}).` }
    : startsAction
      ? { live: false, text: "Tactical action: not offered on this menu (the game did not include it)." }
      : opts.some(endsTurn)
        ? { live: false, text: midAction ? "Tactical action: under way." : "Tactical action: you already took your action this turn." }
        : null;
  const variant = (o: TurnOpt) =>
    o.value!.action === "pass" || o.value!.action === "end_turn" || o.value!.action === "another_action" ? "light" : "filled";
  return (
    <div className={classes.panel}>
      {owed.length > 0 && <span className={classes.heading}>Follow {owed.map((f) => f.name).join(" and ")} first: the next turn waits on your answer.</span>}
      {waits.length > 0 && (
        <span className={classes.heading}>
          Waiting for {pending.join(", ")} to follow {waits.map((w) => w.name).join(" and ")}. Your turn ends once every player has answered.
        </span>
      )}
      {tacticalNote && (
        <p className={tacticalNote.live ? classes.hint : classes.muted} data-map-activate-hint data-tactical-blocked={tacticalNote.live ? undefined : ""}>
          {tacticalNote.text}
        </p>
      )}
      <div className={classes.row}>
        {opts
          .filter((o) => o.value!.action !== "end_turn_when_followed" && o.value!.action !== "tactical")
          .map((o) => (
            <Button key={o.id} size="xs" variant={variant(o)} disabled={disabled(o)} onClick={() => answer(o.id)}>
              {label(o)}
            </Button>
          ))}
        {defer && waits.length > 0 && <OptionButton id={defer.id} label={turnLabel(defer, undefined)} answer={answer} variant="filled" />}
        {cardPanel &&
          partButtons.map((o) => (
            <Button key={o.id} size="xs" variant="filled" onClick={() => answerOther(cardPanel, o.id)}>
              {displayLabel(o.handler, o.label)}
            </Button>
          ))}
        {reminders.map((r) => (
          <Button key={r.option.id} size="xs" variant="subtle" onClick={() => answerOther(r.panel, r.option.id)}>
            Remind them ({r.name})
          </Button>
        ))}
      </div>
      <Extras options={decision.options} answer={answer} />
    </div>
  );
}

/** The bot's system menu (rings, then systems) is answered by clicking the map; the panel only says so. */
export function TacticalActivateView({ decision, answer }: RendererProps<TacticalActivate>) {
  /* Warfare (Thunder's Edge) and other token-free activations: no tactic token, a system with my token is fine. */
  const free = decision.options.some((o) => !o.disabled && o.value?.token === false);
  return (
    <div className={classes.panel}>
      <p className={classes.hint} data-map-activate-hint>
        {free
          ? "Click a lit system on the map to activate it (no command token is placed, so a system with your token is fine)."
          : "Click a lit system on the map to activate it (−1 tactic token)."}{" "}
        Systems you can't activate are greyed, with the reason on hover.
      </p>
      <Extras options={decision.options} answer={answer} />
    </div>
  );
}

export function TacticalMoveView({ decision, state, answer }: RendererProps<TacticalMove>) {
  const me = state?.players.find((p) => p.userId === decision.target?.userId);
  const opts = live(decision.options);
  const done = opts.find((o) => o.value!.action === "done");
  const doneValue = done?.value?.action === "done" ? done.value : null;
  const staged = decision.progress?.accumulated.staged ?? [];
  const origins = doneValue?.origins ?? [];
  const other = opts.filter((o) => ["change_destination", "reset", "back"].includes(o.value!.action));
  const otherLabel: Record<string, string> = {
    change_destination: "Activate a different system",
    reset: "Reset movement",
    back: "Back to systems",
  };
  return (
    <div className={classes.panel}>
      {doneValue && (
        <span className={classes.heading}>
          Moving into {systemName(doneValue.position, doneValue.tileId)} — pick ships on the map
        </span>
      )}
      <ul className={classes.list}>
        {staged.map((s) => (
          <li key={`${s.from}-${s.holder}-${s.unit}-${s.color}`} className={classes.item}>
            <span className={classes.mono}>{s.count}</span>
            <span>{unitName(s.unit, s.count, me)}</span>
            <span className={classes.muted}>
              from {s.from}
              {s.holder !== "space" ? ` (${planetName(s.holder)})` : ""}
            </span>
          </li>
        ))}
        {!staged.length && <li className={classes.muted}>Nothing staged to move.</li>}
      </ul>
      {origins.length > 0 && (
        <span className={classes.muted}>
          Can move from:{" "}
          {origins.map((o) => `${o.position} (${o.distance >= 100 ? "far" : o.distance})`).join(", ")}
        </span>
      )}
      <div className={classes.row}>
        {done && (
          <OptionButton id={done.id} label={staged.length ? "Done moving" : "Move nothing"} answer={answer} variant="filled" />
        )}
        {other.map((o) => (
          <OptionButton key={o.id} id={o.id} label={otherLabel[o.value!.action]} answer={answer} variant="subtle" />
        ))}
      </div>
      <Extras options={decision.options} answer={answer} />
    </div>
  );
}

export function TacticalLandView({ decision, state, answer }: RendererProps<TacticalLand>) {
  // Names follow the owner's real unit (faction unit, upgraded only with its upgrade tech): Xxcha without
  // Infantry II research lands "Infantry", never "Infantry II" (playtest 3, pbd203).
  const me = state?.players.find((p) => p.userId === decision.target?.userId);
  const ownerOf = (faction?: string | null) => state?.players.find((p) => p.faction === faction) ?? me;
  const opts = live(decision.options);
  const done = opts.find((o) => o.value!.op === "done");
  const progress = decision.progress?.accumulated;
  const label = (o: (typeof opts)[number]) => {
    const v = o.value!;
    if (v.op === "done") return "Done landing";
    const verb = v.op === "land" ? "Land" : "Lift";
    return `${verb} ${v.count} ${unitName(v.unit, v.count, ownerOf(v.owner))}${v.damaged ? " (damaged)" : ""} ${v.op === "land" ? "on" : "from"} ${planetName(v.planet)}`;
  };
  return (
    <div className={classes.panel}>
      {progress && (
        <span className={classes.muted}>
          In space: {progress.inSpace.map((u) => `${u.count} ${unitName(u.unit, u.count, me)}`).join(", ") || "none"}
          {progress.onPlanets.length > 0 &&
            ` · landed: ${progress.onPlanets.map((u) => `${u.count} ${unitName(u.unit, u.count, me)} on ${planetName(u.planet)}`).join(", ")}`}
        </span>
      )}
      <div className={classes.row}>
        {opts
          .filter((o) => o.value!.op !== "done")
          .map((o) => (
            <OptionButton key={o.id} id={o.id} label={label(o)} answer={answer} />
          ))}
      </div>
      <div className={classes.row}>
        {done && <OptionButton id={done.id} label="Done landing" answer={answer} variant="filled" />}
      </div>
      <Extras options={decision.options} answer={answer} />
    </div>
  );
}

export function TacticalConcludeView({ decision, answer }: RendererProps<TacticalConclude>) {
  const opts = live(decision.options);
  const label = (o: (typeof opts)[number]) => {
    const v = o.value!;
    if (v.action === "produce") return `Produce in ${v.position} (${v.production} production)`;
    if (v.action === "rift") return "Roll for gravity rift";
    if (v.endTurn) return "Conclude & end turn";
    return v.frontierExplore ? "Conclude (explores the frontier)" : "Conclude tactical action";
  };
  return (
    <div className={classes.panel}>
      <div className={classes.row}>
        {opts.map((o) => (
          <OptionButton
            key={o.id}
            id={o.id}
            label={label(o)}
            answer={answer}
            variant={o.value!.action === "conclude" ? "filled" : "default"}
          />
        ))}
      </div>
      <Extras options={decision.options} answer={answer} />
    </div>
  );
}

export function TacticalRiftView({ decision, answer }: RendererProps<TacticalRift>) {
  const opts = live(decision.options);
  const label = (o: (typeof opts)[number]) => {
    const v = o.value!;
    if (v.op === "done") return "Done with rifts";
    if (v.op === "roll_all") return "Roll for all units";
    return `Roll for ${v.count} ${v.damaged ? "damaged " : ""}${v.unit}`;
  };
  return (
    <div className={classes.panel}>
      <div className={classes.row}>
        {opts.map((o) => (
          <OptionButton key={o.id} id={o.id} label={label(o)} answer={answer} variant={o.value!.op === "done" ? "filled" : "default"} />
        ))}
      </div>
      <Extras options={decision.options} answer={answer} />
    </div>
  );
}
