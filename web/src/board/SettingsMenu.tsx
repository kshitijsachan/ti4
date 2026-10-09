import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Menu, UnstyledButton } from "@mantine/core";
import {
  IconAdjustments,
  IconBell,
  IconBellOff,
  IconCheck,
  IconHash,
  IconKeyboard,
  IconLayoutGrid,
  IconSettings,
} from "@tabler/icons-react";
import { ThemeSwatches } from "@/domains/game-shell/components/TabsControls/ThemeSwatches";
import { useSettingsStore } from "@/state/appStore";
import { alertsEnabled, disableAlerts, enableAlerts } from "@/play/turn";
import classes from "./SettingsMenu.module.css";

type Props = { onRawChannels: () => void };

function Check({ on }: { on: boolean }) {
  return <IconCheck size={14} style={{ visibility: on ? "visible" : "hidden" }} />;
}

/** Everything that isn't part of playing: look and feel, map layers, the raw bot view. */
export function SettingsMenu({ onRawChannels }: Props) {
  const navigate = useNavigate();
  const settings = useSettingsStore((s) => s.settings);
  const handlers = useSettingsStore((s) => s.handlers);
  const [alerts, setAlerts] = useState(alertsEnabled);

  const layers = [
    { label: "Control overlays", on: settings.overlaysEnabled, toggle: handlers.toggleOverlays },
    { label: "Planet types", on: settings.planetTypesMode, toggle: handlers.togglePlanetTypesMode },
    { label: "Tech skips", on: settings.techSkipsMode, toggle: handlers.toggleTechSkipsMode },
    { label: "Attachments", on: settings.attachmentsMode, toggle: handlers.toggleAttachmentsMode },
    { label: "PDS coverage", on: settings.showPDSLayer, toggle: handlers.togglePdsMode },
  ];

  const toggleAlerts = async () => {
    if (alerts) {
      disableAlerts();
      setAlerts(false);
      return;
    }
    setAlerts(await enableAlerts());
  };

  return (
    <Menu position="bottom-end" width={250} shadow="md" closeOnItemClick={false} zIndex={3300}>
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
        <Menu.Label>Map layers</Menu.Label>
        {layers.map((layer) => (
          <Menu.Item key={layer.label} leftSection={<Check on={layer.on} />} onClick={layer.toggle}>
            {layer.label}
          </Menu.Item>
        ))}
        <Menu.Item
          leftSection={<IconAdjustments size={14} />}
          onClick={() => handlers.setSettingsModalOpened(true)}
          closeMenuOnClick
        >
          More display settings…
        </Menu.Item>
        <Menu.Item
          leftSection={<IconKeyboard size={14} />}
          onClick={() => handlers.setKeyboardShortcutsModalOpened(true)}
          closeMenuOnClick
        >
          Keyboard shortcuts
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item
          leftSection={alerts ? <IconBell size={14} /> : <IconBellOff size={14} />}
          onClick={() => void toggleAlerts()}
        >
          {alerts ? "Turn alerts on" : "Turn alerts off"}
        </Menu.Item>
        <Menu.Item leftSection={<IconLayoutGrid size={14} />} onClick={() => navigate("/play")} closeMenuOnClick>
          All my games
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item leftSection={<IconHash size={14} />} onClick={onRawChannels} closeMenuOnClick>
          Advanced: raw bot channels
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
