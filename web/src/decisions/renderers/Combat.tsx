import { usePlay } from "@/discord";
import type { EntityData, PlayerData, TileUnitData } from "@/entities/data/types";
import { baseId, type Choice } from "../model/controls";
import { cleanText, namesFrom } from "../model/text";
import { ChoiceButtons } from "../ui/ChoiceButtons";
import { PlayerTag, Prose, Section, UnitRow } from "../ui/parts";
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

/** The newest dice report in the combat thread ("… rolled … 2 hits"). */
function useLastRoll(channelId: string) {
  const data = usePlay((s) => s.messages[channelId]);
  const users = usePlay((s) => s.users);
  const channels = usePlay((s) => s.channels);
  if (!data) return undefined;
  for (let i = data.ids.length - 1; i >= 0; i--) {
    const m = data.byId[data.ids[i]];
    if (!m?.author.bot || !/\bhits?\b|rolled|misses/i.test(m.content)) continue;
    return cleanText(m.content, namesFrom({ users, channels }, () => undefined));
  }
  return undefined;
}

const ROLL = /^(combatRoll|rollForAmbush|bombardConfirm)/;
const HITS = /^(getDamageButtons|assignHits|autoAssign|assignDamage)/;

function Side({ player, label, units }: { player?: PlayerData; label: string; units: EntityData[] }) {
  return (
    <div className={classes.combatSide}>
      <div className={classes.combatSideHead}>
        <PlayerTag player={player} fallback={label} />
        {player && <span className={classes.dim}>{label}</span>}
      </div>
      <UnitRow units={units} color={player?.color} />
    </div>
  );
}

/** A combat step: both fleets (or ground forces), the last roll, and the roll / assign-hits buttons. */
export function CombatBody({ d, data, onPress, pendingKey, onHoverChoice }: RendererProps) {
  const combat = d.combat;
  const tile = combat?.position ? data.web?.tileUnitData?.[combat.position] : undefined;
  const myFaction = data.me?.faction;
  const enemyFaction = combat?.factions.find((f) => f !== myFaction);
  const enemy = playerByFaction(data, enemyFaction);
  const lastRoll = useLastRoll(d.prompt.channelId);
  const kind = combat?.kind ?? "space";
  const rankOf = (c: Choice) => {
    const id = baseId(c.customId);
    if (c.rank === "undo") return c.rank;
    if (ROLL.test(id) || HITS.test(id)) return "primary";
    if (/^retreat_/.test(id)) return "secondary";
    return c.rank === "primary" ? "secondary" : c.rank;
  };
  return (
    <div className={classes.stack}>
      <div className={classes.combatBoard}>
        <Side player={data.me} label="You" units={unitsFor(tile, myFaction, kind, combat?.planet)} />
        <span className={classes.versus}>vs</span>
        <Side player={enemy} label={enemyFaction ?? "Opponent"} units={unitsFor(tile, enemyFaction, kind, combat?.planet)} />
      </div>
      {lastRoll && (
        <Section label="Last roll">
          <Prose text={lastRoll} clamp={4} muted />
        </Section>
      )}
      {!lastRoll && <Prose text={d.text} clamp={3} muted />}
      <ChoiceButtons
        choices={d.choices}
        onPress={onPress}
        pendingKey={pendingKey}
        channelId={d.prompt.channelId}
        rankOf={rankOf}
        onHover={onHoverChoice}
      />
    </div>
  );
}
