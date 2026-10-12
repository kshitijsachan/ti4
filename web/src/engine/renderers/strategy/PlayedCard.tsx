import type { Option } from "../../../../../shim/src/engine/types";
import type { PrimaryPart, StrategyCardResolve } from "../../../../../shim/src/engine/kinds/strategy";
import { Choice, live, Meta, playerName, Title, viewer, type RendererProps } from "./shared";
import classes from "./strategy.module.css";
import { useDecisionState } from "../../draftState";

type Value = NonNullable<StrategyCardResolve["options"][number]["value"]>;
type Opt = Option<Value>;

const PART_LABEL: Record<PrimaryPart, string> = {
  tokens: "Gain command tokens",
  system: "Choose a system",
  ready_planets: "Ready up to 2 planets",
  speaker: "Give the speaker token",
  action_cards: "Draw 2 action cards",
  agendas: "Look at the top 2 agendas",
  structure: "Place a structure",
  produce: "Produce",
  warfare_primary: "Take back a command token",
  research: "Research a technology",
  score_public: "Score a public objective",
  imperial: "Mecatol point or a secret",
};

const REASON: Record<string, string> = {
  no_strategy_token: "No strategy token to follow.",
  no_home_space_dock: "No space dock in your home system.",
  all_secrets_scored: "All your secret objectives are scored.",
};

const STATUS_LABEL: Record<string, string> = {
  holder: "played it",
  pending: "deciding",
  followed: "following",
  declined: "not following",
};

/** A played strategy card: the holder walks the primary checklist; everyone else follows (once) or declines. */
export function PlayedCard({ decision, state, answer }: RendererProps<StrategyCardResolve>) {
  const [pressed, setPressed] = useDecisionState<string[]>(decision.id, "pressed", []);
  const opts = live(decision.options).filter((o): o is Opt => !!o.value);
  const first = opts[0]?.value;
  const me = viewer(state);
  if (!first || !me) return null;
  const sc = first.strategyCard;
  const card = state?.strategyCards.find((c) => c.number === sc);
  const isHolder = me.strategyCards.includes(sc) || first.holder === me.faction;
  const reaction = card?.reactions.find((r) => r.faction === me.faction);
  const pick = (id: string) => {
    setPressed((p) => [...p, id]);
    answer(id);
  };

  return (
    <div className={classes.panel}>
      <Title sc={sc} sub={`Played by ${playerName(state, first.holder)}`}>
        {first.name}
      </Title>
      {isHolder ? <Primary opts={opts} parts={first.primaryParts} pressed={pressed} done={serverDone(decision)} onPick={pick} /> : <Follow opts={opts} status={reaction?.status ?? "pending"} reason={reaction?.cantFollowReason ?? null} onPick={pick} />}
      {card && card.reactions.length > 0 && (
        <div className={classes.reactions}>
          {card.reactions.map((r) => (
            <span key={r.faction} className={classes.reaction} data-status={r.status}>
              <span className={classes.dot} />
              {playerName(state, r.faction)} · {STATUS_LABEL[r.status] ?? r.status}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** The primary parts the engine has recorded as done (window subject `primaryDone`). */
function serverDone(d: StrategyCardResolve): string[] {
  const v = (d.window?.subject as { primaryDone?: unknown } | undefined)?.primaryDone;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Every part of the primary, in order; a part stays listed (ticked) once pressed so none is skipped. */
function Primary({ opts, parts, pressed, done, onPick }: { opts: Opt[]; parts: PrimaryPart[]; pressed: string[]; done: string[]; onPick: (id: string) => void }) {
  const mine = opts.filter((o) => o.value!.who !== "others");
  /* What the engine reports done (survives reload), else what I pressed on this page. */
  const doneCount = (part: PrimaryPart) =>
    Math.max(
      done.filter((p) => p === part).length,
      pressed.filter((id) => mine.find((o) => o.id === id)?.value?.part === part).length,
    );
  const pressedCount = (id: string) => pressed.filter((p) => p === id).length;
  const seen = new Map<PrimaryPart, number>();
  const checklist = parts.map((part) => {
    const n = (seen.get(part) ?? 0) + 1;
    seen.set(part, n);
    return { part, n, done: doneCount(part) >= n };
  });
  return (
    <>
      {checklist.length > 0 && (
        <ul className={classes.checklist}>
          {checklist.map((c) => (
            <li key={`${c.part}${c.n}`} className={classes.check} data-done={c.done || undefined}>
              {c.done ? "✓" : "○"} {PART_LABEL[c.part] ?? c.part}
            </li>
          ))}
        </ul>
      )}
      <div className={classes.choices}>
        {mine.map((o) => (
          <Choice key={o.id} option={o} onPick={onPick} quiet={o.value!.action === "request_all"}>
            {o.label}
            {pressedCount(o.id) > 0 && <Meta>pressed ×{pressedCount(o.id)}</Meta>}
          </Choice>
        ))}
      </div>
    </>
  );
}

/** Follow (spending a strategy token, with the card's secondary) or decline; once, never on your own card. */
function Follow({ opts, status, reason, onPick }: { opts: Opt[]; status: string; reason: string | null; onPick: (id: string) => void }) {
  const others = opts.filter((o) => o.value!.who !== "holder");
  if (status === "declined") return <p className={classes.sub}>You are not following this card.</p>;
  const decline = others.find((o) => o.value!.action === "decline");
  const secondary = others.filter((o) => o.value!.action !== "decline" && o.value!.action !== "follow");
  const follow = others.find((o) => o.value!.action === "follow");
  if (status === "followed") {
    return (
      <div className={classes.choices}>
        {secondary.map((o) => (
          <Choice key={o.id} option={o} onPick={onPick} />
        ))}
      </div>
    );
  }
  if (reason) {
    return (
      <>
        <p className={classes.warn}>{REASON[reason] ?? reason}</p>
        {decline && <Choice option={decline} onPick={onPick} />}
      </>
    );
  }
  const main = secondary.length ? secondary : follow ? [follow] : [];
  return (
    <>
      <span className={classes.sectionLabel}>Follow</span>
      <div className={classes.choices}>
        {main.map((o) => (
          <Choice key={o.id} option={o} onPick={onPick}>
            {o.label}
            {o.value!.spendsToken && <Meta>1 strategy token{o.value!.followCost ? ` + ${o.value!.followCost} resources` : ""}</Meta>}
            {!o.value!.spendsToken && o.value!.action.endsWith("_free") && <Meta>free — only if the holder agreed</Meta>}
          </Choice>
        ))}
        {decline && <Choice option={decline} onPick={onPick} quiet />}
      </div>
    </>
  );
}
