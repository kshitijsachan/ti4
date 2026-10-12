import { Button, Group } from "@mantine/core";
import type { Option } from "../../../../../shim/src/engine/types";
import type { StatusRevealObjective, StatusScore, StatusScoreSecret } from "../../../../../shim/src/engine/kinds/status";
import { Waiting, me, myStatus, objectiveName, playerName, type StatusRendererProps } from "./shared";
import classes from "./Status.module.css";

type ScoreValue = NonNullable<StatusScore["options"][number]["value"]>;
type PublicValue = Extract<ScoreValue, { action: "score_public" }>;

function declared(id: string | null | undefined, what: string) {
  if (!id) return null;
  if (id === "none") return <p className={classes.done}>You score no {what} objective this round.</p>;
  return <p className={classes.done}>Scored {objectiveName(id)}.</p>;
}

function PublicRow({ o, uid, answer }: { o: Option<ScoreValue>; uid: string; answer: StatusRendererProps["answer"] }) {
  const v = o.value as PublicValue;
  const meets = v.eligible.includes(uid);
  const progress = v.progress[uid] ?? 0;
  return (
    <button type="button" className={`${classes.objective} ${v.stage === 2 ? classes.stage2 : classes.stage1}`} disabled={!meets || o.disabled} onClick={() => answer(o.id)}>
      <span className={classes.name}>{objectiveName(v.objective)}</span>
      <span className={classes.meta}>{v.points} VP</span>
      {meets ? <span className={classes.met}>met</span> : v.threshold > 0 && <span className={classes.meta}>{Math.min(progress, v.threshold)}/{v.threshold}</span>}
    </button>
  );
}

/**
 * Status scoring: score one public objective I meet (or none) and one secret (or none). Unmet objectives are
 * listed but cannot be pressed. Imperial's own list (scope player) shows only the publics.
 */
export function StatusScoreRenderer({ decision, state, answer }: StatusRendererProps<StatusScore>) {
  const self = me(state);
  if (!self) return null;
  const st = myStatus(state);
  const opts = decision.options.filter((o) => o.value) as Option<ScoreValue>[];
  const publics = opts.filter((o) => o.value!.action === "score_public");
  const byAction = (a: string) => opts.find((o) => o.value!.action === a);
  const imperial = decision.scope === "player";
  const publicOpen = imperial || !st || st.publicScored === null;
  const secretOpen = !imperial && (!st || st.secretScored === null);
  const noPublic = byAction("no_public");
  const listSecrets = byAction("score_secret");
  const noSecret = byAction("no_secret");

  return (
    <div className={classes.stack}>
      <div className={classes.section}>
        <h4 className={classes.heading}>{imperial ? "Imperial: score a public objective" : "Public objective"}</h4>
        {publicOpen ? (
          <>
            {publics.map((o) => (
              <PublicRow key={o.id} o={o} uid={self.userId} answer={answer} />
            ))}
            {!publics.some((o) => (o.value as PublicValue).eligible.includes(self.userId)) && (
              <p className={classes.hint}>You meet none of the revealed public objectives.</p>
            )}
            {noPublic && (
              <Group>
                <Button size="xs" variant="default" onClick={() => answer(noPublic.id)}>
                  Score no public objective
                </Button>
              </Group>
            )}
          </>
        ) : (
          declared(st?.publicScored, "public")
        )}
      </div>
      {!imperial && (
        <div className={classes.section}>
          <h4 className={classes.heading}>Secret objective</h4>
          {secretOpen ? (
            <Group gap={6}>
              {listSecrets && (
                <Button size="xs" variant="light" disabled={!self.secretObjectiveCount} onClick={() => answer(listSecrets.id)}>
                  Choose a secret objective…
                </Button>
              )}
              {noSecret && (
                <Button size="xs" variant="default" onClick={() => answer(noSecret.id)}>
                  Score no secret objective
                </Button>
              )}
            </Group>
          ) : (
            declared(st?.secretScored, "secret")
          )}
        </div>
      )}
      <Waiting decision={decision} state={state} />
    </div>
  );
}

/** The private list of my secret objectives: the ones the engine knows I meet can be scored. */
export function StatusScoreSecretRenderer({ decision, state, answer }: StatusRendererProps<StatusScoreSecret>) {
  const inStatus = !!state?.status;
  return (
    <div className={classes.stack}>
      <h4 className={classes.heading}>Score a secret objective</h4>
      {decision.options.every((o) => !o.value || o.disabled || o.value.met === false || (inStatus && o.value.phase !== "status")) && (
        <p className={classes.hint}>None you can score now. Under “Score objectives”, choose “Score no secret objective”.</p>
      )}
      {decision.options.map((o) => {
        const v = o.value;
        if (!v) return null;
        const wrongPhase = inStatus && v.phase !== "status";
        const blocked = o.disabled || v.met === false || wrongPhase;
        return (
          <button key={o.id} type="button" className={`${classes.objective} ${classes.secret}`} disabled={blocked} onClick={() => answer(o.id)}>
            <span className={classes.name}>{objectiveName(v.secretObjective)}</span>
            {wrongPhase && <span className={classes.meta}>{v.phase} phase</span>}
            {!wrongPhase && v.met === true && <span className={classes.met}>met</span>}
            {!wrongPhase && v.met === false && (
              <span className={classes.meta}>
                {v.progress}/{v.threshold}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** The speaker reveals the next public objective; everyone else sees who the table waits on. */
export function StatusRevealObjectiveRenderer({ decision, state, answer }: StatusRendererProps<StatusRevealObjective>) {
  const self = me(state);
  const speaker = decision.target?.userId;
  if (!self || speaker !== self.userId) {
    return <p className={classes.hint}>Everyone has scored. Waiting for {speaker ? playerName(state, speaker) : "the speaker"} to reveal the next public objective.</p>;
  }
  const label = (v: NonNullable<StatusRevealObjective["options"][number]["value"]>) => {
    if (v.action === "end_game") return "End the game (no objectives left)";
    if (v.action === "continue") return "Continue without revealing";
    if (v.action === "rematch") return "Rematch (new game, same players)";
    const stage = v.stage === 2 ? "II" : "I";
    if (v.count === 2) return `Reveal two stage ${stage} objectives`;
    return v.position ? `Reveal stage ${stage}, position ${v.position}` : `Reveal the next stage ${stage} objective`;
  };
  return (
    <div className={classes.stack}>
      <p className={classes.hint}>Everyone has scored. As speaker, reveal the next public objective.</p>
      <Group gap={6}>
        {decision.options.map((o) =>
          o.value ? (
            <Button key={o.id} size="xs" variant={o.value.action === "end_game" ? "default" : "filled"} disabled={o.disabled} onClick={() => answer(o.id)}>
              {label(o.value)}
            </Button>
          ) : null,
        )}
      </Group>
    </div>
  );
}
