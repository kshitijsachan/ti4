import { Loader, UnstyledButton } from "@mantine/core";
import cx from "clsx";
import { publicObjectives } from "@/entities/data/publicObjectives";
import { secretObjectives } from "@/entities/data/secretObjectives";
import type { Objective } from "@/entities/data/types";
import { baseId, type Choice } from "../model/controls";
import type { ScoreState } from "../model/scoring";
import { ChoiceButtons } from "../ui/ChoiceButtons";
import { FactionIcon, Section } from "../ui/parts";
import { playerByName, type RendererProps } from "./types";
import classes from "./Objectives.module.css";

const PO_SCORE = /^po_scoring_(\d+)/;
const SO_SCORE = /^so_score_hand_(\d+)/;

function stateText(s: ScoreState | undefined, what: "public" | "secret") {
  if (!s) return undefined;
  if (s.kind === "scored") return `Scored ${s.name}`;
  if (s.kind === "none") return `No ${what} objective this round`;
  if (s.kind === "queued") return "Queued — scores once earlier players answer";
  return undefined;
}

function StateChip({ s }: { s?: ScoreState }) {
  if (!s) return null;
  const label =
    s.kind === "open"
      ? "Waiting"
      : s.kind === "queued"
        ? "Queued"
        : s.kind === "none"
          ? "Passed"
          : "Scored";
  return (
    <span className={cx(classes.chip, classes[`chip_${s.kind}`])}>{label}</span>
  );
}

function revealedPublics(objectives?: {
  stage1Objectives: Objective[];
  stage2Objectives: Objective[];
}) {
  if (!objectives) return [];
  return [
    ...objectives.stage1Objectives,
    ...objectives.stage2Objectives,
  ].filter((o) => o.revealed);
}

/** One revealed public objective: what it asks, how far I am, who has it, and its Score button. */
function PublicRow({
  o,
  faction,
  choice,
  onPress,
  pendingKey,
  scoredByMe,
}: {
  o: Objective;
  faction?: string;
  choice?: Choice;
  onPress: RendererProps["onPress"];
  pendingKey: string | null;
  scoredByMe: boolean;
}) {
  const card = publicObjectives.find((p) => p.alias === o.key);
  const progress = faction ? o.factionProgress?.[faction] : undefined;
  const met =
    o.progressThreshold > 0 &&
    progress !== undefined &&
    progress >= o.progressThreshold;
  const stage2 = o.pointValue >= 2;
  return (
    <div
      className={cx(
        classes.objective,
        stage2 ? classes.stage2 : classes.stage1,
        met && !scoredByMe && classes.met,
      )}
    >
      <div className={classes.objMain}>
        <div className={classes.objHead}>
          <span className={classes.objName}>{o.name}</span>
          <span className={classes.vp}>{o.pointValue} VP</span>
          {scoredByMe ? (
            <span className={cx(classes.chip, classes.chip_scored)}>
              You have it
            </span>
          ) : o.progressThreshold > 0 && progress !== undefined ? (
            <span className={cx(classes.progress, met && classes.progressMet)}>
              {met ? "You meet this" : `${progress} of ${o.progressThreshold}`}
            </span>
          ) : null}
        </div>
        {card?.text && <div className={classes.objText}>{card.text}</div>}
        {o.scoredFactions.length > 0 && (
          <div className={classes.scoredBy}>
            Scored by
            {o.scoredFactions.map((f) => (
              <FactionIcon key={f} faction={f} size={16} />
            ))}
          </div>
        )}
      </div>
      {choice && !scoredByMe && (
        <UnstyledButton
          className={cx(classes.scoreBtn, met && classes.scoreBtnMet)}
          disabled={!!pendingKey}
          onClick={() => onPress(choice)}
        >
          {pendingKey === choice.key ? (
            <Loader size={14} color="currentColor" />
          ) : (
            "Score"
          )}
        </UnstyledButton>
      )}
    </div>
  );
}

/**
 * Status-phase scoring: the revealed public objectives with my progress and who has scored them, a Score button
 * on each, then the secret-objective half, and where everyone else stands.
 */
