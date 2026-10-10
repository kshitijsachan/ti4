import { useState, type CSSProperties, type ReactNode } from "react";
import { Menu, Modal, UnstyledButton } from "@mantine/core";
import { IconAdjustmentsHorizontal, IconCheck } from "@tabler/icons-react";
import cx from "clsx";
import { useGameData } from "@/state/useGameContext";
import { useSettingsStore, type Settings } from "@/state/appStore";
import { filterPlayersWithAssignedFaction } from "@/entities/game/playerUtils";
import { getPrimaryColorCSS } from "@/entities/lookup/colors";
import PlayerCard from "@/domains/player/components/composition/PlayerCard";
import type { DeckSection } from "@/domains/player/components/PlayerCardShared/PlayerCardDeck";
import { summarizePlayer } from "./playerSummary";
import classes from "./PlayersView.module.css";

const SECTIONS: { key: DeckSection; label: string }[] = [
  { key: "status", label: "Goods & tokens" },
  { key: "holdings", label: "Objectives & notes" },
  { key: "leaders", label: "Leaders" },
  { key: "tech", label: "Technology" },
  { key: "units", label: "Units" },
  { key: "planets", label: "Planets" },
  { key: "faction", label: "Faction" },
];

type DetailKey = Extract<
  keyof Settings,
  | "showPlayerAreaCommandTokens"
  | "showPlayerAreaArmyStrength"
  | "showPlayerAreaUnitUpgrades"
  | "showPlayerAreaTotalSpend"
  | "showPlayerAreaReinforcements"
  | "showPlayerAreaFactionAbilities"
  | "showPlayerAreaNeighborship"
>;

/** Upstream's "Player Areas" display toggles: finer detail inside the plates. */
const DETAILS: { key: DetailKey; label: string }[] = [
  { key: "showPlayerAreaCommandTokens", label: "Command tokens" },
  { key: "showPlayerAreaArmyStrength", label: "Army strength" },
  { key: "showPlayerAreaUnitUpgrades", label: "Unit upgrades" },
  { key: "showPlayerAreaTotalSpend", label: "Total spend" },
  { key: "showPlayerAreaReinforcements", label: "Reinforcement tokens" },
  { key: "showPlayerAreaFactionAbilities", label: "Faction abilities" },
  { key: "showPlayerAreaNeighborship", label: "Neighbours" },
];

const STORAGE_KEY = "ti4_players_view";

type Stored = { sections: DeckSection[] | null; hidden: string[] };

const SECTION_KEYS = new Set<string>(SECTIONS.map((s) => s.key));

function load(): Stored {
  try {
    const raw = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "null",
    ) as Partial<Record<keyof Stored, unknown>> | null;
    const sections = Array.isArray(raw?.sections)
      ? raw.sections.filter(
          (k): k is DeckSection => typeof k === "string" && SECTION_KEYS.has(k),
        )
      : [];
    const hidden = Array.isArray(raw?.hidden)
      ? raw.hidden.filter((f): f is string => typeof f === "string")
      : [];
    return { sections: sections.length ? sections : null, hidden };
  } catch {
    // A blocked or corrupt store just means the defaults.
    return { sections: null, hidden: [] };
  }
}

function save(value: Stored) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Remembering the filter is a convenience only.
  }
}

/** The view's filters, remembered per browser: which plates (null = all) and which seats are hidden. */
function useFilters() {
  const [state, setState] = useState(load);
  const update = (next: Stored) => {
    setState(next);
    save(next);
  };
  return { ...state, update };
}

function Pill({
  on,
  onClick,
  children,
  color,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
  color?: string;
}) {
  return (
    <UnstyledButton
      className={cx(classes.pill, on && classes.pillOn)}
      onClick={onClick}
      aria-pressed={on}
      style={color ? ({ "--seat": color } as CSSProperties) : undefined}
    >
      {color && <span className={classes.seatDot} />}
      {children}
    </UnstyledButton>
  );
}

type Props = {
  opened: boolean;
  onClose: () => void;
};

/**
 * Every player's board side by side, filtered by plate (only techs, only planets…) and by seat, so the table
 * can be compared at a glance. Upstream's "Player" tab and its Player Areas display toggles, in one place.
 */
export function PlayersView({ opened, onClose }: Props) {
  const data = useGameData();
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.handlers.updateSettings);
  const { sections, hidden, update } = useFilters();
  const players = filterPlayersWithAssignedFaction(data?.playerData ?? []);
  const shown = players.filter((p) => !hidden.includes(p.faction));
  const sectionSet = sections ? new Set(sections) : undefined;

  const toggleSection = (key: DeckSection) => {
    const current = sections ?? [];
    const next = current.includes(key)
      ? current.filter((k) => k !== key)
      : [...current, key];
    update({ sections: next.length ? next : null, hidden });
  };
  const togglePlayer = (faction: string) => {
    const next = hidden.includes(faction)
      ? hidden.filter((f) => f !== faction)
      : [...hidden, faction];
    // Hiding everyone is never what was meant: show all again.
    update({ sections, hidden: next.length >= players.length ? [] : next });
  };
  const detailsOff = DETAILS.filter((d) => !settings[d.key]).length;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size="auto"
      centered
      title="Players"
      classNames={{
        content: classes.content,
        body: classes.body,
        header: classes.header,
      }}
    >
      <div className={classes.toolbar}>
        <div className={classes.group} role="group" aria-label="Show">
          <span className={classes.groupLabel}>Show</span>
          <Pill
            on={!sections}
            onClick={() => update({ sections: null, hidden })}
          >
            Everything
          </Pill>
          {SECTIONS.map((s) => (
            <Pill
              key={s.key}
              on={!!sections?.includes(s.key)}
              onClick={() => toggleSection(s.key)}
            >
              {s.label}
            </Pill>
          ))}
        </div>
        <div className={classes.group} role="group" aria-label="Players">
          <span className={classes.groupLabel}>Players</span>
          {players.map((p) => (
            <Pill
              key={p.faction}
              on={!hidden.includes(p.faction)}
              onClick={() => togglePlayer(p.faction)}
              color={getPrimaryColorCSS(p.color)}
            >
              {summarizePlayer(p).factionName}
            </Pill>
          ))}
          <Menu
            position="bottom-end"
            width={230}
            shadow="md"
            closeOnItemClick={false}
            zIndex={3400}
          >
            <Menu.Target>
              <UnstyledButton
                className={cx(classes.pill, classes.details)}
                aria-label="Detail toggles"
              >
                <IconAdjustmentsHorizontal size={14} stroke={1.7} />
                Details{detailsOff ? ` · ${detailsOff} hidden` : ""}
              </UnstyledButton>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>Inside each board</Menu.Label>
              {DETAILS.map((d) => (
                <Menu.Item
                  key={d.key}
                  leftSection={
                    <IconCheck
                      size={14}
                      style={{
                        visibility: settings[d.key] ? "visible" : "hidden",
                      }}
                    />
                  }
                  onClick={() => updateSettings({ [d.key]: !settings[d.key] })}
                >
                  {d.label}
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
        </div>
      </div>
      <div
        className={classes.grid}
        style={
          {
            "--cell-min": sections && sections.length <= 2 ? "320px" : "360px",
          } as CSSProperties
        }
      >
        {shown.map((player) => (
          <div key={player.color} className={classes.cell}>
            <PlayerCard playerData={player} sections={sectionSet} />
          </div>
        ))}
      </div>
    </Modal>
  );
}
