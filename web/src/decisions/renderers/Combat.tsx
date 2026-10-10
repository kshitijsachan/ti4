import { useMemo, type ReactNode } from "react";
import { usePlay, type Message } from "@/discord";
import type { PlayerData, TileUnitData } from "@/entities/data/types";
import { getPlanetData } from "@/entities/lookup/planets";
import type { Decision } from "../model/classify";
import { baseId, choicesOf as choicesOfMessage, type Choice, type ChoiceRank } from "../model/controls";
import { ChoiceButtons } from "../ui/ChoiceButtons";
import { FactionIcon } from "../ui/parts";
import { playerByFaction, type RendererProps } from "./types";
import { HitPanel, UnitTile } from "./combat/HitPanel";
import { RetreatPicker, isRetreatPrompt } from "./combat/Retreat";
import { readCombatLog, type CombatLog, type Roll } from "./combat/rolls";
import { useRunFlow, doneOf } from "./combat/run";
import {
  botPlan,
  parsePick,
  picksOf,
  pressesFor,
  rowsFromPicks,
  rowsFromTile,
  samePlan,
  sortRows,
  suggestPlan,
  unitName,
  type HitTarget,
  type PickButton,
  type Plan,
  type UnitRowModel,
} from "./combat/units";
import classes from "./combat/combat.module.css";

const planetName = (id: string) => getPlanetData(id)?.name ?? id;

/** The bot's emoji name for a faction ("Mentak") against a faction id ("mentak"). */
export function sameFaction(emoji: string | undefined, faction: string | undefined) {
  if (!emoji || !faction) return false;
  const a = emoji.toLowerCase();
  const b = faction.toLowerCase();
  return a === b || a.startsWith(b) || b.startsWith(a);
}

/** Every message of the combat thread, oldest first. */
function useThread(channelId: string): Message[] {
  const data = usePlay((s) => s.messages[channelId]);
  return useMemo(() => (data ? data.ids.map((id) => data.byId[id]).filter(Boolean) : []), [data]);
}

type HitKind = { target: HitTarget; hits: number; planet?: string; label: string };

/** "Assign N hits" prompts: which units the hits may land on, and how many. */
function hitKindOf(id: string): HitKind | null {
  let m = id.match(/^autoAssignSpaceHits_[^_]+_(\d+)/);
  if (m) return { target: "space", hits: Number(m[1]), label: "hit" };
  m = id.match(/^autoAssignAFBHits_[^_]+_(\d+)/);
  if (m) return { target: "afb", hits: Number(m[1]), label: "anti-fighter barrage hit" };
  m = id.match(/^autoAssignSpaceCannonOffenceHits_[^_]+_(\d+)/);
  if (m) return { target: "space", hits: Number(m[1]), label: "space cannon hit" };
  m = id.match(/^autoAssignGroundHits_(.+)_(\d+)$/);
  if (m) return { target: "ground", hits: Number(m[2]), planet: m[1], label: "hit" };
  return null;
}

const AUTO = /^autoAssign\w*Hits_/;
/** combatRoll_<position>_<space | planet>: a combat round's roll (not _afb / _bombardment / space cannon). */
const ROUND_ROLL = /^combatRoll_[^_]+_[^_]+$/;

type Found = { c: Choice; on: Decision };

function find(all: Decision[], test: (id: string, c: Choice) => boolean, prefer?: (d: Decision) => boolean): Found | undefined {
  const order = prefer ? [...all.filter(prefer), ...all.filter((d) => !prefer(d))] : all;
  for (const d of order) {
    const c = d.choices.find((x) => !x.disabled && test(baseId(x.customId), x));
    if (c) return { c, on: d };
  }
  return undefined;
}

function Side({ player, rows, fallback }: { player?: PlayerData; rows: UnitRowModel[]; fallback: string }) {
  return (
    <div className={classes.side}>
      <span className={classes.sideName}>
        <FactionIcon faction={player?.faction} size={16} />
        {player?.userName ?? fallback}
      </span>
      <span className={classes.sideTiles}>
        {rows.length ? (
          rows.map((r) => <UnitTile key={r.key} unit={r.unit} color={player?.color} count={r.count} damaged={r.damaged} />)
        ) : (
          <span className={classes.none}>No units left</span>
        )}
      </span>
    </div>
  );
}