export function ScoringBody({
  d,
  data,
  onPress,
  pressOn,
  pendingKey,
}: RendererProps) {
  if (d.scoring?.secretPick)
    return (
      <SecretPickBody
        d={d}
        data={data}
        onPress={onPress}
        pendingKey={pendingKey}
      />
    );
  const info = d.scoring;
  const mine = info?.mine;
  const faction = data.me?.faction;
  const byId = (re: RegExp) =>
    d.choices.filter((c) => re.test(baseId(c.customId)));
  const poChoices = byId(PO_SCORE);
  const poOpen = !mine || mine.po.kind === "open";
  const soOpen = !mine || mine.so.kind === "open";
  const publics = revealedPublics(data.web?.objectives);
  const choiceFor = (o: Objective) =>
    poChoices.find(
      (c) =>
        c.label
          .replace(/^\(\d+\)\s*/, "")
          .trim()
          .toLowerCase() === o.name.toLowerCase(),
    );
  const unmatched = poChoices.filter(
    (c) => !publics.some((o) => choiceFor(o) === c),
  );
  const others = (info?.lines ?? []).filter((l) => l !== mine);
  const pick = d.steps?.find((s) => s.scoring?.secretPick);
  const waitingOn = others.filter(
    (l) => l.po.kind === "open" || l.so.kind === "open",
  );

  return (
    <div className={classes.stack}>
      <Section label="Public objective" aside={<StateChip s={mine?.po} />}>
        {poOpen ? (
          <p className={classes.hint}>
            Score at most one public objective you meet right now.
          </p>
        ) : (
          <p className={classes.done}>{stateText(mine?.po, "public")}</p>
        )}
        <div className={classes.list}>
          {publics.map((o) => (
            <PublicRow
              key={o.key}
              o={o}
              faction={faction}
              choice={poOpen ? choiceFor(o) : undefined}
              onPress={onPress}
              pendingKey={pendingKey}
              scoredByMe={!!faction && o.scoredFactions.includes(faction)}
            />
          ))}
        </div>
        {poOpen && (
          <ChoiceButtons
            choices={[
              ...unmatched,
              ...byId(/^po_no_scoring$/).map((c) => ({
                ...c,
                label: "Don't score a public objective",
              })),
            ]}
            onPress={onPress}
            pendingKey={pendingKey}
            channelId={d.prompt.channelId}
            rankOf={() => "secondary"}
          />
        )}
      </Section>
      <Section label="Secret objective" aside={<StateChip s={mine?.so} />}>
        {info?.soHint && soOpen && (
          <p className={classes.hint}>{info.soHint}</p>
        )}
        {soOpen && pick ? (
          <>
            <SecretList
              d={pick}
              onPress={pressOn(pick)}
              pendingKey={pendingKey}
            />
            <ChoiceButtons
              choices={byId(/^so_no_scoring$/).map((c) => ({
                ...c,
                label: "Don't score a secret",
                style: 2,
              }))}
              onPress={onPress}
              pendingKey={pendingKey}
              channelId={d.prompt.channelId}
              rankOf={() => "secondary"}
            />
          </>
        ) : soOpen ? (
          <ChoiceButtons
            choices={[
              ...byId(/^get_so_score_buttons$/).map((c) => ({
                ...c,
                label: "Score a secret objective…",
                style: 1,
              })),
              ...byId(/^so_no_scoring$/).map((c) => ({
                ...c,
                label: "Don't score a secret",
                style: 2,
              })),
            ]}
            onPress={onPress}
            pendingKey={pendingKey}
            channelId={d.prompt.channelId}
            rankOf={() => "primary"}
          />
        ) : (
          <p className={classes.done}>{stateText(mine?.so, "secret")}</p>
        )}
      </Section>
      {others.length > 0 && (
        <div className={classes.table}>
          <span className={classes.tableLabel}>
            {waitingOn.length
              ? `Waiting on ${waitingOn.map((l) => l.name).join(", ")}`
              : "Everyone else has answered"}
          </span>
          <ul className={classes.tableList}>
            {others.map((l) => (
              <li key={l.name}>
                <FactionIcon
                  faction={playerByName(data, l.name)?.faction}
                  size={14}
                />
                <span className={classes.tableName}>{l.name}</span>
                <span className={classes.tableState}>
                  {lineText(l.po, "public")}
                </span>
                <span className={classes.tableState}>
                  {lineText(l.so, "secret")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function lineText(s: ScoreState, what: "public" | "secret") {
  if (s.kind === "scored") return s.name;
  if (s.kind === "none") return `no ${what}`;
  if (s.kind === "queued") return `${what} queued`;
  return `${what} …`;
}

/** "Score A Secret Objective" pressed: the secret objectives in my hand, each with its text. */
function SecretPickBody({
  d,
  onPress,
  pendingKey,
}: Pick<RendererProps, "d" | "data" | "onPress" | "pendingKey">) {
  const rest = d.choices.filter((c) => !SO_SCORE.test(baseId(c.customId)));
  return (
    <div className={classes.stack}>
      {d.scoring?.soHint && <p className={classes.hint}>{d.scoring.soHint}</p>}
      <SecretList d={d} onPress={onPress} pendingKey={pendingKey} />
      {rest.length > 0 && (
        <ChoiceButtons
          choices={rest}
          onPress={onPress}
          pendingKey={pendingKey}
          channelId={d.prompt.channelId}
        />
      )}
    </div>
  );
}

/** My unscored secret objectives, each with its text and a Score button. */
function SecretList({
  d,
  onPress,
  pendingKey,
}: Pick<RendererProps, "d" | "onPress" | "pendingKey">) {
  const picks = d.choices.filter((c) => SO_SCORE.test(baseId(c.customId)));
  return (
    <div className={classes.list}>
      {picks.map((c) => {
        const name = c.label.replace(/^\(\d+\)\s*/, "").trim();
        const card = secretObjectives.find(
          (so) => so.name.toLowerCase() === name.toLowerCase(),
        );
        return (
          <div key={c.key} className={cx(classes.objective, classes.secret)}>
            <div className={classes.objMain}>
              <div className={classes.objHead}>
                <span className={classes.objName}>{name}</span>
                <span className={classes.vp}>1 VP</span>
                {card?.phase && !/status/i.test(card.phase) && (
                  <span className={classes.progress}>{card.phase} phase</span>
                )}
              </div>
              {card?.text && <div className={classes.objText}>{card.text}</div>}
            </div>
            <UnstyledButton
              className={classes.scoreBtn}
              disabled={!!pendingKey}
              onClick={() => onPress(c)}
            >
              {pendingKey === c.key ? (
                <Loader size={14} color="currentColor" />
              ) : (
                "Score"
              )}
            </UnstyledButton>
          </div>
        );
      })}
    </div>
  );
}
