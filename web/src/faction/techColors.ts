/** Tech colours as `--gd-*` RGB triplets (fixed signal vocabulary), by prerequisite letter and by tech type. */
export const TECH_RGB: Record<string, string> = {
  B: "var(--gd-blue)",
  G: "var(--gd-green)",
  R: "var(--gd-red)",
  Y: "var(--gd-yellow)",
  PROPULSION: "var(--gd-blue)",
  BIOTIC: "var(--gd-green)",
  WARFARE: "var(--gd-red)",
  CYBERNETIC: "var(--gd-yellow)",
  UNITUPGRADE: "var(--gd-gray)",
};

const TYPE_LABEL: Record<string, string> = {
  PROPULSION: "Propulsion",
  BIOTIC: "Biotic",
  WARFARE: "Warfare",
  CYBERNETIC: "Cybernetic",
  UNITUPGRADE: "Unit upgrade",
};

export const techTypeLabel = (types: string[]) => types.map((t) => TYPE_LABEL[t] ?? t).join(" / ");

export const techRgb = (types: string[]) => TECH_RGB[types[0]] ?? "var(--gd-gray)";
