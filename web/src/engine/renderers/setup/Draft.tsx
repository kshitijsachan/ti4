import type { DraftPlayer, GameState, Option } from "../../../../../shim/src/engine/types";
import { Choice, ErrorLine, FactionIcon, playerName, useAnswer, useFactionName } from "./parts";
import type { Renderer } from "./types";
import classes from "./Setup.module.css";

type Category = "slice" | "faction" | "order";

const CATEGORY_LABEL: Record<Category, string> = { slice: "Slice", faction: "Faction", order: "Speaker order" };

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

function held(p: DraftPlayer | undefined, category: Category) {
  if (!p) return null;
  if (category === "slice") return p.slice;
  if (category === "faction") return p.faction;
  return p.speakerOrder;
}

function onBoard(state: GameState | null, category: Category, pick: string) {
  const a = state?.draft?.available;
  if (!a) return true;
  if (category === "slice") return a.slices.includes(pick);
  if (category === "faction") return a.factions.includes(pick);
  return a.speakerOrders.includes(Number(pick));
}

function me(state: GameState | null) {
  return state?.players.find((p) => p.self)?.userId ?? null;
}

/** Your picks so far, one line: Faction · Slice · Speaker order. */
function MyPicks({ state }: { state: GameState | null }) {
  const factionName = useFactionName();
  const mine = state?.draft?.players.find((p) => p.userId === me(state));
  if (!mine) return null;
  const show = (c: Category) => {
    const v = held(mine, c);
    if (v == null) return <span className={classes.pickOpen}>{CATEGORY_LABEL[c]}: open</span>;
    const text = c === "faction" ? factionName(String(v)) : c === "order" ? ordinal(Number(v)) : String(v);
    return (
      <span className={classes.pickHeld}>
        {CATEGORY_LABEL[c]}: {text}
      </span>
    );
  };
  return (
    <div className={classes.picks}>
      {show("faction")}
      {show("slice")}
      {show("order")}
    </div>
  );
}

/** One board (slices, factions or speaker order) of the Milty draft; options read from value + state only. */
export const MiltyDraftPickRenderer: Renderer<"draft.milty.pick"> = ({ decision, state, answer }) => {
  const { pending, error, press } = useAnswer(answer);
  const factionName = useFactionName();
  const viewer = me(state);
  const current = state?.draft?.currentPlayer ?? decision.target?.userId ?? null;
  const myTurn = !!viewer && current === viewer;
  const mine = state?.draft?.players.find((p) => p.userId === viewer);
  const options = decision.options.filter((o): o is Option<{ category: Category; pick: string }> => !!o.value);
  const category: Category = options[0]?.value?.category ?? "slice";
  const already = held(mine, category);

  const whyNot = (o: Option<{ category: Category; pick: string }>) => {
    if (!myTurn) return `${playerName(state, current)} is picking`;
    if (already != null) return `You already have a ${CATEGORY_LABEL[category].toLowerCase()}`;
    if (!onBoard(state, o.value!.category, o.value!.pick)) return "Taken";
    if (o.disabled) return "Not available";
    return null;
  };

  return (
    <div className={classes.stack}>
      <p className={classes.title}>
        {myTurn ? "Your pick" : `${playerName(state, current)} is up to draft`} · {CATEGORY_LABEL[category]}
      </p>
      <MyPicks state={state} />
      <div className={classes.grid}>
        {options.map((o) => {
          const { pick } = o.value!;
          const reason = whyNot(o);
          const name = category === "faction" ? factionName(pick) : category === "order" ? `${ordinal(Number(pick))} pick` : `Slice ${pick}`;
          return (
            <Choice
              key={o.id}
              name={name}
              icon={category === "faction" ? <FactionIcon faction={pick} /> : undefined}
              sub={reason ?? undefined}
              go={!reason}
              disabled={!!reason || !!pending}
              pending={pending === o.id}
              onClick={() => void press(o.id)}
            />
          );
        })}
      </div>
      <ErrorLine error={error} />
    </div>
  );
};

/** Queue picks for later (your cards thread). */
export const MiltyDraftQueueRenderer: Renderer<"draft.milty.queue"> = ({ decision, answer }) => {
  const { pending, error, press } = useAnswer(answer);
  const factionName = useFactionName();
  const label = (v: { action: string; category: Category | null; pick: string | null }) => {
    if (v.action === "restart") return "Restart my queue";
    if (v.action === "restart_all") return "Restart every queue";
    if (v.category === "faction") return factionName(v.pick);
    if (v.category === "order") return `${ordinal(Number(v.pick))} pick`;
    return `Slice ${v.pick}`;
  };
  const groups: (Category | "other")[] = ["faction", "slice", "order", "other"];
  return (
    <div className={classes.stack}>
      <p className={classes.hint}>Queue picks: when your turn comes, the first queued pick still on the board is taken for you.</p>
      {groups.map((g) => {
        const opts = decision.options.filter((o) => o.value && (g === "other" ? o.value.action !== "queue" : o.value.category === g));
        if (!opts.length) return null;
        return (
          <div key={g} className={classes.stack}>
            <span className={classes.label}>{g === "other" ? "Queue" : CATEGORY_LABEL[g]}</span>
            <div className={classes.row}>
              {opts.map((o) => (
                <Choice
                  key={o.id}
                  name={label(o.value!)}
                  icon={o.value!.category === "faction" ? <FactionIcon faction={o.value!.pick} /> : undefined}
                  disabled={o.disabled || !!pending}
                  pending={pending === o.id}
                  onClick={() => void press(o.id)}
                />
              ))}
            </div>
          </div>
        );
      })}
      <ErrorLine error={error} />
    </div>
  );
};

const VIEW_LABEL: Record<string, string> = {
  board: "Show the draft board",
  remaining: "Factions left",
  picked: "Factions picked",
  all: "All factions",
};

/** "<player> is up to draft" with its read-only views. */
export const MiltyDraftInfoRenderer: Renderer<"draft.milty.info"> = ({ decision, state, answer }) => {
  const { pending, error, press } = useAnswer(answer);
  const current = state?.draft?.currentPlayer ?? decision.target?.userId ?? null;
  const viewer = me(state);
  return (
    <div className={classes.stack}>
      <p className={classes.title}>{current && current === viewer ? "Your turn to draft" : `${playerName(state, current)} is up to draft`}</p>
      <MyPicks state={state} />
      <div className={classes.row}>
        {decision.options
          .filter((o) => o.value)
          .map((o) => (
            <Choice
              key={o.id}
              name={VIEW_LABEL[o.value!.view] ?? o.label}
              disabled={o.disabled || !!pending}
              pending={pending === o.id}
              onClick={() => void press(o.id)}
            />
          ))}
      </div>
      <ErrorLine error={error} />
    </div>
  );
};
