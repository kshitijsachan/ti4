import { usePlay } from "@/discord";
import type { EntityData, PlayerData, TileUnitData } from "@/entities/data/types";
import type { Decision } from "../model/classify";
import { baseId, type Choice, type ChoiceRank } from "../model/controls";
import { cleanText, namesFrom } from "../model/text";
import { ChoiceButtons } from "../ui/ChoiceButtons";
import { Details, FactionIcon, Prose, UnitRow } from "../ui/parts";
import { playerByFaction, type RendererProps } from "./types";
import classes from "./renderers.module.css";

function unitsFor(tile: TileUnitData | undefined, faction: string | undefined, kind: "space" | "ground", planet?: string) {
  if (!tile || !faction) return [];
  if (kind === "space") return tile.space?.[faction] ?? [];
  const planets = planet && tile.planets?.[planet] ? [tile.planets[planet]] : Object.values(tile.planets ?? {});
  const merged = new Map<string, EntityData>();
  for (const p of planets) {
    for (const u of p.entities?.[faction] ?? []) {
      const cur = merged.get(u.entityId);
      merged.set(u.entityId, cur ? { ...cur, count: cur.count + u.count } : u);
    }
  }
  return [...merged.values()];
}

/** The newest dice report in the combat thread. */
function useLastRoll(channelId: string) {
  const data = usePlay((s) => s.messages[channelId]);
  const users = usePlay((s) => s.users);
  const channels = usePlay((s) => s.channels);
  if (!data) return undefined;
  for (let i = data.ids.length - 1; i >= 0; i--) {
    const m = data.byId[data.ids[i]];
    if (!m?.author.bot || !/rolls for|rolled/i.test(m.content)) continue;
    return cleanText(m.content, namesFrom({ users, channels }, () => undefined));
  }
  return undefined;
}

const AUTO_HITS = /^autoAssign\w*Hits/;
const MANUAL_HITS = /^getDamageButtons/;
/** combatRoll_<position>_<space | planet>: the round's roll (not _afb / _bombardment / space cannon). */
const ROLL = /^(combatRoll_[^_]+_[^_]+$|rollForAmbush)/;

function Side({ player, units }: { player?: PlayerData; units: EntityData[] }) {
  return (
    <div className={classes.combatLine}>
      <FactionIcon faction={player?.faction} size={16} />
      <span className={classes.combatName}>{player?.userName ?? "Opponent"}</span>
      <UnitRow units={units} color={player?.color} small />
    </div>
  );
}

type Item = { c: Choice; target: Decision };

/** Every live combat prompt in the thread, one set of buttons: assign hits first, then roll. */
function combatChoices(d: Decision): Item[] {
  const seen = new Set<string>();
  const items: Item[] = [];
  const all = [d, ...(d.steps ?? [])];
  /* The bot repeats "Roll dice" on its hit prompt; press it on the plain combat prompt so the hit prompt stays open. */
  const hasHits = (x: Decision) => x.choices.some((c) => AUTO_HITS.test(baseId(c.customId)));
  for (const target of [...all.filter((x) => !hasHits(x)), ...all.filter(hasHits)]) {
    for (const c of target.choices) {
      const id = c.customId ?? c.key;
      if (seen.has(id)) continue;
      seen.add(id);
      items.push({ c: { ...c, key: `${target.id}:${c.key}` }, target });
    }
  }
  const weight = (it: Item) => {
    const id = baseId(it.c.customId);
    if (AUTO_HITS.test(id)) return /AFB/i.test(id) ? 0 : 1;
    return ROLL.test(id) ? 2 : 3;
  };
  return items.sort((a, b) => weight(a) - weight(b));
}

function rankOf(c: Choice): ChoiceRank {
  const id = baseId(c.customId);
  if (c.rank === "undo") return c.rank;
  if (AUTO_HITS.test(id) || ROLL.test(id)) return "primary";
  return "more";
}

function relabel(c: Choice, hitText?: string): Choice {
  const id = baseId(c.customId);
  if (AUTO_HITS.test(id)) {
    const n = Number(id.split("_").pop());
    const afb = /AFB/i.test(id) ? " anti-fighter" : "";
    return { ...c, style: 3, label: hitText ?? `Assign ${n || ""}${afb} hit${n === 1 ? "" : "s"}`.replace("  ", " ") };
  }
  if (/^combatRoll_[^_]+_[^_]+$/.test(id)) return { ...c, style: 3, label: "Roll dice" };
  if (/^automateGroundCombat_/.test(id)) return { ...c, label: "Automate the whole ground combat (opponent must agree)" };
  if (MANUAL_HITS.test(id)) return { ...c, label: "Choose which units take hits" };
  return c;
}

/** A combat: both sides in one line each, what the hits would destroy, Assign hits / Roll dice. */
export function CombatBody({ d, data, pressOn, pendingKey, onHoverChoice }: RendererProps) {
  const combat = d.combat;
  const tile = combat?.position ? data.web?.tileUnitData?.[combat.position] : undefined;
  const myFaction = data.me?.faction;
  const enemyFaction = combat?.factions.find((f) => f !== myFaction);
  const enemy = playerByFaction(data, enemyFaction);
  const lastRoll = useLastRoll(d.prompt.channelId);
  const kind = combat?.kind ?? "space";
  const items = combatChoices(d);
  const byKey = new Map(items.map((it) => [it.c.key, it]));
  const hitPrompt = [d, ...(d.steps ?? [])].find((x) => x.choices.some((c) => AUTO_HITS.test(baseId(c.customId))));
  const wouldDestroy = hitPrompt?.text.match(/would (destroy|sustain)[^\n]*/i)?.[0];
  const canRoll = items.some((it) => ROLL.test(baseId(it.c.customId)));
  const sentence = hitPrompt
    ? `You must assign hits${wouldDestroy ? ` (auto: ${wouldDestroy.replace(/^would /i, "")})` : ""}.`
    : canRoll
      ? "Both sides roll; hits are assigned after."
      : `You rolled. Waiting for ${enemy?.userName ?? "your opponent"} to roll and assign hits.`;
  return (
    <div className={classes.stack}>
      <div className={classes.combatBoard}>
        <Side player={data.me} units={unitsFor(tile, myFaction, kind, combat?.planet)} />
        <Side player={enemy} units={unitsFor(tile, enemyFaction, kind, combat?.planet)} />
      </div>
      <p className={classes.hint}>{sentence}</p>
      <ChoiceButtons
        choices={items.map((it) => relabel(it.c))}
        onPress={(c, values) => {
          const it = byKey.get(c.key);
          if (!it) return;
          pressOn(it.target)({ ...c, key: c.key }, values);
        }}
        pendingKey={pendingKey}
        channelId={d.prompt.channelId}
        rankOf={rankOf}
        onHover={onHoverChoice}
      />
      {lastRoll && (
        <Details label="Last roll">
          <Prose text={lastRoll} clamp={8} muted />
        </Details>
      )}
    </div>
  );
}
