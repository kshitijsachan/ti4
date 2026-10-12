import { Box } from "@mantine/core";
import { SettingsStore, useSettingsStore } from "@/state/appStore";

const THEME_SWATCHES: {
  name: SettingsStore["settings"]["themeName"];
  label: string;
  gradient: string;
  highlight: string;
}[] = [
  {
    name: "midnightgraytheme",
    label: "Graphite",
    gradient:
      "linear-gradient(135deg, rgba(8,8,8,1) 0%, rgba(24,24,24,1) 100%)",
    highlight: "rgba(200,200,200,1)",
  },
  {
    name: "midnightbluetheme",
    label: "Midnight blue",
    gradient:
      "linear-gradient(135deg, rgba(8,14,33,1) 0%, rgba(20,29,45,1) 100%)",
    highlight: "rgba(59,130,246,1)",
  },
  {
    name: "midnightredtheme",
    label: "Crimson",
    gradient:
      "linear-gradient(135deg, rgba(18,8,12,1) 0%, rgba(45,14,20,1) 100%)",
    highlight: "rgba(220,38,38,1)",
  },
  {
    name: "midnightviolettheme",
    label: "Violet",
    gradient:
      "linear-gradient(135deg, rgba(14,10,26,1) 0%, rgba(34,16,46,1) 100%)",
    highlight: "rgba(168,85,247,1)",
  },
  {
    name: "midnightgreentheme",
    label: "Emerald",
    gradient:
      "linear-gradient(135deg, rgba(8,20,14,1) 0%, rgba(12,38,26,1) 100%)",
    highlight: "rgba(16,185,129,1)",
  },
  {
    name: "vaporwavetheme",
    label: "Vaporwave",
    gradient:
      "linear-gradient(135deg, rgba(255,0,170,1) 0%, rgba(0,240,255,1) 100%)",
    highlight: "rgba(255,0,170,1)",
  },
];

export function ThemeSwatches() {
  const themeName = useSettingsStore((state) => state.settings.themeName);
  const setThemeName = useSettingsStore((state) => state.handlers.setThemeName);

  return (
    <Box style={{ display: "flex", gap: 10, marginLeft: 10, marginRight: 30 }}>
      {THEME_SWATCHES.map((t) => (
        <button
          key={t.name}
          onClick={() => setThemeName(t.name)}
          aria-label={`${t.label} theme`}
          aria-pressed={themeName === t.name}
          title={t.label}
          style={{
            width: 20,
            height: 20,
            borderRadius: "50%",
            border: `2px solid ${t.highlight}`,
            background: t.gradient,
            cursor: "pointer",
            outline: themeName === t.name ? `2px solid ${t.highlight}` : "none",
          }}
        />
      ))}
    </Box>
  );
}