/** Units of any player in the fight, from the live map. */
function sideRows(tile: TileUnitData | undefined, player: PlayerData | undefined, ground: boolean, planet?: string) {
  if (!player) return [];
  const rows = rowsFromTile(tile, player, ground ? "ground" : "space", planet);
  return sortRows(rows);
}

const ROLL_WORD: Record<Roll["kind"], string> = {
  combat: "",
  afb: "Anti-fighter barrage",
  bombardment: "Bombardment",
  spaceCannonOffence: "Space cannon",
  spaceCannonDefence: "Space cannon defence",
};

function RollRow({ who, roll, waiting }: { who: PlayerData | undefined; roll?: Roll; waiting: string }) {
  const dice = roll?.lines.flatMap((l) => l.dice) ?? [];
  return (
    <div className={classes.rollRow}>
      <span className={classes.rollWho}>
        <FactionIcon faction={who?.faction} size={14} />
        {who?.userName ?? "Opponent"}
      </span>
      {roll ? (
        <span className={classes.dice} title={roll.lines.map((l) => `${l.count}× ${l.unit ? unitName(l.unit, l.count) : "unit"} hit on ${l.hitsOn ?? "?"}+`).join(" · ")}>
          {dice.map((die, i) => (
            <span key={i} className={die.hit ? `${classes.die} ${classes.dieHit}` : classes.die}>
              {die.value}
            </span>
          ))}
        </span>
      ) : (
        <span className={classes.rollWaiting}>{waiting}</span>
      )}
      {roll && (
        <span className={classes.rollHits}>
          → {roll.total} hit{roll.total === 1 ? "" : "s"}
        </span>
      )}
    </div>
  );
}

/** The round being fought: my dice and theirs ("rolled 7, 3 → 1 hit"), plus any barrage / space cannon this combat. */
function RoundReadout({ log, round, ground, me, enemy }: { log: CombatLog; round: number; ground: boolean; me?: PlayerData; enemy?: PlayerData }) {
  const mine = log.rolls.find((r) => r.kind === "combat" && r.round === round && r.ground === ground && sameFaction(r.faction, me?.faction));
  const theirs = log.rolls.find((r) => r.kind === "combat" && r.round === round && r.ground === ground && sameFaction(r.faction, enemy?.faction));
  /* Before round 1: anti-fighter barrage and space cannon offence (space), bombardment and space cannon defence (ground). */
  const before: Roll["kind"][] = ground ? ["bombardment", "spaceCannonDefence"] : ["afb", "spaceCannonOffence"];
  /* Only the latest of each kind per side (a bot that restarts may roll its barrage again). */
  const latest = new Map<string, Roll>();
  for (const r of log.rolls) if (before.includes(r.kind)) latest.set(`${r.kind}:${r.faction}`, r);
  const pre = round <= 1 ? [...latest.values()] : [];
  if (!round && !pre.length) return null;
  return (
    <div className={classes.round}>
      {pre.map((r) => (
        <div key={r.id} className={classes.round}>
          <span className={classes.roundHead}>{ROLL_WORD[r.kind]}</span>
          <RollRow who={sameFaction(r.faction, me?.faction) ? me : enemy} roll={r} waiting="" />
        </div>
      ))}
      {round > 0 && (
        <>
          <span className={classes.roundHead}>
            Round <span className={classes.mono}>{round}</span>
          </span>
          <RollRow who={me} roll={mine} waiting="not rolled yet" />
          <RollRow who={enemy} roll={theirs} waiting="not rolled yet" />
        </>
      )}
    </div>
  );
}

/** The last combat round `faction` rolled in this fight (0: none yet). */
function lastRoundOf(log: CombatLog, faction: string | undefined, ground: boolean) {
  return Math.max(0, ...log.rolls.filter((r) => r.kind === "combat" && r.ground === ground && sameFaction(r.faction, faction)).map((r) => r.round ?? 0));
}

function rankOf(c: Choice): ChoiceRank {
  if (c.rank === "undo") return c.rank;
  return c.rank === "primary" && c.style === 3 ? "primary" : "more";
}

