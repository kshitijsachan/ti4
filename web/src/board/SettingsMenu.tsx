import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Menu, UnstyledButton } from "@mantine/core";
import {
  IconAdjustments,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconHash,
  IconKeyboard,
  IconLayoutGrid,
  IconSettings,
} from "@tabler/icons-react";
import { ThemeSwatches } from "@/domains/game-shell/components/TabsControls/ThemeSwatches";
import { useMapLensCounts } from "@/domains/map/components/hooks/useMapLensCounts";
import { MAP_LENSES, useSettingsStore } from "@/state/appStore";
import { alertsEnabled, disableAlerts, enableAlerts } from "@/play/turn";
import classes from "./SettingsMenu.module.css";

type Props = { onRawChannels: () => void };

function Check({ on }: { on: boolean }) {
  return <IconCheck size={14} style={{ visibility: on ? "visible" : "hidden" }} />;
}

function Radio({ on }: { on: boolean }) {
  return <span className={classes.radio} data-on={on || undefined} />;
}

function Key({ children }: { children: ReactNode }) {
  return <kbd className={classes.key}>{children}</kbd>;
}

type AlertState = "on" | "off" | "blocked" | "unsupported";

function readAlertState(): AlertState {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  return alertsEnabled() ? "on" : "off";
}

/** Look and feel, map layers and highlights, turn alerts; the raw bot view and finer display options under Advanced. */
export function SettingsMenu({ onRawChannels }: Props) {
  const navigate = useNavigate();
  const settings = useSettingsStore((s) => s.settings);
  const handlers = useSettingsStore((s) => s.handlers);
  const lensCounts = useMapLensCounts();
  const [alerts, setAlerts] = useState(readAlertState);
  const [advanced, setAdvanced] = useState(false);

  const toggleAlerts = async () => {
    if (alerts === "on") {
      disableAlerts();
      setAlerts("off");
      return;
    }
    await enableAlerts();
    setAlerts(readAlertState());
  };

  const toggleLens = (key: (typeof MAP_LENSES)[number]["key"]) =>
    handlers.setMapLens(settings[key] ? null : key);

  return (
    <Menu position="bottom-end" width={264} shadow="md" closeOnItemClick={false} zIndex={3300}>
      <Menu.Target>
        <UnstyledButton className={classes.trigger} aria-label="Settings">
          <IconSettings size={18} />
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Theme</Menu.Label>
        <div className={classes.swatches}>
          <ThemeSwatches />
        </div>
        <Menu.Divider />
        <Menu.Label>Map</Menu.Label>
        <Menu.Item
          leftSection={<Check on={settings.overlaysEnabled} />}
          rightSection={<Key>O</Key>}
          onClick={handlers.toggleOverlays}
        >
          Control overlays
        </Menu.Item>
        <Menu.Label className={classes.subLabel}>Highlight · one at a time</Menu.Label>
        {MAP_LENSES.map((lens) => {
          const count = lensCounts[lens.key];
          const on = settings[lens.key];
          return (
            <Menu.Item
              key={lens.key}
              leftSection={<Radio on={on} />}
              rightSection={
                <span className={classes.right}>
                  <span className={classes.count}>{count || "none"}</span>
                  <Key>{lens.shortcut.toUpperCase()}</Key>
                </span>
              }
              disabled={!count && !on}
              onClick={() => toggleLens(lens.key)}
            >
              {lens.label}
            </Menu.Item>
          );
        })}
        <Menu.Divider />
        {alerts !== "unsupported" && (
          <Menu.Item
            leftSection={<Check on={alerts === "on"} />}
            disabled={alerts === "blocked"}
            onClick={() => void toggleAlerts()}
          >
            Turn alerts
            <div className={classes.hint}>
              {alerts === "blocked"
                ? "Blocked in this browser's site settings"
                : "A browser notification when it's my move"}
            </div>
          </Menu.Item>
        )}
        <Menu.Item
          leftSection={<IconKeyboard size={14} />}
          onClick={() => handlers.setKeyboardShortcutsModalOpened(true)}
          closeMenuOnClick
        >
          Keyboard shortcuts
        </Menu.Item>
        <Menu.Item leftSection={<IconLayoutGrid size={14} />} onClick={() => navigate("/play")} closeMenuOnClick>
          All my games
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item
          leftSection={advanced ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          onClick={() => setAdvanced((v) => !v)}
          aria-expanded={advanced}
          className={classes.advanced}
        >
          Advanced
        </Menu.Item>
        {advanced && (
          <>
            <Menu.Item
              leftSection={<IconAdjustments size={14} />}
              onClick={() => handlers.setSettingsModalOpened(true)}
              closeMenuOnClick
            >
              Display options…
            </Menu.Item>
            <Menu.Item leftSection={<IconHash size={14} />} onClick={onRawChannels} closeMenuOnClick>
              Raw bot channels
            </Menu.Item>
          </>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}
