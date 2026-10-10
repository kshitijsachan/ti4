import { Stack, Switch, Text, SegmentedControl } from "@mantine/core";
import { useSettingsStore } from "@/state/appStore";
import { AppModal } from "@/shared/ui/AppModal";
import type { ControlTokenDisplayMode } from "@/entities/game/controlTokenDisplay";

type SettingsModalProps = {
  opened: boolean;
  onClose: () => void;
};

/**
 * The finer map display options (Settings → Advanced → Display options). Map layers and highlights live in the
 * settings menu itself, and what each player board shows is under Players → Details.
 */
export function SettingsModal({ opened, onClose }: SettingsModalProps) {
  const settings = useSettingsStore((state) => state.settings);
  const handlers = useSettingsStore((state) => state.handlers);
  const toggle = (key: "showMapPlayerStats") => () =>
    handlers.updateSettings({ [key]: !settings[key] });

  return (
    <AppModal opened={opened} onClose={onClose} title="Display options" size="lg" centered>
      <Stack gap="lg">
        <Stack gap="xs">
          <Text size="sm" fw={500}>
            Control tokens on planets
          </Text>
          <SegmentedControl
            value={settings.controlTokenDisplayMode}
            onChange={(value) =>
              handlers.updateSettings({
                controlTokenDisplayMode: value as ControlTokenDisplayMode,
              })
            }
            data={[
              { label: "Always", value: "always" },
              { label: "If ambiguous", value: "ambiguous" },
              { label: "Only if empty", value: "empty" },
            ]}
            fullWidth
          />
          <Text size="xs" c="dimmed">
            Ambiguous: no ground forces on the planet, or ground forces of more than one player.
          </Text>
        </Stack>
        <Switch
          checked={settings.showExhaustedPlanets}
          onChange={handlers.toggleShowExhaustedPlanets}
          size="sm"
          label="Grey out exhausted planets"
          description="Exhausted planets are drawn greyed out on the map."
        />
        <Switch
          checked={settings.accessibleColors}
          onChange={handlers.toggleAccessibleColors}
          size="sm"
          label="Accessible colors"
          description="Redraws the units, tokens and home labels on the map in an easy-to-tell-apart palette (blue, green, purple, yellow, red, pink, black, light grey) in seat order. Only on your screen."
        />
        <Switch
          checked={settings.showMapPlayerStats}
          onChange={toggle("showMapPlayerStats")}
          size="sm"
          label="Player stat hexes on the map"
          description="Victory points, trade goods, commodities and command tokens in hexes beside each home system, instead of the name labels."
        />
      </Stack>
    </AppModal>
  );
}