/** Plain names for the combat extras left under More options. */
function relabel(c: Choice): Choice {
  const id = baseId(c.customId);
  if (/^combatRoll_[^_]+_space_afb$/.test(id)) return { ...c, label: "Roll anti-fighter barrage" };
  if (/_bombardment/.test(id)) return { ...c, label: "Roll bombardment" };
  if (/^getDamageButtons_/.test(id)) return { ...c, label: "Assign hits by hand" };
  if (/^getRepairButtons_/.test(id)) return { ...c, label: "Repair damage (an ability)" };
  if (/^announceARetreat/.test(id)) return { ...c, label: "Announce a retreat" };
  if (/^retreat_/.test(id)) return { ...c, label: "Retreat now" };
  if (/^automateGroundCombat_/.test(id)) return { ...c, label: "Automate the whole ground combat (opponent must agree)" };
  if (/^cancel\w*Hits_/.test(id)) return { ...c, label: "Cancel a hit (an ability)" };
  return c;
}

/** Buttons the panels below already cover, or that mean nothing here. */
const COVERED = /^(autoAssign\w*Hits_|getDamageButtons_\d+deleteThis|combatRoll_[^_]+_[^_]+$|checkCombatACs|announceReadyForDice|refreshViewOfSystem)/;

/**
 * A combat, one popup: both sides as unit tiles, the round's dice ("rolled 7, 3 → 1 hit"), then the one thing to do
 * now — roll the round, assign the hits I took (tiles with Sustain / Destroy, the cheapest assignment prefilled), pick
 * a retreat destination, or wait for the opponent.
 */
