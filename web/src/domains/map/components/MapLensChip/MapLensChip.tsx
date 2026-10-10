import { Tooltip, UnstyledButton } from "@mantine/core";
import { IconX } from "@tabler/icons-react";
import { activeMapLens, useSettingsStore } from "@/state/appStore";
import { useMapLensCounts } from "../hooks/useMapLensCounts";
import classes from "./MapLensChip.module.css";

/**
 * Says so on the board while a highlight is dimming it, with the one click that turns it off, so a
 * highlight left on never reads as a broken map.
 */
export function MapLensChip() {
  const settings = useSettingsStore((s) => s.settings);
  const setMapLens = useSettingsStore((s) => s.handlers.setMapLens);
  const counts = useMapLensCounts();
  const lens = activeMapLens(settings);
  if (!lens) return null;
  const count = counts[lens.key];
  const detail = count ? `${count} system${count === 1 ? "" : "s"}` : "none on the map";

  return (
    <div className={classes.chip} role="status">
      <span className={classes.dot} />
      <span className={classes.label}>{lens.label}</span>
      <span className={classes.detail}>{detail}</span>
      <Tooltip label={`Turn off (${lens.shortcut.toUpperCase()})`} position="bottom" openDelay={300}>
        <UnstyledButton
          className={classes.close}
          onClick={() => setMapLens(null)}
          aria-label={`Turn off ${lens.label}`}
        >
          <IconX size={13} stroke={2} />
        </UnstyledButton>
      </Tooltip>
    </div>
  );
}
