import type { Option } from "../../../../../shim/src/engine/types";
import type { PrimaryPart, StrategyCardResolve } from "../../../../../shim/src/engine/kinds/strategy";
import { Choice, live, Meta, playerName, Title, viewer, type RendererProps } from "./shared";
import classes from "./strategy.module.css";
import { useDecisionState } from "../../draftState";
import { engineStore, useEngine } from "../../store";
import { useEffect } from "react";
import { displayLabel } from "@/decisions/model/phrasing";

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
  /* A press the engine refused did not happen: it no longer counts toward the checklist. */
  const error = useEngine((s) => s.view.errors[decision.id]);
  useEffect(() => {
    if (error) setPressed((p) => p.slice(0, -1));
  }, [error, setPressed]);

  return (
    <div className={classes.panel}>
      <Title sc={sc} sub={`Played by ${playerName(state, first.holder)}`}>
        {first.name}
      </Title>
      {isHolder ? <Primary opts={opts} parts={first.primaryParts} pressed={pressed} done={serverDone(decision)} holdsMecatol={holdsMecatol(me.planets)} faction={me.faction} onPick={pick} onDone={() => engineStore.getState().defer(decision.id)} /> : <Follow opts={opts} status={reaction?.status ?? "pending"} reason={reaction?.cantFollowReason ?? null} faction={me.faction} onPick={pick} />}
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

/** Mecatol Rex (or Thunder's Edge's Mecatol Rex) among my planets. */
function holdsMecatol(planets: readonly string[] | undefined): boolean {
  return (planets ?? []).some((p) => /^(mr|mrte)$/i.test(p));
}

/**
 * Imperial's second part: 1 VP if I control Mecatol Rex, otherwise draw a secret objective. The one that does not
 * apply is greyed out with why (the engine offers both buttons).
 */
function imperialBlock(o: Opt, mecatol: boolean): string | null {
  if (o.value!.action === "score_imperial" && !mecatol) return "you do not control Mecatol Rex";
  if (o.value!.action === "draw_secret" && o.value!.part === "imperial" && mecatol) return "you control Mecatol Rex: score the point instead";
  return null;
}

/**
 * Why this option is closed for me (engine value.unavailableFor[faction]: Construction's structure count — the holder's
 * second structure is a PDS, a follower places one — or no structure of that type left in reinforcements).
 */
function limitFor(o: Opt, faction: string | null | undefined): string | null {
  const m = (o.value as { unavailableFor?: Record<string, string> } | null)?.unavailableFor;
  return faction && m && typeof m[faction] === "string" ? m[faction] : null;
}

/** The primary parts the engine has recorded as done (window subject `primaryDone`). */
function serverDone(d: StrategyCardResolve): string[] {
  const v = (d.window?.subject as { primaryDone?: unknown } | undefined)?.primaryDone;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Every part of the primary, in order; a part stays listed (ticked) once pressed so none is skipped. */
function Primary({
  opts,
  parts,
  pressed,
  done,
  holdsMecatol: mecatol,
  faction,
  onPick,
  onDone,
}: {
  faction?: string | null;
  opts: Opt[];
  parts: PrimaryPart[];
  pressed: string[];
  done: string[];
  holdsMecatol: boolean;
  onPick: (id: string) => void;
  /** Sets the card aside once only an optional repeat is left (it then waits behind "Available now"). */
  onDone: () => void;
}) {
  const mine = opts.filter((o) => o.value!.who !== "others");
  /* What the engine reports done (survives reload), else what I pressed on this page. */
  const doneCount = (part: PrimaryPart) =>
    Math.max(
      done.filter((p) => p === part).length,
      pressed.filter((id) => mine.find((o) => o.id === id)?.value?.part === part).length,
    );
  const needed = (part: PrimaryPart) => parts.filter((p) => p === part).length;
  /* A part done as often as the checklist lists it: greyed (the engine refuses a repeat; pt9 150: "pressed ×2" stayed
     enabled). Technology's research keeps its optional second press. */
  const partDone = (o: Opt) => {
    const part = o.value!.part;
    if (!part || part === "research" || !needed(part)) return false;
    return doneCount(part) >= needed(part);
  };
  const seen = new Map<PrimaryPart, number>();
  const checklist = parts.map((part) => {
    const n = (seen.get(part) ?? 0) + 1;
    seen.set(part, n);
    return { part, n, done: doneCount(part) >= n, optional: false };
  });
  /* Technology: once the free research is done, a second one for 6 resources (optional). */
  const repeat = parts.includes("research") && doneCount("research") >= parts.filter((p) => p === "research").length;
  if (repeat) checklist.push({ part: "research", n: checklist.length + 1, done: doneCount("research") > parts.filter((p) => p === "research").length, optional: true });
  /* Every required part is done; what is left (a second structure, a second technology) is up to me. */
  const onlyOptional = checklist.every((c) => c.done || c.optional || c.n > 1) && checklist.some((c) => !c.done);
  return (
    <>
      {checklist.length > 0 && (
        <ul className={classes.checklist}>
          {checklist.map((c) => (
            <li key={`${c.part}${c.n}`} className={classes.check} data-done={c.done || undefined}>
              {c.done ? "✓" : "○"} {c.optional ? "Research a second technology (optional, 6 resources)" : (PART_LABEL[c.part] ?? c.part)}
            </li>
          ))}
        </ul>
      )}
      <div className={classes.choices}>
        {mine.map((o) => {
          const blocked = imperialBlock(o, mecatol) ?? (partDone(o) ? "done" : null) ?? limitFor(o, faction);
          const part = o.value!.part;
          const partial = !!part && needed(part) > 1 && doneCount(part) > 0 && doneCount(part) < needed(part);
          return (
            <Choice key={o.id} option={blocked ? { ...o, disabled: true } : o} onPick={onPick} quiet={o.value!.action === "request_all"} title={blocked ?? undefined}>
              {repeat && o.value!.action === "research" ? "Research another technology" : displayLabel(o.handler, o.label)}
              {repeat && o.value!.action === "research" && <Meta>6 resources</Meta>}
              {blocked && <Meta>{blocked}</Meta>}
              {partial && part && <Meta>{doneCount(part)} of {needed(part)} done</Meta>}
            </Choice>
          );
        })}
        {onlyOptional && (
          <button type="button" className={`${classes.choice} ${classes.quiet}`} onClick={onDone}>
            Done — no more
          </button>
        )}
      </div>
    </>
  );
}

/** Follow (spending a strategy token, with the card's secondary) or decline; once, never on your own card. */
function Follow({ opts, status, reason, faction, onPick }: { opts: Opt[]; status: string; reason: string | null; faction?: string | null; onPick: (id: string) => void }) {
  const others = opts.filter((o) => o.value!.who !== "holder");
  /* Declined by the game (no strategy token…): the follow stays listed, greyed with why (never hidden). */
  if (status === "declined" && !reason) return <p className={classes.sub}>You are not following this card.</p>;
  const decline = others.find((o) => o.value!.action === "decline");
  const secondary = others.filter((o) => o.value!.action !== "decline" && o.value!.action !== "follow");
  const follow = others.find((o) => o.value!.action === "follow");
  if (status === "followed") {
    return (
      <div className={classes.choices}>
        {secondary.map((o) => {
          const lim = limitFor(o, faction);
          return (
            <Choice key={o.id} option={lim ? { ...o, disabled: true } : o} onPick={onPick} title={lim ?? undefined}>
              {o.label}
              {lim && <Meta>{lim}</Meta>}
            </Choice>
          );
        })}
      </div>
    );
  }
  const main = secondary.length ? secondary : follow ? [follow] : [];
  /* Can't follow (no strategy token, …): the follow stays visible, greyed with the reason. */
  const why = reason ? (REASON[reason] ?? reason) : null;
  return (
    <>
      <span className={classes.sectionLabel}>Follow</span>
      {why && <p className={classes.warn}>{status === "declined" ? `${why} You were marked as not following.` : why}</p>}
      <div className={classes.choices}>
        {main.map((o) => {
          const lim = why ?? limitFor(o, faction);
          return (
          <Choice key={o.id} option={lim ? { ...o, disabled: true } : o} onPick={onPick} title={lim ?? undefined}>
            {o.label}
            {!why && lim && <Meta>{lim}</Meta>}
            {o.value!.spendsToken && <Meta>1 strategy token{o.value!.followCost ? ` + ${o.value!.followCost} resources` : ""}</Meta>}
            {!o.value!.spendsToken && o.value!.action.endsWith("_free") && <Meta>free — only if the holder agreed</Meta>}
          </Choice>
          );
        })}
        {decline && status !== "declined" && <Choice option={decline} onPick={onPick} quiet />}
      </div>
    </>
  );
}