export function CombatBody({ d, data, pressOn, pendingKey, onHoverChoice }: RendererProps) {
  const runFlow = useRunFlow();
  const combat = d.combat;
  const all = useMemo(() => [d, ...(d.steps ?? [])], [d]);
  const me = data.me;
  const myFaction = me?.faction;
  const enemyFaction = combat?.factions.find((f) => f !== myFaction);
  const enemy = playerByFaction(data, enemyFaction);
  const thread = useThread(d.prompt.channelId);
  const myId = usePlay((s) => s.me?.id);
  const log = useMemo(() => readCombatLog(thread, myFaction, myId), [thread, myFaction, myId]);
  const ground = combat?.kind === "ground";
  const pos = combat?.position;
  const tile = pos ? data.web?.tileUnitData?.[pos] : undefined;

  const retreat = all.find((x) => isRetreatPrompt(x));
  const pickPrompt = [...all].reverse().find((x) => picksOf(x.choices).some((p) => !p.prefix || p.prefix.includes(`_${myFaction}_`)));
  /* Anti-fighter barrage and space cannon hits come before the round's: assign those first. */
  const auto =
    find(all, (id) => /^autoAssignAFBHits_/.test(id)) ?? find(all, (id) => /^autoAssignSpaceCannonOffenceHits_/.test(id)) ?? find(all, (id) => AUTO.test(id));
  const hitKind = auto ? hitKindOf(baseId(auto.c.customId)) : null;
  const plain = (x: Decision) => !x.choices.some((c) => AUTO.test(baseId(c.customId)));
  const roll = find(all, (id) => ROUND_ROLL.test(id) && (ground ? !/_space$/.test(id) : /_space$/.test(id)), plain) ?? find(all, (id) => ROUND_ROLL.test(id), plain);

  const myRound = lastRoundOf(log, myFaction, ground);
  const theirRound = lastRoundOf(log, enemyFaction, ground);
  const round = Math.max(myRound, theirRound);
  const rolledThis = round > 0 && myRound >= round;
  const nextRound = rolledThis ? round + 1 : Math.max(round, 1);

  const myRows = sideRows(tile, me, ground, combat?.planet);
  const enemyRows = sideRows(tile, enemy, ground, combat?.planet);
  const holderNames = useMemo(() => Object.fromEntries(Object.keys(tile?.planets ?? {}).map((p) => [p, planetName(p)])), [tile]);

  const sides = (
    <div className={classes.sides}>
      <Side player={me} rows={myRows} fallback="You" />
      <Side player={enemy} rows={enemyRows} fallback="Opponent" />
    </div>
  );
  const readout = <RoundReadout log={log} round={round} ground={ground} me={me} enemy={enemy} />;

  const press = (f: Found) => pressOn(f.on)(f.c);
  const covered = new Set<string>();
  const cover = (f?: Found) => f && covered.add(f.c.key);

  let main: ReactNode;
  if (retreat) {
    main = <RetreatPicker d={retreat} data={data} pressOn={pressOn} pendingKey={pendingKey} />;
    /* Its Done ("Done Retreating troops" / keep them all) stays below. */
    retreat.choices.filter((c) => baseId(c.customId) !== "deleteButtons").forEach((c) => covered.add(c.key));
  } else if (pickPrompt) {
    /* The bot's per-unit buttons are up (assign by hand): the same tiles, pressed on that prompt. */
    const picks = picksOf(pickPrompt.choices).filter((p) => !p.prefix || p.prefix.includes(`_${myFaction}_`));
    const rows = rowsFromPicks(picks, tile, me);
    /* Only an open "assign N hits" says how many; a by-hand prompt alone is free-form. */
    const hits = hitKind?.hits;
    const sustain = rows.some((r) => r.canSustain);
    main = (
      <HitPanel
        key={pickPrompt.id}
        rows={rows}
        color={me?.color}
        hits={hits || undefined}
        mode="combat"
        initial={suggestPlan(rows, hits ?? 0, sustain)}
        holderNames={holderNames}
        heading={hits ? `Assign ${hits} hit${hits === 1 ? "" : "s"}` : "Assign hits"}
        runKey={`hits:${pickPrompt.id}`}
        onConfirm={(plan) =>
          void runFlow({
            key: `hits:${pickPrompt.id}`,
            target: { channelId: pickPrompt.prompt.channelId, messageId: pickPrompt.id },
            ids: pressesFor(plan, rows, picks).map((customId) => ({ customId, label: labelOf(customId) })),
            finish: doneOf,
          })
        }
      />
    );
    pickPrompt.choices.forEach((c) => covered.add(c.key));
  } else if (auto && hitKind && (rolledThis || !roll || !/^autoAssign(Space|Ground)Hits_/.test(baseId(auto.c.customId)))) {
    main = <AssignHits auto={auto} kind={hitKind} all={all} data={data} tile={tile} pos={pos} holderNames={holderNames} runFlow={runFlow} />;
    auto.on.choices.forEach((c) => covered.add(c.key));
  } else if (roll && !rolledThis) {
    const incoming = hitKind ? hitKind.hits : 0;
    main = (
      <>
        <p className={classes.status}>
          {incoming
            ? `${enemy?.userName ?? "Your opponent"} rolled ${incoming} hit${incoming === 1 ? "" : "s"} on you. Roll your dice first — every unit fights this round — then assign them.`
            : theirRound >= nextRound
              ? `${enemy?.userName ?? "Your opponent"} has rolled. Your turn to roll round ${nextRound}.`
              : `Round ${nextRound}: both sides roll, then each assigns the hits they took.`}
        </p>
        <ChoiceButtons
          choices={[{ ...roll.c, label: `Roll round ${nextRound}`, style: 3, rank: "primary" }]}
          onPress={() => press(roll)}
          pendingKey={pendingKey}
          channelId={roll.on.prompt.channelId}
          onHover={onHoverChoice}
        />
      </>
    );
    cover(roll);
  } else {
    const waitingRoll = theirRound < myRound;
    main = (
      <p className={classes.status}>
        {round === 0
          ? "Waiting for the combat to start."
          : waitingRoll
          ? `Waiting for ${enemy?.userName ?? "your opponent"} to roll round ${myRound}.`
          : log.retreatAnnounced
            ? "You announced a retreat: retreat now, or roll on."
            : `Round ${round} is resolved. Waiting for ${enemy?.userName ?? "your opponent"} to assign hits, then the next round.`}
      </p>
    );
  }

  /* After a round: retreat now (if announced) or roll the next one. */
  const retreatNow = !retreat ? find(all, (id) => /^retreat_\d+/.test(id) || /^retreat_[^_]+$/.test(id)) : undefined;
  const nextRoll = !retreat && !pickPrompt && !(auto && hitKind) && rolledThis && roll && theirRound >= myRound ? roll : undefined;
  const actions: Choice[] = [];
  if (nextRoll) {
    actions.push({ ...nextRoll.c, key: `next:${nextRoll.c.key}`, label: `Roll round ${round + 1}`, style: 3, rank: "primary" });
    cover(nextRoll);
  }
  if (retreatNow && log.retreatAnnounced) {
    actions.push({ ...retreatNow.c, key: `retreat:${retreatNow.c.key}`, label: "Retreat now", style: 1, rank: "primary" });
    cover(retreatNow);
  }
  const extraItems = all.flatMap((x) =>
    x.choices
      .filter((c) => !covered.has(c.key) && !COVERED.test(baseId(c.customId)))
      .map((c) => ({ c: relabel({ ...c, key: `${x.id}:${c.key}` }), on: x, orig: c })),
  );
  const seen = new Set<string>();
  const extras = extraItems.filter((it) => {
    const id = it.c.customId ?? it.c.key;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const byKey = new Map(extras.map((it) => [it.c.key, it]));
  const actionKeys = new Map(actions.map((a) => [a.key, a]));

  return (
    <div className={classes.stack}>
      {sides}
      {readout}
      {main}
      {actions.length > 0 && (
        <ChoiceButtons
          choices={actions}
          onPress={(c) => {
            const a = actionKeys.get(c.key);
            if (!a) return;
            const f = c.key.startsWith("next:") ? nextRoll : retreatNow;
            if (f) press(f);
          }}
          pendingKey={pendingKey}
          channelId={d.prompt.channelId}
          onHover={onHoverChoice}
        />
      )}
      {extras.length > 0 && (
        <ChoiceButtons
          choices={extras.map((it) => ({ ...it.c, rank: rankOf(it.c) === "primary" ? "more" : rankOf(it.c) }))}
          onPress={(c, values) => {
            const it = byKey.get(c.key);
            if (!it) return;
            pressOn(it.on)({ ...it.orig, key: it.orig.key }, values);
          }}
          pendingKey={pendingKey}
          channelId={d.prompt.channelId}
          rankOf={(c) => (c.rank === "undo" ? "undo" : "more")}
          onHover={onHoverChoice}
        />
      )}
    </div>
  );
}

function labelOf(customId: string) {
  const p = parsePick({ key: customId, kind: "button", customId, label: "", style: 2, disabled: false, rank: "primary", component: { type: 2 } });
  if (!p) return "Pressing";
  return `${p.action === "assignDamage" ? "Sustaining" : "Destroying"} 1 ${unitName(p.unit)}`;
}

/** "Assign 4 hits": tiles prefilled with the bot's own suggestion (or the cheapest), Confirm presses it. */
function AssignHits({ auto, kind, all, data, tile, pos, holderNames, runFlow }: {
  auto: Found;
  kind: HitKind;
  all: Decision[];
  data: RendererProps["data"];
  tile: TileUnitData | undefined;
  pos?: string;
  holderNames: Record<string, string>;
  runFlow: ReturnType<typeof useRunFlow>;
}) {
  const me = data.me;
  const rows = rowsFromTile(tile, me, kind.target, kind.planet);
  const fromBot = botPlan(auto.on.text, rows);
  const initial = fromBot ?? suggestPlan(rows, kind.hits);
  const manual = auto.on.choices.find((c) => /^getDamageButtons_/.test(baseId(c.customId))) ?? all.flatMap((x) => x.choices).find((c) => /^getDamageButtons_/.test(baseId(c.customId)));
  const runKey = `hits:${auto.on.id}`;
  const template: PickButton[] = me && pos
    ? [{ choice: auto.c, action: "assignHits", pos, unit: "ff", holder: "space", color: me.color, prefix: `FFCC_${me.faction}_` }]
    : [];
  const heading = `Assign ${kind.hits} ${kind.label}${kind.hits === 1 ? "" : "s"}`;
  const note = kind.target === "afb" ? "Anti-fighter barrage only hits fighters." : undefined;
  return (
    <HitPanel
      key={auto.on.id}
      rows={rows}
      color={me?.color}
      hits={kind.hits}
      mode="combat"
      initial={initial}
      holderNames={holderNames}
      heading={heading}
      note={note}
      runKey={runKey}
      onConfirm={(plan: Plan) => {
        const channelId = auto.on.prompt.channelId;
        if (fromBot && samePlan(plan, fromBot)) {
          void runFlow({ key: runKey, target: { channelId, messageId: auto.on.id }, ids: [{ customId: auto.c.customId!, label: "Assigning hits" }] });
          return;
        }
        if (!manual?.customId) return;
        const picks = (m: Message) => picksOf(choicesOfMessage(m)).some((p) => p.prefix.includes(`_${me?.faction}_`) || !p.prefix);
        void runFlow({
          key: runKey,
          opener: { channelId, messageId: manual === auto.c ? auto.on.id : (all.find((x) => x.choices.includes(manual))?.id ?? auto.on.id), customId: manual.customId, label: "Opening the unit buttons" },
          isFollowUp: (m) => !!m.author?.bot && picks(m),
          ids: pressesFor(plan, rows, template).map((customId) => ({ customId, label: labelOf(customId) })),
          finish: doneOf,
        });
      }}
    />
  );
}

